-- =============================================================================
-- Owner tools
--   * menu_items.calories: shown on the menu (SFDA calorie labelling).
--   * orders.rating / rating_comment / rated_at: the customer rates a
--     completed order once; admins see the overview.
--   * notification_prefs: per-user switches. Offers are opt-in (App Store
--     guideline 4.5.4); new-order alerts (staff, admin) and the daily summary
--     (admin) are on by default.
--   * push_broadcasts: offers sent from the admin page.
--   * daily_summaries: one end-of-day summary per business day.
-- =============================================================================

alter table public.menu_items
  add column calories int
    constraint menu_items_calories_range check (calories is null or calories between 0 and 5000);

alter table public.orders
  add column rating smallint
    constraint orders_rating_range check (rating is null or rating between 1 and 5),
  add column rating_comment text
    constraint orders_rating_comment_length check (rating_comment is null or char_length(rating_comment) between 1 and 300),
  add column rated_at timestamptz;

create index orders_rated_at_idx on public.orders (rated_at desc) where rated_at is not null;

create table public.notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  offers boolean not null default false,
  new_orders boolean not null default true,
  daily_summary boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger notification_prefs_touch before update on public.notification_prefs
  for each row execute function public.touch_updated_at();

alter table public.notification_prefs enable row level security;
revoke all on table public.notification_prefs from anon, authenticated;
grant all on table public.notification_prefs to service_role;

create table public.push_broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null
    constraint push_broadcasts_title_length check (char_length(btrim(title)) between 1 and 40),
  body text not null
    constraint push_broadcasts_body_length check (char_length(btrim(body)) between 1 and 180),
  sent_by uuid references public.profiles (id) on delete set null,
  recipients int not null default 0,
  sent int not null default 0,
  created_at timestamptz not null default now()
);

create index push_broadcasts_created_idx on public.push_broadcasts (created_at desc);

alter table public.push_broadcasts enable row level security;
revoke all on table public.push_broadcasts from anon, authenticated;
grant all on table public.push_broadcasts to service_role;

create table public.daily_summaries (
  business_date date primary key,
  sent_at timestamptz not null default now()
);

alter table public.daily_summaries enable row level security;
revoke all on table public.daily_summaries from anon, authenticated;
grant all on table public.daily_summaries to service_role;

-- Rates a completed order once. Codes: NOT_FOUND, NOT_COMPLETED, ALREADY_RATED.
create function public.rate_order(p_customer_id uuid, p_order_id uuid, p_rating int, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id and customer_id = p_customer_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if o.status <> 'completed' then
    return jsonb_build_object('ok', false, 'code', 'NOT_COMPLETED');
  end if;
  if o.rating is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_RATED');
  end if;
  update public.orders
     set rating = p_rating, rating_comment = nullif(btrim(p_comment), ''), rated_at = now()
   where id = p_order_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Average, count and the latest ratings for the admin page.
create function public.rating_overview(p_limit int default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'count', (select count(*) from public.orders where rating is not null),
    'average', (select round(avg(rating)::numeric, 2) from public.orders where rating is not null),
    'items', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.rated_at desc)
        from (select order_number, customer_name, rating, rating_comment, rated_at
                from public.orders
               where rating is not null
               order by rated_at desc
               limit least(greatest(coalesce(p_limit, 30), 1), 100)) x
    ), '[]'::jsonb)
  );
$$;

-- Devices of staff/admins who want alerts: 'new_orders' (staff + admin) or
-- 'daily_summary' (admin).
create function public.staff_push_tokens(p_kind text)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select d.token
    from public.push_devices d
    join public.profiles p on p.id = d.user_id
    left join public.notification_prefs n on n.user_id = d.user_id
   where p.disabled_at is null
     and case p_kind
           when 'new_orders' then p.role in ('staff', 'admin') and coalesce(n.new_orders, true)
           when 'daily_summary' then p.role = 'admin' and coalesce(n.daily_summary, true)
           else false
         end
   order by d.updated_at desc
   limit 20;
$$;

-- Devices of people who opted in to offers, in token order for batching.
create function public.offer_push_tokens(p_after text default null, p_limit int default 35)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select d.token
    from public.push_devices d
    join public.profiles p on p.id = d.user_id
    join public.notification_prefs n on n.user_id = d.user_id and n.offers
   where p.disabled_at is null
     and (p_after is null or d.token > p_after)
   order by d.token
   limit least(greatest(coalesce(p_limit, 35), 1), 100);
$$;

create function public.offer_push_count()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.push_devices d
    join public.profiles p on p.id = d.user_id
    join public.notification_prefs n on n.user_id = d.user_id and n.offers
   where p.disabled_at is null;
$$;

-- Orders between two instants, for the end-of-day summary.
create function public.order_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'completed', count(*) filter (where o.status = 'completed'),
    'cancelled', count(*) filter (where o.status = 'cancelled'),
    'open', count(*) filter (where o.status not in ('completed', 'cancelled')),
    'revenue_halalas', coalesce(sum(o.total_halalas) filter (where o.status = 'completed'), 0),
    'top_item', (
      select jsonb_build_object('name_ar', i.name_ar, 'quantity', sum(i.quantity))
        from public.order_items i
        join public.orders t on t.id = i.order_id
       where t.created_at >= p_from and t.created_at < p_to and t.status = 'completed'
       group by i.name_ar
       order by sum(i.quantity) desc, i.name_ar
       limit 1
    )
  )
    from public.orders o
   where o.created_at >= p_from and o.created_at < p_to;
$$;

-- True the first time it is called for a business day.
create function public.claim_daily_summary(p_date date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.daily_summaries (business_date) values (p_date) on conflict do nothing;
  return found;
end;
$$;

revoke execute on function public.rate_order(uuid, uuid, int, text) from public, anon, authenticated;
revoke execute on function public.rating_overview(int) from public, anon, authenticated;
revoke execute on function public.staff_push_tokens(text) from public, anon, authenticated;
revoke execute on function public.offer_push_tokens(text, int) from public, anon, authenticated;
revoke execute on function public.offer_push_count() from public, anon, authenticated;
revoke execute on function public.order_summary(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.claim_daily_summary(date) from public, anon, authenticated;
grant execute on function public.rate_order(uuid, uuid, int, text) to service_role;
grant execute on function public.rating_overview(int) to service_role;
grant execute on function public.staff_push_tokens(text) to service_role;
grant execute on function public.offer_push_tokens(text, int) to service_role;
grant execute on function public.offer_push_count() to service_role;
grant execute on function public.order_summary(timestamptz, timestamptz) to service_role;
grant execute on function public.claim_daily_summary(date) to service_role;

-- Orders now carry the customer's rating.
create or replace function public.list_orders(
  p_customer_id uuid default null,
  p_order_id uuid default null,
  p_scope text default 'all',
  p_recent_minutes int default 120,
  p_limit int default 50
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_json order by created_at desc), '[]'::jsonb)
    from (
      select o.created_at,
             jsonb_build_object(
               'id', o.id,
               'order_number', o.order_number,
               'customer_id', o.customer_id,
               'customer_name', o.customer_name,
               'customer_phone', o.customer_phone,
               'member_id', a.member_id,
               'fulfillment', o.fulfillment,
               'car_description', o.car_description,
               'delivery_address', o.delivery_address,
               'delivery_lat', o.delivery_lat,
               'delivery_lng', o.delivery_lng,
               'note', o.note,
               'subtotal_halalas', o.subtotal_halalas,
               'delivery_fee_halalas', o.delivery_fee_halalas,
               'discount_halalas', o.discount_halalas,
               'total_halalas', o.total_halalas,
               'payment_method', o.payment_method,
               'use_reward', o.use_reward,
               'status', o.status,
               'cancel_reason', o.cancel_reason,
               'cancelled_by', o.cancelled_by,
               'customer_arrived_at', o.customer_arrived_at,
               'accepted_at', o.accepted_at,
               'ready_at', o.ready_at,
               'out_for_delivery_at', o.out_for_delivery_at,
               'completed_at', o.completed_at,
               'cancelled_at', o.cancelled_at,
               'loyalty_result', o.loyalty_result,
               'rating', o.rating,
               'rating_comment', o.rating_comment,
               'rated_at', o.rated_at,
               'created_at', o.created_at,
               'items', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'menu_item_id', i.menu_item_id,
                          'name_ar', i.name_ar,
                          'category', i.category,
                          'unit_price_halalas', i.unit_price_halalas,
                          'quantity', i.quantity,
                          'note', i.note,
                          'option_id', i.option_id,
                          'option_name_ar', i.option_name_ar
                        ) order by i.position), '[]'::jsonb)
                   from public.order_items i where i.order_id = o.id
               )
             ) as row_json
        from public.orders o
        left join public.loyalty_accounts a on a.user_id = o.customer_id
       where (p_customer_id is null or o.customer_id = p_customer_id)
         and (p_order_id is null or o.id = p_order_id)
         and (p_scope <> 'active'
              or o.status not in ('completed', 'cancelled')
              or coalesce(o.completed_at, o.cancelled_at) > now() - make_interval(mins => greatest(coalesce(p_recent_minutes, 120), 0)))
       order by o.created_at desc
       limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) rows;
$$;
