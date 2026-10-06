-- =============================================================================
-- Menu options: a single choice per item, e.g. the coffee origin for V60
-- (Ethiopian, Brazilian, Costa Rican). Same price for every option; each can
-- be marked out of stock on its own. Orders keep a snapshot of the chosen one.
-- =============================================================================

alter table public.menu_items
  add column option_label text
    constraint menu_items_option_label_length check (option_label is null or char_length(btrim(option_label)) between 1 and 40),
  -- [{"id": "ethiopia", "name_ar": "إثيوبي", "note_ar": "…", "is_available": true}, ...]
  add column options jsonb not null default '[]'::jsonb
    constraint menu_items_options_shape check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 12);

alter table public.order_items
  add column option_id text
    constraint order_items_option_id_length check (option_id is null or char_length(option_id) <= 40),
  add column option_name_ar text
    constraint order_items_option_name_length check (option_name_ar is null or char_length(option_name_ar) <= 40);

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
    subtotal := subtotal + line.price_halalas * line.quantity;
    total_qty := total_qty + line.quantity;
    if line.category = 'drink' then
      drink_qty := drink_qty + line.quantity;
      max_drink_price := greatest(max_drink_price, line.price_halalas);
    end if;
  end loop;
  if total_qty > 40 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_ITEMS');
  end if;

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
    -- The free drink is the most expensive drink in the order.
    discount := max_drink_price;
  end if;

  insert into public.orders (
    customer_id, customer_name, customer_phone, fulfillment, car_description,
    delivery_address, delivery_lat, delivery_lng, note,
    subtotal_halalas, delivery_fee_halalas, discount_halalas, total_halalas,
    use_reward, idempotency_key
  ) values (
    p_customer_id, customer.display_name, p_phone, p_fulfillment,
    case when p_fulfillment = 'curbside' then nullif(btrim(p_car_description), '') end,
    case when p_fulfillment = 'delivery' then nullif(btrim(p_delivery_address), '') end,
    case when p_fulfillment = 'delivery' then p_delivery_lat end,
    case when p_fulfillment = 'delivery' then p_delivery_lng end,
    nullif(btrim(p_note), ''),
    subtotal, fee, discount, subtotal + fee - discount,
    coalesce(p_use_reward, false), p_idempotency_key
  )
  returning id into v_order_id;

  for line in
    select (e ->> 'menu_item_id')::uuid as menu_item_id,
           (e ->> 'quantity')::int as quantity,
           nullif(btrim(e ->> 'note'), '') as note,
           opt ->> 'id' as option_id,
           opt ->> 'name_ar' as option_name_ar,
           m.name_ar, m.category, m.price_halalas
      from jsonb_array_elements(p_items) with ordinality as x(e, n)
      join public.menu_items m on m.id = (e ->> 'menu_item_id')::uuid
      left join lateral (
        select o from jsonb_array_elements(m.options) o where o ->> 'id' = nullif(btrim(e ->> 'option_id'), '') limit 1
      ) chosen(opt) on true
     order by x.n
  loop
    insert into public.order_items (order_id, menu_item_id, name_ar, category, unit_price_halalas, quantity, note, option_id, option_name_ar, position)
    values (v_order_id, line.menu_item_id, line.name_ar, line.category, line.price_halalas, line.quantity, left(line.note, 120),
            line.option_id, left(line.option_name_ar, 40), pos);
    pos := pos + 1;
  end loop;

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

-- V60, hot and iced: choose the origin.
update public.menu_items
   set option_label = 'المحصول',
       options = '[
         {"id": "ethiopia", "name_ar": "إثيوبي", "note_ar": null, "is_available": true},
         {"id": "brazil", "name_ar": "برازيلي", "note_ar": null, "is_available": true},
         {"id": "costa-rica", "name_ar": "كوستاريكي", "note_ar": null, "is_available": true}
       ]'::jsonb
 where name_en in ('V60', 'Ice V60');
