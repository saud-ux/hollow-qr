-- =============================================================================
-- On Supabase, requests through PostgREST run with pg-safeupdate, which refuses
-- a DELETE (or UPDATE) without a WHERE clause: «DELETE requires a WHERE clause».
-- Two functions cleared a whole table that way, so on the hosted database:
--   - reset_shop_data (البدء من جديد) failed with an unexpected error;
--   - benefits('save_gift_items') could not save the gift coffees.
-- Each now says "where true": the same rows, written so the guard lets it run.
-- (The tests' database has no such guard; tests/integration/database.test.ts
-- now checks that no function writes a DELETE or UPDATE without a WHERE.)
-- =============================================================================

create or replace function public.reset_shop_data(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_orders integer;
  v_serials text[];
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin' and disabled_at is null) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  -- No order can be placed or moved while the reset runs.
  lock table public.orders in exclusive mode;
  if exists (select 1 from public.orders where status not in ('completed', 'cancelled')) then
    return jsonb_build_object('ok', false, 'code', 'OPEN_ORDERS');
  end if;
  if exists (select 1 from public.wallet_topups where credited_at is not null) then
    return jsonb_build_object('ok', false, 'code', 'PAID_BALANCE');
  end if;

  select count(*) into v_orders from public.orders;
  select coalesce(array_agg(pass_serial), '{}') into v_serials
    from public.loyalty_accounts where stamp_count > 0 or reward_available;

  insert into public.data_resets (reset_by, orders, snapshot)
  values (p_actor, v_orders, jsonb_build_object(
    'orders', (select coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.orders o),
    'order_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from public.order_items i),
    'coupon_uses', (select coalesce(jsonb_agg(to_jsonb(u)), '[]') from public.coupon_uses u),
    'benefit_movements', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.benefit_movements m),
    'benefit_accounts', (select coalesce(jsonb_agg(to_jsonb(b)), '[]') from public.benefit_accounts b
                          where b.balance_halalas > 0 or b.gift_cups > 0),
    'loyalty_transactions', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.loyalty_transactions t),
    'loyalty_accounts', (select coalesce(jsonb_agg(jsonb_build_object(
                            'id', a.id, 'stamp_count', a.stamp_count, 'reward_available', a.reward_available,
                            'last_mutation_at', a.last_mutation_at)), '[]')
                          from public.loyalty_accounts a where a.stamp_count > 0 or a.reward_available),
    'last_order_number', (select last_value from public.orders_order_number_seq)
  ));

  -- The cup history is append-only; only this reset may clear it.
  alter table public.loyalty_transactions disable trigger loyalty_transactions_no_delete;
  delete from public.loyalty_transactions where true;
  alter table public.loyalty_transactions enable trigger loyalty_transactions_no_delete;

  delete from public.coupon_uses where true;
  delete from public.benefit_movements where true;
  delete from public.orders where true; -- items and live activities go with them
  update public.benefit_accounts set balance_halalas = 0, gift_cups = 0
   where balance_halalas > 0 or gift_cups > 0;
  update public.loyalty_accounts
     set stamp_count = 0, reward_available = false, last_mutation_at = null, wallet_updated_at = clock_timestamp()
   where stamp_count > 0 or reward_available;
  perform setval('public.orders_order_number_seq', 1, false);
  perform setval('public.loyalty_transactions_seq_seq', 1, false);

  return jsonb_build_object('ok', true, 'orders', v_orders, 'passSerials', to_jsonb(v_serials));
end $$;

-- benefits_v1 is long and otherwise unchanged: only its one bare DELETE is rewritten.
do $$
declare
  def text := pg_get_functiondef('public.benefits_v1(text,uuid,jsonb)'::regprocedure);
  bare constant text := 'delete from public.gift_coffee_items;';
begin
  if position(bare in def) = 0 then
    raise exception 'benefits_v1 no longer has %', bare;
  end if;
  execute replace(def, bare, 'delete from public.gift_coffee_items where true;');
end $$;
