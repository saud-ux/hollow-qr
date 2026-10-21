-- =============================================================================
-- «البدء من جديد»: the owner clears every order and resets every loyalty card,
-- balance and gift to zero, then order numbers start again at 1. Accounts,
-- saved places, the menu, coupons and settings stay as they are.
--
-- Everything cleared is copied into data_resets first, so a reset can be
-- looked into or undone by hand. The reset refuses while an order is open,
-- and once any customer has topped up with real money: paid balances are
-- never wiped.
-- =============================================================================

create table public.data_resets (
  id uuid primary key default gen_random_uuid(),
  reset_by uuid references public.profiles (id) on delete set null,
  reset_at timestamptz not null default now(),
  orders integer not null,
  snapshot jsonb not null
);

alter table public.data_resets enable row level security;
revoke all on public.data_resets from anon, authenticated;
grant all on public.data_resets to service_role;

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
  delete from public.loyalty_transactions;
  alter table public.loyalty_transactions enable trigger loyalty_transactions_no_delete;

  delete from public.coupon_uses;
  delete from public.benefit_movements;
  delete from public.orders; -- items and live activities go with them
  update public.benefit_accounts set balance_halalas = 0, gift_cups = 0
   where balance_halalas > 0 or gift_cups > 0;
  update public.loyalty_accounts
     set stamp_count = 0, reward_available = false, last_mutation_at = null, wallet_updated_at = clock_timestamp()
   where stamp_count > 0 or reward_available;
  perform setval('public.orders_order_number_seq', 1, false);
  perform setval('public.loyalty_transactions_seq_seq', 1, false);

  return jsonb_build_object('ok', true, 'orders', v_orders, 'passSerials', to_jsonb(v_serials));
end $$;

revoke execute on function public.reset_shop_data(uuid) from public, anon, authenticated;
grant execute on function public.reset_shop_data(uuid) to service_role;
