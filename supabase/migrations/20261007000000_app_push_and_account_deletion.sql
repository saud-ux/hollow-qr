-- =============================================================================
-- iOS app support
--   * push_devices: APNs device tokens for order-status notifications.
--   * delete_customer_account(): App Store guideline 5.1.1(v) requires in-app
--     account deletion. Loyalty transactions and orders are kept for the
--     shop's records but stripped of personal data; the profile is disabled.
-- =============================================================================

create table public.push_devices (
  token text primary key
    constraint push_devices_token_format check (token ~ '^[0-9a-f]{64,200}$'),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null default 'ios'
    constraint push_devices_platform check (platform in ('ios')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_devices_user_idx on public.push_devices (user_id);

create trigger push_devices_touch before update on public.push_devices
  for each row execute function public.touch_updated_at();

alter table public.push_devices enable row level security;
revoke all on table public.push_devices from anon, authenticated;
grant all on table public.push_devices to service_role;

-- Anonymizes a customer. Returns {"ok": true} or {"ok": false, "code": ...}.
-- Codes: NOT_FOUND, NOT_A_CUSTOMER, ACTIVE_ORDER (an order is being prepared
-- or delivered: the café still needs the name, phone and address).
create function public.delete_customer_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  acct public.loyalty_accounts;
begin
  select * into p from public.profiles where id = p_user_id for update;
  if not found or p.disabled_at is not null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if p.role <> 'customer' then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_CUSTOMER');
  end if;

  if exists (
    select 1 from public.orders
     where customer_id = p_user_id and status in ('preparing', 'ready', 'out_for_delivery')
  ) then
    return jsonb_build_object('ok', false, 'code', 'ACTIVE_ORDER');
  end if;

  -- Open orders the café has not started are withdrawn.
  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'customer'
   where customer_id = p_user_id and status = 'new';

  update public.orders
     set customer_name = 'حساب محذوف',
         customer_phone = '0500000000',
         car_description = case when fulfillment = 'curbside' then '-' end,
         delivery_address = case when fulfillment = 'delivery' then '-' end,
         delivery_lat = null,
         delivery_lng = null,
         note = null
   where customer_id = p_user_id;
  update public.order_items i
     set note = null
    from public.orders o
   where o.id = i.order_id and o.customer_id = p_user_id;

  -- Wallet registrations stay so the pass refreshes into its voided state;
  -- Wallet unregisters on its own when the customer removes the pass.
  select * into acct from public.loyalty_accounts where user_id = p_user_id for update;
  if found then
    update public.loyalty_accounts
       set membership_status = 'cancelled',
           cancelled_at = coalesce(cancelled_at, now()),
           wallet_updated_at = clock_timestamp()
     where id = acct.id;
  end if;

  delete from public.push_devices where user_id = p_user_id;

  update public.profiles
     set display_name = 'حساب محذوف',
         email = '',
         disabled_at = now()
   where id = p_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.delete_customer_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_customer_account(uuid) to service_role;
