-- Keep anonymized accounting records while actually deleting Supabase Auth.
-- The original profiles.id FK would cascade into RESTRICTed sales/loyalty
-- records. A nullable identity link preserves those records without retaining
-- a sign-in account. Normal profile creation must still reference Auth.
alter table public.profiles add column auth_user_id uuid;
update public.profiles set auth_user_id = id;
alter table public.profiles
  add constraint profiles_auth_user_id_key unique (auth_user_id),
  add constraint profiles_auth_user_id_fkey foreign key (auth_user_id)
    references auth.users(id) on delete set null,
  add constraint profiles_identity_state check (
    (auth_user_id is not null and auth_user_id = id)
    or (auth_user_id is null and disabled_at is not null)
  );
alter table public.profiles drop constraint profiles_id_fkey;

create function public.attach_profile_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.auth_user_id := new.id;
  return new;
end;
$$;
create trigger profiles_attach_identity before insert on public.profiles
  for each row execute function public.attach_profile_identity();
revoke execute on function public.attach_profile_identity() from public, anon, authenticated;

-- Never repopulate an anonymized profile if Auth retries an email update.
create or replace function public.handle_auth_user_updated()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles
     set email = lower(coalesce(new.email, '')),
         email_confirmed_at = new.email_confirmed_at
   where id = new.id and disabled_at is null
     and (email is distinct from lower(coalesce(new.email, ''))
          or email_confirmed_at is distinct from new.email_confirmed_at);
  return new;
end;
$$;

-- The request is committed with anonymization. A transient Auth/API failure
-- must not strand a now-disabled customer with no way to retry deletion.
create table public.account_deletion_requests (
  user_id uuid primary key references public.profiles(id),
  requested_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  completed_at timestamptz
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;
grant all on public.account_deletion_requests to service_role;
create index account_deletion_pending_idx on public.account_deletion_requests(last_attempt_at)
  where completed_at is null;

-- Finish earlier explicit deletions too; never queue ordinary disabled staff.
insert into public.account_deletion_requests(user_id)
  select id from public.profiles
   where role = 'customer' and disabled_at is not null and display_name = 'حساب محذوف';
update public.profiles set email = '', email_confirmed_at = null
 where role = 'customer' and disabled_at is not null and display_name = 'حساب محذوف';

create or replace function public.delete_customer_account(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = p_user_id for update;
  if not found or p.disabled_at is not null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if p.role <> 'customer' then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_CUSTOMER');
  end if;
  if exists (select 1 from public.orders where customer_id = p_user_id
             and status in ('preparing', 'ready', 'out_for_delivery')) then
    return jsonb_build_object('ok', false, 'code', 'ACTIVE_ORDER');
  end if;

  -- Existing cancellation trigger refunds wallet/gifts exactly once. Keep
  -- the financial ledger and balance, never silently forfeit customer funds.
  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'customer'
   where customer_id = p_user_id and status = 'new';
  update public.orders
     set customer_name = 'حساب محذوف', customer_phone = '0500000000',
         car_description = case when fulfillment = 'curbside' then '-' end,
         delivery_address = case when fulfillment = 'delivery' then '-' end,
         delivery_lat = null, delivery_lng = null, note = null,
         rating_comment = null, cancel_reason = null
   where customer_id = p_user_id;
  update public.order_items i set note = null
    from public.orders o where o.id = i.order_id and o.customer_id = p_user_id;
  update public.benefit_movements set reason = 'عملية لحساب محذوف'
   where customer_id = p_user_id;
  update public.loyalty_accounts
     set membership_status = 'cancelled', stamp_count = 0, reward_available = false,
         cancelled_at = coalesce(cancelled_at, now()), wallet_updated_at = clock_timestamp()
   where user_id = p_user_id;
  delete from public.push_devices where user_id = p_user_id;
  delete from public.live_activities where order_id in
    (select id from public.orders where customer_id = p_user_id);
  delete from public.notification_prefs where user_id = p_user_id;
  -- The existing profiles_forget_places trigger removes saved addresses.
  update public.profiles
     set display_name = 'حساب محذوف', email = '', email_confirmed_at = null,
         disabled_at = now()
   where id = p_user_id;
  insert into public.account_deletion_requests(user_id) values(p_user_id)
    on conflict(user_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.delete_customer_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_customer_account(uuid) to service_role;
