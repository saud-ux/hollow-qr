-- =============================================================================
-- A customer can have at most two open orders (new, preparing, ready or out for
-- delivery) at a time. Orders are paid on pickup, so this keeps one account
-- from filling the order board or holding back counted stock.
--
-- The existing routine is renamed and wrapped, so both ways of placing an order
-- (place_order directly, and benefits('place') with balance, gift cups or a
-- coupon) go through the check. A retried request for an order that already
-- exists is replayed as before, whatever the count.
-- The limit is shop_settings.max_open_orders (null means no limit).
-- =============================================================================

alter table public.shop_settings
  add column max_open_orders int default 2
    constraint shop_settings_max_open_orders check (max_open_orders is null or max_open_orders >= 1);

alter function public.place_order(
  uuid, jsonb, public.fulfillment_type, text, text, text,
  double precision, double precision, text, boolean, uuid, text
) rename to place_order_unlimited;

revoke execute on function public.place_order_unlimited(
  uuid, jsonb, public.fulfillment_type, text, text, text,
  double precision, double precision, text, boolean, uuid, text
) from public, anon, authenticated;

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
begin
  if p_idempotency_key is null
     or not exists (select 1 from public.orders where idempotency_key = p_idempotency_key) then
    -- Two requests from the same customer at once are counted one after the other.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('place_order:' || p_customer_id::text, 0));
    if (select count(*) from public.orders
         where customer_id = p_customer_id
           and status in ('new', 'preparing', 'ready', 'out_for_delivery'))
       >= (select max_open_orders from public.shop_settings where id = 1) then
      return jsonb_build_object('ok', false, 'code', 'TOO_MANY_OPEN_ORDERS');
    end if;
  end if;
  return public.place_order_unlimited(
    p_customer_id, p_items, p_fulfillment, p_phone, p_car_description, p_delivery_address,
    p_delivery_lat, p_delivery_lng, p_note, p_use_reward, p_idempotency_key, p_time_zone
  );
end;
$$;

revoke execute on function public.place_order(
  uuid, jsonb, public.fulfillment_type, text, text, text,
  double precision, double precision, text, boolean, uuid, text
) from public, anon, authenticated;
grant execute on function public.place_order(
  uuid, jsonb, public.fulfillment_type, text, text, text,
  double precision, double precision, text, boolean, uuid, text
) to service_role;
