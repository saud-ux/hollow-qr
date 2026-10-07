-- Discounts: the owner puts one percentage off either the whole menu or chosen
-- items, switched on by hand and optionally ending at a set time. Prices are
-- worked out here when the order is placed (never trusted from the app); each
-- line keeps the price before the discount, and the order keeps the
-- percentage and how much the customer saved.

alter table public.shop_settings
  add column discount_percent smallint
    constraint shop_settings_discount_percent_range check (discount_percent is null or discount_percent between 1 and 90),
  add column discount_scope text not null default 'all'
    constraint shop_settings_discount_scope check (discount_scope in ('all', 'items')),
  add column discount_item_ids uuid[] not null default '{}'
    constraint shop_settings_discount_items_size check (cardinality(discount_item_ids) <= 200),
  add column discount_ends_at timestamptz,
  add column discount_started_at timestamptz;

alter table public.orders
  add column promo_percent smallint
    constraint orders_promo_percent_range check (promo_percent is null or promo_percent between 1 and 90),
  add column promo_savings_halalas int not null default 0
    constraint orders_promo_savings_range check (promo_savings_halalas >= 0);

-- The menu price when the line was discounted (null: sold at the menu price).
alter table public.order_items
  add column list_price_halalas int
    constraint order_items_list_price_range check (list_price_halalas is null or list_price_halalas >= 0);

/** The percentage off a menu item right now, or null. */
create function public.discount_percent_for(s public.shop_settings, p_item_id uuid, p_at timestamptz)
returns int
language sql
stable
set search_path = ''
as $$
  select case
           when s.discount_percent is not null
            and (s.discount_ends_at is null or s.discount_ends_at > p_at)
            and (s.discount_scope = 'all' or p_item_id = any (s.discount_item_ids))
           then s.discount_percent::int
         end;
$$;

revoke execute on function public.discount_percent_for(public.shop_settings, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.discount_percent_for(public.shop_settings, uuid, timestamptz) to service_role;

create or replace function public.place_order(
  p_customer_id uuid,
  p_items jsonb,
  p_fulfillment public.fulfillment_type,
  p_phone text,
  p_car_description text default null,
  p_delivery_address text default null,
  p_delivery_lat double precision default null,
  p_delivery_lng double precision default null,
  p_note text default null,
  p_use_reward boolean default false,
  p_idempotency_key uuid default null,
  p_time_zone text default 'Asia/Riyadh'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  customer public.profiles;
  s public.shop_settings;
  acct public.loyalty_accounts;
  existing public.orders;
  v_order_id uuid;
  subtotal int := 0;
  fee int := 0;
  discount int := 0;
  total_qty int := 0;
  drink_qty int := 0;
  max_drink_price int := 0;
  savings int := 0;
  pct int;
  unit int;
  line record;
  pos int := 0;
begin
  select * into customer from public.profiles where id = p_customer_id and disabled_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if p_idempotency_key is not null then
    select * into existing from public.orders where idempotency_key = p_idempotency_key;
    if found then
      if existing.customer_id <> p_customer_id then
        return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
      end if;
      return jsonb_build_object('ok', true, 'replayed', true, 'order_id', existing.id);
    end if;
  end if;

  select * into s from public.shop_settings where id = 1;
  if not public.shop_is_open(now(), p_time_zone) then
    return jsonb_build_object('ok', false, 'code', 'SHOP_CLOSED');
  end if;
  if (p_fulfillment = 'pickup' and not s.pickup_enabled)
     or (p_fulfillment = 'curbside' and not s.curbside_enabled)
     or (p_fulfillment = 'delivery' and not s.delivery_enabled) then
    return jsonb_build_object('ok', false, 'code', 'FULFILLMENT_UNAVAILABLE');
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'code', 'EMPTY_ORDER');
  end if;
  if jsonb_array_length(p_items) > 30 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_ITEMS');
  end if;

  -- Price every line from the menu (never from the client).
  for line in
    select (e ->> 'menu_item_id')::uuid as menu_item_id,
           (e ->> 'quantity')::int as quantity,
           nullif(btrim(e ->> 'note'), '') as note,
           nullif(btrim(e ->> 'option_id'), '') as option_id,
           m.id as found_id, m.category, m.price_halalas, m.is_available, m.is_archived, m.options
      from jsonb_array_elements(p_items) e
      left join public.menu_items m on m.id = (e ->> 'menu_item_id')::uuid
  loop
    if line.found_id is null or line.is_archived or not line.is_available then
      return jsonb_build_object('ok', false, 'code', 'ITEM_UNAVAILABLE', 'menu_item_id', line.menu_item_id);
    end if;
    -- Items with options (e.g. the coffee origin) need one that is in stock.
    if jsonb_array_length(line.options) > 0 then
      if line.option_id is null then
        return jsonb_build_object('ok', false, 'code', 'OPTION_REQUIRED', 'menu_item_id', line.menu_item_id);
      end if;
      if not exists (
        select 1 from jsonb_array_elements(line.options) o
         where o ->> 'id' = line.option_id and coalesce((o ->> 'is_available')::boolean, true)
      ) then
        return jsonb_build_object('ok', false, 'code', 'OPTION_UNAVAILABLE', 'menu_item_id', line.menu_item_id);
      end if;
    elsif line.option_id is not null then
      return jsonb_build_object('ok', false, 'code', 'OPTION_UNAVAILABLE', 'menu_item_id', line.menu_item_id);
    end if;
    if line.quantity is null or line.quantity < 1 or line.quantity > 20 then
      return jsonb_build_object('ok', false, 'code', 'TOO_MANY_ITEMS');
    end if;
    -- The discount (if any) comes off each unit, to the halala.
    pct := public.discount_percent_for(s, line.found_id, now());
    unit := case when pct is null then line.price_halalas else round(line.price_halalas * (100 - pct) / 100.0)::int end;
    subtotal := subtotal + unit * line.quantity;
    savings := savings + (line.price_halalas - unit) * line.quantity;
    total_qty := total_qty + line.quantity;
    if line.category = 'drink' then
      drink_qty := drink_qty + line.quantity;
      max_drink_price := greatest(max_drink_price, unit);
    end if;
  end loop;
  if total_qty > 40 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_ITEMS');
  end if;

  -- Counted items (a stock quantity is set): lock them, then the whole order
  -- must fit in what is left. The same item can be on several lines.
  perform 1 from public.menu_items
   where stock_quantity is not null
     and id in (select (e ->> 'menu_item_id')::uuid from jsonb_array_elements(p_items) e)
   order by id
     for update;
  for line in
    select m.id, m.stock_quantity, sum((e ->> 'quantity')::int) as wanted
      from jsonb_array_elements(p_items) e
      join public.menu_items m on m.id = (e ->> 'menu_item_id')::uuid
     where m.stock_quantity is not null
     group by m.id, m.stock_quantity
  loop
    if line.wanted > line.stock_quantity then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_STOCK', 'menu_item_id', line.id, 'remaining', line.stock_quantity);
    end if;
  end loop;

  if p_fulfillment = 'delivery' then
    if subtotal < s.delivery_min_order_halalas then
      return jsonb_build_object('ok', false, 'code', 'BELOW_MINIMUM', 'minimum', s.delivery_min_order_halalas);
    end if;
    fee := s.delivery_fee_halalas;
  end if;

  if p_use_reward then
    select * into acct from public.loyalty_accounts where user_id = p_customer_id for update;
    if not found or not acct.reward_available then
      return jsonb_build_object('ok', false, 'code', 'NO_REWARD');
    end if;
    if acct.membership_status = 'cancelled' then
      return jsonb_build_object('ok', false, 'code', 'MEMBERSHIP_CANCELLED');
    end if;
    if drink_qty = 0 then
      return jsonb_build_object('ok', false, 'code', 'REWARD_NEEDS_DRINK');
    end if;
    -- One free drink per reward: an open order already holding it blocks a second.
    if exists (select 1 from public.orders
                where customer_id = p_customer_id and use_reward
                  and status not in ('completed', 'cancelled')) then
      return jsonb_build_object('ok', false, 'code', 'REWARD_IN_USE');
    end if;
    -- The free drink is the most expensive drink in the order (at its discounted price).
    discount := max_drink_price;
  end if;

  insert into public.orders (
    customer_id, customer_name, customer_phone, fulfillment, car_description,
    delivery_address, delivery_lat, delivery_lng, note,
    subtotal_halalas, delivery_fee_halalas, discount_halalas, total_halalas,
    use_reward, idempotency_key, promo_percent, promo_savings_halalas
  ) values (
    p_customer_id, customer.display_name, p_phone, p_fulfillment,
    case when p_fulfillment = 'curbside' then nullif(btrim(p_car_description), '') end,
    case when p_fulfillment = 'delivery' then nullif(btrim(p_delivery_address), '') end,
    case when p_fulfillment = 'delivery' then p_delivery_lat end,
    case when p_fulfillment = 'delivery' then p_delivery_lng end,
    nullif(btrim(p_note), ''),
    subtotal, fee, discount, subtotal + fee - discount,
    coalesce(p_use_reward, false), p_idempotency_key,
    case when savings > 0 then s.discount_percent end, savings
  )
  returning id into v_order_id;

  for line in
    select (e ->> 'menu_item_id')::uuid as menu_item_id,
           (e ->> 'quantity')::int as quantity,
           nullif(btrim(e ->> 'note'), '') as note,
           opt ->> 'id' as option_id,
           opt ->> 'name_ar' as option_name_ar,
           m.id, m.name_ar, m.category, m.price_halalas, m.stock_quantity
      from jsonb_array_elements(p_items) with ordinality as x(e, n)
      join public.menu_items m on m.id = (e ->> 'menu_item_id')::uuid
      left join lateral (
        select o from jsonb_array_elements(m.options) o where o ->> 'id' = nullif(btrim(e ->> 'option_id'), '') limit 1
      ) chosen(opt) on true
     order by x.n
  loop
    pct := public.discount_percent_for(s, line.id, now());
    unit := case when pct is null then line.price_halalas else round(line.price_halalas * (100 - pct) / 100.0)::int end;
    insert into public.order_items (order_id, menu_item_id, name_ar, category, unit_price_halalas, list_price_halalas, quantity, note, option_id, option_name_ar, position, stock_taken)
    values (v_order_id, line.menu_item_id, line.name_ar, line.category, unit, case when unit <> line.price_halalas then line.price_halalas end,
            line.quantity, left(line.note, 120), line.option_id, left(line.option_name_ar, 40), pos, line.stock_quantity is not null);
    pos := pos + 1;
  end loop;

  -- Take the counted items out of stock (they come back if the order is cancelled).
  update public.menu_items m
     set stock_quantity = m.stock_quantity - t.qty
    from (select menu_item_id, sum(quantity) as qty from public.order_items
           where order_id = v_order_id and stock_taken group by menu_item_id) t
   where m.id = t.menu_item_id;

  return jsonb_build_object('ok', true, 'replayed', false, 'order_id', v_order_id);
end;
$$;

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
               'promo_percent', o.promo_percent,
               'promo_savings_halalas', o.promo_savings_halalas,
               'created_at', o.created_at,
               'items', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'menu_item_id', i.menu_item_id,
                          'name_ar', i.name_ar,
                          'category', i.category,
                          'unit_price_halalas', i.unit_price_halalas,
                          'list_price_halalas', i.list_price_halalas,
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

create or replace function public.order_history(
  p_from timestamptz,
  p_to timestamptz,
  p_status text,
  p_search text,
  p_limit int,
  p_offset int
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select nullif(lower(btrim(coalesce(p_search, ''))), '') as term,
           case when btrim(coalesce(p_search, '')) ~ '^#?[0-9]{1,12}$'
                then ltrim(btrim(p_search), '#')::bigint end as num
  ),
  base as (
    select o.*, a.id as account_id, a.member_id
      from public.orders o
      left join public.loyalty_accounts a on a.user_id = o.customer_id
      cross join q
     where (p_from is null or o.created_at >= p_from)
       and (p_to is null or o.created_at < p_to)
       and (q.term is null
            or o.order_number = q.num
            or position(q.term in lower(o.customer_name)) > 0
            or position(q.term in o.customer_phone) > 0
            or position(q.term in lower(coalesce(a.member_id, ''))) > 0)
  ),
  picked as (
    select *
      from base b
     where case coalesce(p_status, 'all')
             when 'active' then b.status not in ('completed', 'cancelled')
             when 'ended' then b.status in ('completed', 'cancelled')
             when 'completed' then b.status = 'completed'
             when 'cancelled' then b.status = 'cancelled'
             else true
           end
  )
  select jsonb_build_object(
    'counts', (
      select jsonb_build_object(
               'all', count(*),
               'active', count(*) filter (where b.status not in ('completed', 'cancelled')),
               'completed', count(*) filter (where b.status = 'completed'),
               'cancelled', count(*) filter (where b.status = 'cancelled')
             )
        from base b
    ),
    'total', (select count(*) from picked),
    'revenue_halalas', (select coalesce(sum(p.total_halalas), 0) from picked p where p.status = 'completed'),
    'items', (
      select coalesce(jsonb_agg(page.row_json order by page.created_at desc, page.order_number desc), '[]'::jsonb)
        from (
          select p.created_at,
                 p.order_number,
                 jsonb_build_object(
                   'id', p.id,
                   'order_number', p.order_number,
                   'customer_id', p.customer_id,
                   'account_id', p.account_id,
                   'customer_name', p.customer_name,
                   'customer_phone', p.customer_phone,
                   'member_id', p.member_id,
                   'fulfillment', p.fulfillment,
                   'car_description', p.car_description,
                   'delivery_address', p.delivery_address,
                   'delivery_lat', p.delivery_lat,
                   'delivery_lng', p.delivery_lng,
                   'note', p.note,
                   'subtotal_halalas', p.subtotal_halalas,
                   'delivery_fee_halalas', p.delivery_fee_halalas,
                   'discount_halalas', p.discount_halalas,
                   'total_halalas', p.total_halalas,
                   'payment_method', p.payment_method,
                   'use_reward', p.use_reward,
                   'status', p.status,
                   'cancel_reason', p.cancel_reason,
                   'cancelled_by', p.cancelled_by,
                   'customer_arrived_at', p.customer_arrived_at,
                   'accepted_at', p.accepted_at,
                   'ready_at', p.ready_at,
                   'out_for_delivery_at', p.out_for_delivery_at,
                   'completed_at', p.completed_at,
                   'completed_by_name', cb.display_name,
                   'cancelled_at', p.cancelled_at,
                   'loyalty_result', p.loyalty_result,
                   'rating', p.rating,
                   'rating_comment', p.rating_comment,
                   'rated_at', p.rated_at,
                   'promo_percent', p.promo_percent,
                   'promo_savings_halalas', p.promo_savings_halalas,
                   'created_at', p.created_at,
                   'items', (
                     select coalesce(jsonb_agg(jsonb_build_object(
                              'menu_item_id', i.menu_item_id,
                              'name_ar', i.name_ar,
                              'category', i.category,
                              'unit_price_halalas', i.unit_price_halalas,
                              'list_price_halalas', i.list_price_halalas,
                              'quantity', i.quantity,
                              'note', i.note,
                              'option_id', i.option_id,
                              'option_name_ar', i.option_name_ar
                            ) order by i.position), '[]'::jsonb)
                       from public.order_items i where i.order_id = p.id
                   )
                 ) as row_json
            from picked p
            left join public.profiles cb on cb.id = p.completed_by
           order by p.created_at desc, p.order_number desc
           limit least(greatest(coalesce(p_limit, 30), 1), 200)
          offset greatest(coalesce(p_offset, 0), 0)
        ) page
    )
  );
$$;
