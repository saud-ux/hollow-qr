-- Stock counts: the owner (or staff) sets how many of an item are left, e.g.
-- 6 waffles. Each order takes its quantity out the moment it is placed, a
-- cancelled order puts it back, and at 0 the item can't be ordered until more
-- is added. Items without a count (null) are not counted.

alter table public.menu_items
  add column stock_quantity integer
    constraint menu_items_stock_range check (stock_quantity is null or stock_quantity between 0 and 9999);

-- Which lines took stock, so a cancellation returns exactly that.
alter table public.order_items
  add column stock_taken boolean not null default false;

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
           m.name_ar, m.category, m.price_halalas, m.stock_quantity
      from jsonb_array_elements(p_items) with ordinality as x(e, n)
      join public.menu_items m on m.id = (e ->> 'menu_item_id')::uuid
      left join lateral (
        select o from jsonb_array_elements(m.options) o where o ->> 'id' = nullif(btrim(e ->> 'option_id'), '') limit 1
      ) chosen(opt) on true
     order by x.n
  loop
    insert into public.order_items (order_id, menu_item_id, name_ar, category, unit_price_halalas, quantity, note, option_id, option_name_ar, position, stock_taken)
    values (v_order_id, line.menu_item_id, line.name_ar, line.category, line.price_halalas, line.quantity, left(line.note, 120),
            line.option_id, left(line.option_name_ar, 40), pos, line.stock_quantity is not null);
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

-- A cancelled order puts its counted items back (customer, staff or account deletion).
create function public.restock_cancelled_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.menu_items m
     set stock_quantity = least(m.stock_quantity + t.qty, 9999)
    from (select menu_item_id, sum(quantity) as qty from public.order_items
           where order_id = new.id and stock_taken group by menu_item_id) t
   where m.id = t.menu_item_id and m.stock_quantity is not null;
  update public.order_items set stock_taken = false where order_id = new.id and stock_taken;
  return new;
end;
$$;

create trigger orders_restock_on_cancel
  after update of status on public.orders
  for each row
  when (new.status = 'cancelled' and old.status <> 'cancelled')
  execute function public.restock_cancelled_order();

revoke execute on function public.restock_cancelled_order() from public, anon, authenticated;
