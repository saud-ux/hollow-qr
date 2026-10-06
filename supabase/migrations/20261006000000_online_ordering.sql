-- =============================================================================
-- HOLLOW online ordering
--
-- Design notes
--   * Customers order from the menu; prices, availability, opening hours and
--     fees are always computed here, never trusted from the client.
--   * Orders are paid on pickup / delivery for now (payment_method), so no
--     card data ever touches the database.
--   * Completing an order applies loyalty through apply_loyalty_action(), the
--     same audited path staff use in store: drinks earn cups, and an order that
--     used the free drink redeems the reward.
--   * Browser roles get no grants: everything goes through the Worker with the
--     service-role key, exactly like the loyalty tables.
-- =============================================================================

create type public.menu_category as enum ('drink', 'dessert');
create type public.order_status as enum ('new', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled');
create type public.fulfillment_type as enum ('pickup', 'curbside', 'delivery');

-- ---------------------------------------------------------------------------
-- menu_items
-- ---------------------------------------------------------------------------
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null
    constraint menu_items_name_ar_length check (char_length(btrim(name_ar)) between 1 and 60),
  name_en text
    constraint menu_items_name_en_length check (name_en is null or char_length(name_en) <= 60),
  description_ar text
    constraint menu_items_description_length check (description_ar is null or char_length(description_ar) <= 200),
  category public.menu_category not null,
  -- Money is stored in halalas (1 SAR = 100) to avoid floating point.
  price_halalas int not null
    constraint menu_items_price_range check (price_halalas between 0 and 100000),
  -- Object path inside the public "menu-images" storage bucket.
  image_path text
    constraint menu_items_image_path_format check (image_path is null or image_path ~ '^[a-z0-9/_.-]{1,200}$'),
  -- Temporarily sold out (still listed, cannot be ordered).
  is_available boolean not null default true,
  -- Archived items disappear from the menu but stay referenced by old orders.
  is_archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index menu_items_listing_idx on public.menu_items (is_archived, category, sort_order);

create trigger menu_items_touch before update on public.menu_items
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- shop_settings: exactly one row
-- ---------------------------------------------------------------------------
create table public.shop_settings (
  id smallint primary key default 1 constraint shop_settings_singleton check (id = 1),
  -- Manual switch (busy hours, closing early). Starts paused so nothing goes
  -- live before the admin reviews the menu and hours.
  ordering_paused boolean not null default true,
  pickup_enabled boolean not null default true,
  curbside_enabled boolean not null default true,
  delivery_enabled boolean not null default true,
  delivery_fee_halalas int not null default 1500
    constraint shop_settings_delivery_fee_range check (delivery_fee_halalas between 0 and 100000),
  delivery_min_order_halalas int not null default 0
    constraint shop_settings_delivery_min_range check (delivery_min_order_halalas between 0 and 1000000),
  -- Seven entries, index 0 = Sunday (matches extract(dow)):
  -- {"closed": bool, "open": "HH:MM", "close": "HH:MM"}. close <= open means
  -- the shift runs past midnight.
  weekly_hours jsonb not null default '[
    {"closed": false, "open": "07:00", "close": "23:00"},
    {"closed": false, "open": "07:00", "close": "23:00"},
    {"closed": false, "open": "07:00", "close": "23:00"},
    {"closed": false, "open": "07:00", "close": "23:00"},
    {"closed": false, "open": "07:00", "close": "23:00"},
    {"closed": false, "open": "07:00", "close": "23:00"},
    {"closed": false, "open": "07:00", "close": "23:00"}
  ]'::jsonb
    constraint shop_settings_weekly_hours_shape check (jsonb_typeof(weekly_hours) = 'array' and jsonb_array_length(weekly_hours) = 7),
  updated_at timestamptz not null default now()
);

insert into public.shop_settings (id) values (1);

create trigger shop_settings_touch before update on public.shop_settings
  for each row execute function public.touch_updated_at();

-- True when the shop accepts orders right now (hours + manual pause).
create function public.shop_is_open(p_at timestamptz default now(), p_time_zone text default 'Asia/Riyadh')
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  s public.shop_settings;
  local_ts timestamp := p_at at time zone p_time_zone;
  t time := local_ts::time;
  dow int := extract(dow from local_ts)::int;
  today jsonb;
  yesterday jsonb;
begin
  select * into s from public.shop_settings where id = 1;
  if not found or s.ordering_paused then
    return false;
  end if;
  today := s.weekly_hours -> dow;
  yesterday := s.weekly_hours -> ((dow + 6) % 7);

  if not coalesce((today ->> 'closed')::boolean, true) then
    if (today ->> 'close')::time > (today ->> 'open')::time then
      if t >= (today ->> 'open')::time and t < (today ->> 'close')::time then
        return true;
      end if;
    elsif t >= (today ->> 'open')::time then
      -- Overnight shift that started today.
      return true;
    end if;
  end if;

  -- Overnight shift that started yesterday and is still running.
  if not coalesce((yesterday ->> 'closed')::boolean, true)
     and (yesterday ->> 'close')::time <= (yesterday ->> 'open')::time
     and t < (yesterday ->> 'close')::time then
    return true;
  end if;

  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- orders & order_items
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Short number staff call out ("طلب 1042").
  order_number bigint generated always as identity (start with 1001) unique,
  customer_id uuid not null references public.profiles (id) on delete restrict,
  customer_name text not null
    constraint orders_customer_name_length check (char_length(customer_name) between 1 and 80),
  customer_phone text not null
    constraint orders_customer_phone_format check (customer_phone ~ '^05[0-9]{8}$'),
  fulfillment public.fulfillment_type not null,
  car_description text
    constraint orders_car_length check (car_description is null or char_length(car_description) between 1 and 80),
  delivery_address text
    constraint orders_address_length check (delivery_address is null or char_length(delivery_address) between 1 and 300),
  delivery_lat double precision
    constraint orders_lat_range check (delivery_lat is null or delivery_lat between -90 and 90),
  delivery_lng double precision
    constraint orders_lng_range check (delivery_lng is null or delivery_lng between -180 and 180),
  note text
    constraint orders_note_length check (note is null or char_length(note) <= 300),
  subtotal_halalas int not null constraint orders_subtotal_range check (subtotal_halalas >= 0),
  delivery_fee_halalas int not null default 0 constraint orders_delivery_fee_range check (delivery_fee_halalas >= 0),
  discount_halalas int not null default 0 constraint orders_discount_range check (discount_halalas >= 0),
  total_halalas int not null constraint orders_total_range check (total_halalas >= 0),
  payment_method text not null default 'on_pickup'
    constraint orders_payment_method check (payment_method in ('on_pickup')),
  use_reward boolean not null default false,
  status public.order_status not null default 'new',
  cancel_reason text
    constraint orders_cancel_reason_length check (cancel_reason is null or char_length(cancel_reason) <= 200),
  cancelled_by text
    constraint orders_cancelled_by check (cancelled_by is null or cancelled_by in ('customer', 'staff')),
  customer_arrived_at timestamptz,
  accepted_at timestamptz,
  ready_at timestamptz,
  out_for_delivery_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  completed_by uuid references public.profiles (id) on delete restrict,
  -- What completing the order did to the loyalty card (for staff and audits).
  loyalty_result jsonb,
  -- Idempotency keys for the loyalty mutations made on completion.
  loyalty_redeem_key uuid not null default gen_random_uuid(),
  loyalty_add_key uuid not null default gen_random_uuid(),
  idempotency_key uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_matches check (total_halalas = subtotal_halalas + delivery_fee_halalas - discount_halalas),
  constraint orders_curbside_car check (fulfillment <> 'curbside' or car_description is not null),
  constraint orders_delivery_address check (fulfillment <> 'delivery' or delivery_address is not null),
  constraint orders_coordinates_pair check ((delivery_lat is null) = (delivery_lng is null))
);

create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_active_idx on public.orders (created_at) where status not in ('completed', 'cancelled');
create index orders_created_at_idx on public.orders (created_at desc);

create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id) on delete restrict,
  -- Snapshots: later menu edits never change a placed order.
  name_ar text not null,
  category public.menu_category not null,
  unit_price_halalas int not null constraint order_items_price_range check (unit_price_halalas >= 0),
  quantity smallint not null constraint order_items_quantity_range check (quantity between 1 and 20),
  note text constraint order_items_note_length check (note is null or char_length(note) <= 120),
  position smallint not null default 0
);

create index order_items_order_idx on public.order_items (order_id, position);

-- ---------------------------------------------------------------------------
-- place_order
--
-- p_items: [{"menu_item_id": uuid, "quantity": 1..20, "note": text|null}, ...]
-- Returns {"ok": true, "order_id": ...} or {"ok": false, "code": ...}.
-- Codes: NOT_FOUND, SHOP_CLOSED, FULFILLMENT_UNAVAILABLE, EMPTY_ORDER,
--        ITEM_UNAVAILABLE, TOO_MANY_ITEMS, BELOW_MINIMUM, NO_REWARD,
--        REWARD_NEEDS_DRINK, REWARD_IN_USE, MEMBERSHIP_CANCELLED,
--        IDEMPOTENCY_CONFLICT
-- ---------------------------------------------------------------------------
create function public.place_order(
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
           m.id as found_id, m.category, m.price_halalas, m.is_available, m.is_archived
      from jsonb_array_elements(p_items) e
      left join public.menu_items m on m.id = (e ->> 'menu_item_id')::uuid
  loop
    if line.found_id is null or line.is_archived or not line.is_available then
      return jsonb_build_object('ok', false, 'code', 'ITEM_UNAVAILABLE', 'menu_item_id', line.menu_item_id);
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
           m.name_ar, m.category, m.price_halalas
      from jsonb_array_elements(p_items) with ordinality as x(e, n)
      join public.menu_items m on m.id = (e ->> 'menu_item_id')::uuid
     order by x.n
  loop
    insert into public.order_items (order_id, menu_item_id, name_ar, category, unit_price_halalas, quantity, note, position)
    values (v_order_id, line.menu_item_id, line.name_ar, line.category, line.price_halalas, line.quantity, left(line.note, 120), pos);
    pos := pos + 1;
  end loop;

  return jsonb_build_object('ok', true, 'replayed', false, 'order_id', v_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_order_status (staff / admin)
--
-- Allowed moves: new -> preparing -> ready -> [out_for_delivery ->] completed,
-- and any open order -> cancelled. Completing applies loyalty in the same
-- transaction. Codes: FORBIDDEN, NOT_FOUND, INVALID_TRANSITION.
-- ---------------------------------------------------------------------------
create function public.set_order_status(
  p_actor_id uuid,
  p_order_id uuid,
  p_status public.order_status,
  p_cancel_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_stamps constant int := 5;
  actor public.profiles;
  o public.orders;
  acct public.loyalty_accounts;
  allowed boolean;
  drinks int;
  eligible int;
  room int;
  res jsonb;
  redeem_code text := null;
  cups_added int := 0;
  changed boolean := false;
  v_pass_serial uuid := null;
  now_ts timestamptz := now();
begin
  select * into actor from public.profiles where id = p_actor_id and disabled_at is null;
  if not found or actor.role not in ('staff', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  allowed := case
    when p_status = 'cancelled' then o.status not in ('completed', 'cancelled')
    when p_status = 'preparing' then o.status = 'new'
    when p_status = 'ready' then o.status = 'preparing'
    when p_status = 'out_for_delivery' then o.status = 'ready' and o.fulfillment = 'delivery'
    when p_status = 'completed' then
      (o.status = 'ready' and o.fulfillment <> 'delivery') or o.status = 'out_for_delivery'
    else false
  end;
  if not allowed then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'current', o.status);
  end if;

  if p_status = 'completed' then
    select * into acct from public.loyalty_accounts where user_id = o.customer_id;
    if found and acct.membership_status = 'active' then
      v_pass_serial := acct.pass_serial;

      if o.use_reward then
        res := public.apply_loyalty_action(p_actor_id, acct.id, 'REDEEM_REWARD', null, null,
                                           o.loyalty_redeem_key, true, 0, 'app_order');
        if (res ->> 'ok')::boolean then
          redeem_code := 'REDEEMED';
          changed := changed or not coalesce((res ->> 'replayed')::boolean, false);
        else
          -- The reward was used in store meanwhile: staff are told on screen.
          redeem_code := coalesce(res ->> 'code', 'FAILED');
        end if;
      end if;

      select coalesce(sum(quantity), 0) into drinks
        from public.order_items where order_id = o.id and category = 'drink';
      eligible := drinks - case when o.use_reward then 1 else 0 end;

      select * into acct from public.loyalty_accounts where id = acct.id;
      room := case when acct.reward_available then 0 else max_stamps - acct.stamp_count end;
      if eligible > 0 and room > 0 then
        res := public.apply_loyalty_action(p_actor_id, acct.id, 'ADD_CUPS', least(eligible, room), null,
                                           o.loyalty_add_key, true, 0, 'app_order');
        if (res ->> 'ok')::boolean then
          cups_added := least(eligible, room);
          changed := changed or not coalesce((res ->> 'replayed')::boolean, false);
        end if;
      end if;

      o.loyalty_result := jsonb_build_object(
        'redeem', redeem_code,
        'cups_added', cups_added,
        'cups_not_added', greatest(eligible - cups_added, 0)
      );
    else
      o.loyalty_result := jsonb_build_object('redeem', null, 'cups_added', 0, 'cups_not_added', 0, 'skipped', true);
    end if;
  end if;

  update public.orders
     set status = p_status,
         accepted_at = case when p_status = 'preparing' then now_ts else accepted_at end,
         ready_at = case when p_status = 'ready' then now_ts else ready_at end,
         out_for_delivery_at = case when p_status = 'out_for_delivery' then now_ts else out_for_delivery_at end,
         completed_at = case when p_status = 'completed' then now_ts else completed_at end,
         completed_by = case when p_status = 'completed' then p_actor_id else completed_by end,
         cancelled_at = case when p_status = 'cancelled' then now_ts else cancelled_at end,
         cancelled_by = case when p_status = 'cancelled' then 'staff' else cancelled_by end,
         cancel_reason = case when p_status = 'cancelled' then nullif(btrim(left(p_cancel_reason, 200)), '') else cancel_reason end,
         loyalty_result = case when p_status = 'completed' then o.loyalty_result else loyalty_result end
   where id = o.id;

  return jsonb_build_object(
    'ok', true,
    'order_id', o.id,
    'status', p_status,
    'loyalty_changed', changed,
    'pass_serial', case when changed then v_pass_serial end
  );
end;
$$;

-- Customer actions on their own order. Codes: NOT_FOUND, INVALID_TRANSITION.
create function public.customer_order_action(p_customer_id uuid, p_order_id uuid, p_action text)
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

  if p_action = 'cancel' then
    -- Only before the barista starts on it.
    if o.status <> 'new' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'current', o.status);
    end if;
    update public.orders
       set status = 'cancelled', cancelled_at = now(), cancelled_by = 'customer'
     where id = o.id;
  elsif p_action = 'arrived' then
    if o.fulfillment <> 'curbside' or o.status in ('completed', 'cancelled') then
      return jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'current', o.status);
    end if;
    update public.orders set customer_arrived_at = coalesce(customer_arrived_at, now()) where id = o.id;
  else
    return jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION');
  end if;

  return jsonb_build_object('ok', true, 'order_id', o.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- list_orders: one JSON read model shared by the customer and staff screens.
--   p_customer_id  only this customer's orders (null = everyone, staff)
--   p_order_id     a single order
--   p_scope        'active' (open orders + anything closed in the last
--                  p_recent_minutes) or 'all'
-- ---------------------------------------------------------------------------
create function public.list_orders(
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
                          'note', i.note
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

-- ---------------------------------------------------------------------------
-- Starting menu (prices in halalas). The admin edits everything from the
-- dashboard afterwards.
-- ---------------------------------------------------------------------------
insert into public.menu_items (name_ar, name_en, category, price_halalas, sort_order) values
  ('قهوة مقطرة', 'V60', 'drink', 1500, 10),
  ('قهوة مقطرة باردة', 'Ice V60', 'drink', 1600, 20),
  ('قهوة اليوم حارة', 'Hot Coffee Day', 'drink', 800, 30),
  ('قهوة اليوم باردة', 'Ice Coffee Day', 'drink', 800, 40),
  ('ماتشا باردة', 'Ice Matcha', 'drink', 2100, 50),
  ('كركدية بارد', 'Ice Karkade', 'drink', 1400, 60),
  ('كلاودي كركدية', 'Cloudy Karkade', 'drink', 1500, 70),
  ('وافل بيكان', 'Waffle Pecan', 'dessert', 1500, 110),
  ('وافل دبس التمر', 'Date Molasses Waffle', 'dessert', 1500, 120),
  ('كيكة تشوكلت', 'Chocolate Cake', 'dessert', 1800, 130),
  ('تشيز كيك بيكان', 'Pecan Cheesecake', 'dessert', 1800, 140),
  ('بابكا', 'Babka', 'dessert', 1200, 150);

-- ---------------------------------------------------------------------------
-- Menu images: a public-read Supabase Storage bucket. Uploads happen only in
-- the Worker with the service-role key. Skipped where Storage does not exist
-- (local tests).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('menu-images', 'menu-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security & privileges: server only.
-- ---------------------------------------------------------------------------
alter table public.menu_items enable row level security;
alter table public.shop_settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on table public.menu_items, public.shop_settings, public.orders, public.order_items
  from anon, authenticated;
grant all on table public.menu_items, public.shop_settings, public.orders, public.order_items to service_role;

revoke execute on function
  public.shop_is_open(timestamptz, text),
  public.place_order(uuid, jsonb, public.fulfillment_type, text, text, text, double precision, double precision, text, boolean, uuid, text),
  public.set_order_status(uuid, uuid, public.order_status, text),
  public.customer_order_action(uuid, uuid, text),
  public.list_orders(uuid, uuid, text, int, int)
from public, anon, authenticated;

grant execute on function
  public.shop_is_open(timestamptz, text),
  public.place_order(uuid, jsonb, public.fulfillment_type, text, text, text, double precision, double precision, text, boolean, uuid, text),
  public.set_order_status(uuid, uuid, public.order_status, text),
  public.customer_order_action(uuid, uuid, text),
  public.list_orders(uuid, uuid, text, int, int)
to service_role;
