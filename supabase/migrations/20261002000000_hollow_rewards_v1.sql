-- =============================================================================
-- HOLLOW Rewards — Version 1 schema
--
-- Design notes
--   * Supabase Auth (auth.users) owns identities and passwords. We never store
--     passwords. Every auth user gets exactly one row in public.profiles.
--   * Customers get exactly one public.loyalty_accounts row (unique user_id).
--   * public.loyalty_transactions is an append-only audit log. Rows can never be
--     deleted, and the only permitted UPDATE is linking an original row to the
--     UNDO row that reversed it.
--   * All loyalty mutations go through public.apply_loyalty_action(), which
--     locks the account row (SELECT ... FOR UPDATE) so concurrent staff
--     submissions can never corrupt balances.
--   * Business rule "5 paid cups -> 1 free drink" is enforced by CHECK
--     constraints: stamp_count is 0..5 and reward_available = (stamp_count = 5).
--   * Only the server (service_role) may execute the privileged functions.
--     Browsers never receive the service-role key.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('customer', 'staff', 'admin');

create type public.membership_status as enum ('active', 'cancelled');

create type public.loyalty_action as enum (
  'ADD_CUPS',
  'REMOVE_CUPS',
  'REDEEM_REWARD',
  'UNDO',
  'CANCEL_MEMBERSHIP',
  'REACTIVATE_MEMBERSHIP',
  'ADMIN_ADJUSTMENT'
);

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user (customers, staff and admins)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    constraint profiles_display_name_length check (char_length(btrim(display_name)) between 1 and 80),
  -- Lower-cased copy of auth.users.email, kept in sync by trigger, so staff /
  -- admin search can run without touching the auth schema.
  email text not null default ''
    constraint profiles_email_lowercase check (email = lower(email)),
  role public.app_role not null default 'customer',
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role);
create index profiles_email_idx on public.profiles (email);
create index profiles_display_name_idx on public.profiles (lower(display_name));

comment on table public.profiles is 'One row per Supabase Auth user. Role is the single source of truth for authorization.';

-- ---------------------------------------------------------------------------
-- loyalty_accounts: one per customer
-- ---------------------------------------------------------------------------
create table public.loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete restrict,
  -- Human-readable, non-sequential member ID (HLW-XXXXXX, 32-symbol alphabet
  -- without 0/1/O/I to avoid confusion when typed manually).
  member_id text not null unique
    constraint loyalty_accounts_member_id_format check (member_id ~ '^HLW-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$'),
  stamp_count smallint not null default 0
    constraint loyalty_accounts_stamp_range check (stamp_count between 0 and 5),
  reward_available boolean not null default false,
  membership_status public.membership_status not null default 'active',
  -- Apple Wallet serialNumber. Random, never changes for the life of the pass.
  pass_serial uuid not null unique default gen_random_uuid(),
  -- Random identifier embedded in the QR token. The QR token itself is
  -- "<qr_token_id>.<HMAC signature>" and is verified server-side before any
  -- lookup, so it never exposes database primary keys or personal data.
  qr_token_id text not null unique
    constraint loyalty_accounts_qr_token_id_format check (qr_token_id ~ '^[A-Za-z0-9_-]{22}$'),
  -- Apple Wallet "last updated" tag source. Bumped on every visible change.
  wallet_updated_at timestamptz not null default now(),
  last_mutation_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_accounts_reward_matches_stamps check (reward_available = (stamp_count = 5)),
  constraint loyalty_accounts_cancelled_at_consistent check (
    (membership_status = 'cancelled') = (cancelled_at is not null)
  )
);

create index loyalty_accounts_created_at_idx on public.loyalty_accounts (created_at desc);
create index loyalty_accounts_reward_idx on public.loyalty_accounts (reward_available) where reward_available;

comment on table public.loyalty_accounts is 'Exactly one loyalty membership per customer. Mutated only through apply_loyalty_action().';

-- ---------------------------------------------------------------------------
-- loyalty_transactions: append-only audit log
-- ---------------------------------------------------------------------------
create table public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  -- Strict, gap-tolerant ordering that does not depend on clock resolution.
  seq bigint generated always as identity unique,
  loyalty_account_id uuid not null references public.loyalty_accounts (id) on delete restrict,
  actor_user_id uuid not null references public.profiles (id) on delete restrict,
  actor_role public.app_role not null,
  action public.loyalty_action not null,
  quantity smallint not null default 0
    constraint loyalty_transactions_quantity_range check (quantity between 0 and 5),
  delta smallint not null default 0
    constraint loyalty_transactions_delta_range check (delta between -5 and 5),
  previous_stamp_count smallint not null
    constraint loyalty_transactions_prev_range check (previous_stamp_count between 0 and 5),
  new_stamp_count smallint not null
    constraint loyalty_transactions_new_range check (new_stamp_count between 0 and 5),
  previous_reward_available boolean not null,
  new_reward_available boolean not null,
  previous_membership_status public.membership_status not null,
  new_membership_status public.membership_status not null,
  -- For UNDO rows: the transaction being reversed.
  reversal_of uuid unique references public.loyalty_transactions (id) on delete restrict,
  -- For reversed rows: the UNDO transaction that reversed them.
  reversed_by uuid unique references public.loyalty_transactions (id) on delete restrict,
  reversed_at timestamptz,
  -- Client-generated key that makes retries / double taps idempotent.
  idempotency_key uuid unique,
  source text not null default 'dashboard'
    constraint loyalty_transactions_source_length check (char_length(source) <= 40),
  created_at timestamptz not null default now(),
  constraint loyalty_transactions_undo_has_target check ((action = 'UNDO') = (reversal_of is not null)),
  constraint loyalty_transactions_delta_matches check (delta = new_stamp_count - previous_stamp_count),
  constraint loyalty_transactions_reversal_pair check ((reversed_by is null) = (reversed_at is null))
);

create index loyalty_transactions_account_idx on public.loyalty_transactions (loyalty_account_id, seq desc);
create index loyalty_transactions_created_at_idx on public.loyalty_transactions (created_at desc);
create index loyalty_transactions_actor_idx on public.loyalty_transactions (actor_user_id);
create index loyalty_transactions_action_created_idx on public.loyalty_transactions (action, created_at desc);

comment on table public.loyalty_transactions is 'Append-only loyalty audit log. Never deleted; reversals are new UNDO rows.';

-- Append-only enforcement --------------------------------------------------
create function public.loyalty_transactions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'loyalty_transactions is append-only (delete rejected)'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'TRUNCATE' then
    raise exception 'loyalty_transactions is append-only (truncate rejected)'
      using errcode = 'insufficient_privilege';
  end if;

  -- UPDATE: only the reversal link may be set, once.
  if old.reversed_by is not null
     or new.reversed_by is null
     or new.reversed_at is null
     or new.id is distinct from old.id
     or new.seq is distinct from old.seq
     or new.loyalty_account_id is distinct from old.loyalty_account_id
     or new.actor_user_id is distinct from old.actor_user_id
     or new.actor_role is distinct from old.actor_role
     or new.action is distinct from old.action
     or new.quantity is distinct from old.quantity
     or new.delta is distinct from old.delta
     or new.previous_stamp_count is distinct from old.previous_stamp_count
     or new.new_stamp_count is distinct from old.new_stamp_count
     or new.previous_reward_available is distinct from old.previous_reward_available
     or new.new_reward_available is distinct from old.new_reward_available
     or new.previous_membership_status is distinct from old.previous_membership_status
     or new.new_membership_status is distinct from old.new_membership_status
     or new.reversal_of is distinct from old.reversal_of
     or new.idempotency_key is distinct from old.idempotency_key
     or new.source is distinct from old.source
     or new.created_at is distinct from old.created_at then
    raise exception 'loyalty_transactions rows are immutable (only the reversal link can be set once)'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger loyalty_transactions_no_delete
  before delete on public.loyalty_transactions
  for each row execute function public.loyalty_transactions_guard();

create trigger loyalty_transactions_immutable
  before update on public.loyalty_transactions
  for each row execute function public.loyalty_transactions_guard();

create trigger loyalty_transactions_no_truncate
  before truncate on public.loyalty_transactions
  for each statement execute function public.loyalty_transactions_guard();

-- ---------------------------------------------------------------------------
-- Apple Wallet web-service storage
-- ---------------------------------------------------------------------------
create table public.wallet_devices (
  device_library_identifier text primary key
    constraint wallet_devices_id_length check (char_length(device_library_identifier) between 1 and 128),
  push_token text not null
    constraint wallet_devices_push_token_length check (char_length(push_token) between 1 and 256),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wallet_registrations (
  device_library_identifier text not null references public.wallet_devices (device_library_identifier) on delete cascade,
  pass_type_identifier text not null
    constraint wallet_registrations_pass_type_length check (char_length(pass_type_identifier) between 1 and 255),
  pass_serial uuid not null references public.loyalty_accounts (pass_serial) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (device_library_identifier, pass_type_identifier, pass_serial)
);

create index wallet_registrations_serial_idx on public.wallet_registrations (pass_serial);

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger loyalty_accounts_touch before update on public.loyalty_accounts
  for each row execute function public.touch_updated_at();
create trigger wallet_devices_touch before update on public.wallet_devices
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Identifier generation (uses gen_random_uuid(), which is backed by the
-- server's cryptographically strong RNG; no extension required)
-- ---------------------------------------------------------------------------
create function public.generate_member_id()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; -- 32 symbols
  bytes bytea := uuid_send(gen_random_uuid());
  result text := 'HLW-';
  i int;
begin
  -- Bytes 0..5 of a v4 UUID are fully random. 256 is divisible by 32, so the
  -- modulo introduces no bias.
  for i in 0..5 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end;
$$;

create function public.generate_qr_token_id()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 16 bytes (122 random bits) -> 22 base64url characters
  select translate(rtrim(encode(uuid_send(gen_random_uuid()), 'base64'), '='), '+/', '-_');
$$;

-- Creates the loyalty account for a customer if it does not exist yet.
-- Idempotent and safe under concurrency (unique user_id).
create function public.ensure_loyalty_account(p_user_id uuid)
returns public.loyalty_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  acct public.loyalty_accounts;
  attempt int := 0;
begin
  select * into acct from public.loyalty_accounts where user_id = p_user_id;
  if found then
    return acct;
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'profile % does not exist', p_user_id using errcode = 'foreign_key_violation';
  end if;

  loop
    attempt := attempt + 1;
    begin
      insert into public.loyalty_accounts (user_id, member_id, qr_token_id)
      values (p_user_id, public.generate_member_id(), public.generate_qr_token_id())
      on conflict (user_id) do nothing
      returning * into acct;

      if acct.id is null then
        select * into acct from public.loyalty_accounts where user_id = p_user_id;
      end if;
      return acct;
    exception when unique_violation then
      -- member_id / qr_token_id collision (astronomically rare): retry.
      if attempt >= 10 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Auth hooks: provision profile (+ loyalty account for customers)
-- ---------------------------------------------------------------------------
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text := new.raw_app_meta_data ->> 'hollow_role';
  resolved_role public.app_role := 'customer';
  raw_name text;
  clean_name text;
begin
  -- Only app_metadata (writable exclusively with the service-role key) may
  -- request a privileged role. user_metadata is user-controlled and ignored
  -- for authorization.
  if requested_role in ('staff', 'admin') then
    resolved_role := requested_role::public.app_role;
  end if;

  raw_name := coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name', '');
  clean_name := left(btrim(regexp_replace(raw_name, '[[:cntrl:]]', '', 'g')), 80);
  if clean_name = '' then
    clean_name := left(coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'HOLLOW'), 80);
  end if;

  insert into public.profiles (id, display_name, email, role, email_confirmed_at)
  values (new.id, clean_name, lower(coalesce(new.email, '')), resolved_role, new.email_confirmed_at)
  on conflict (id) do nothing;

  if resolved_role = 'customer' then
    perform public.ensure_loyalty_account(new.id);
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create function public.handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set email = lower(coalesce(new.email, '')),
         email_confirmed_at = new.email_confirmed_at
   where id = new.id
     and (email is distinct from lower(coalesce(new.email, ''))
          or email_confirmed_at is distinct from new.email_confirmed_at);
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of email, email_confirmed_at on auth.users
  for each row execute function public.handle_auth_user_updated();

-- ---------------------------------------------------------------------------
-- apply_loyalty_action: the ONLY way loyalty state changes.
--
-- Returns jsonb. Business-rule rejections return {"ok": false, "code": ...}
-- without changing anything; success returns {"ok": true, ...}.
--
-- Codes: FORBIDDEN, NOT_FOUND, INVALID_QUANTITY, MEMBERSHIP_CANCELLED,
--        RECENT_ACTIVITY, REWARD_PENDING, EXCEEDS_CAPACITY, ALREADY_ZERO,
--        BELOW_ZERO, NO_REWARD, NOTHING_TO_UNDO, UNDO_STATE_MISMATCH,
--        NO_CHANGE, ALREADY_ACTIVE, IDEMPOTENCY_CONFLICT, UNKNOWN_ACTION
-- ---------------------------------------------------------------------------
create function public.apply_loyalty_action(
  p_actor_id uuid,
  p_account_id uuid,
  p_action public.loyalty_action,
  p_quantity int default null,
  p_target_stamp_count int default null,
  p_idempotency_key uuid default null,
  p_confirm_recent boolean default false,
  p_recent_window_seconds int default 60,
  p_source text default 'dashboard'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_stamps constant int := 5;
  actor public.profiles;
  acct public.loyalty_accounts;
  existing public.loyalty_transactions;
  target public.loyalty_transactions;
  last_tx public.loyalty_transactions;
  qty int := coalesce(p_quantity, 0);
  prev_stamps int;
  prev_reward boolean;
  new_stamps int;
  new_status public.membership_status;
  tx_id uuid;
  now_ts timestamptz := now();
  recent_seconds int := greatest(coalesce(p_recent_window_seconds, 60), 0);
begin
  -- Actor must be staff or admin according to the database, never the client.
  select * into actor from public.profiles where id = p_actor_id;
  if not found or actor.role not in ('staff', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if p_action in ('ADMIN_ADJUSTMENT', 'CANCEL_MEMBERSHIP', 'REACTIVATE_MEMBERSHIP')
     and actor.role <> 'admin' then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  -- Serialize all mutations for this account.
  select * into acct from public.loyalty_accounts where id = p_account_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- Idempotency (checked after taking the lock so a concurrent duplicate sees
  -- the committed first attempt).
  if p_idempotency_key is not null then
    select * into existing from public.loyalty_transactions where idempotency_key = p_idempotency_key;
    if found then
      if existing.loyalty_account_id <> acct.id or existing.action <> p_action then
        return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
      end if;
      return jsonb_build_object(
        'ok', true,
        'replayed', true,
        'transaction_id', existing.id,
        'action', existing.action,
        'previous_stamp_count', existing.previous_stamp_count,
        'new_stamp_count', existing.new_stamp_count,
        'previous_reward_available', existing.previous_reward_available,
        'new_reward_available', existing.new_reward_available,
        'account', public.loyalty_account_snapshot(acct)
      );
    end if;
  end if;

  if acct.membership_status = 'cancelled' and p_action <> 'REACTIVATE_MEMBERSHIP' then
    return jsonb_build_object('ok', false, 'code', 'MEMBERSHIP_CANCELLED');
  end if;

  -- Accidental duplicate protection. UNDO is exempt because it is the tool
  -- staff use to fix an accidental duplicate (and has its own confirmation).
  if p_action <> 'UNDO'
     and not coalesce(p_confirm_recent, false)
     and recent_seconds > 0
     and acct.last_mutation_at is not null
     and acct.last_mutation_at > now_ts - make_interval(secs => recent_seconds) then
    select * into last_tx from public.loyalty_transactions
      where loyalty_account_id = acct.id order by seq desc limit 1;
    return jsonb_build_object(
      'ok', false,
      'code', 'RECENT_ACTIVITY',
      'seconds_ago', greatest(floor(extract(epoch from (now_ts - acct.last_mutation_at)))::int, 0),
      'last_action', last_tx.action,
      'last_quantity', last_tx.quantity
    );
  end if;

  prev_stamps := acct.stamp_count;
  prev_reward := acct.reward_available;
  new_stamps := acct.stamp_count;
  new_status := acct.membership_status;

  case p_action
    when 'ADD_CUPS' then
      if qty < 1 or qty > max_stamps then
        return jsonb_build_object('ok', false, 'code', 'INVALID_QUANTITY');
      end if;
      if acct.reward_available then
        return jsonb_build_object('ok', false, 'code', 'REWARD_PENDING');
      end if;
      if acct.stamp_count + qty > max_stamps then
        return jsonb_build_object('ok', false, 'code', 'EXCEEDS_CAPACITY',
          'remaining', max_stamps - acct.stamp_count);
      end if;
      new_stamps := acct.stamp_count + qty;

    when 'REMOVE_CUPS' then
      if p_quantity is null then
        qty := 1;
      end if;
      if qty < 1 or qty > max_stamps then
        return jsonb_build_object('ok', false, 'code', 'INVALID_QUANTITY');
      end if;
      if acct.stamp_count = 0 then
        return jsonb_build_object('ok', false, 'code', 'ALREADY_ZERO');
      end if;
      if qty > acct.stamp_count then
        return jsonb_build_object('ok', false, 'code', 'BELOW_ZERO', 'current', acct.stamp_count);
      end if;
      new_stamps := acct.stamp_count - qty;

    when 'REDEEM_REWARD' then
      if not acct.reward_available or acct.stamp_count <> max_stamps then
        return jsonb_build_object('ok', false, 'code', 'NO_REWARD');
      end if;
      qty := 1;
      new_stamps := 0;

    when 'ADMIN_ADJUSTMENT' then
      if p_target_stamp_count is null or p_target_stamp_count < 0 or p_target_stamp_count > max_stamps then
        return jsonb_build_object('ok', false, 'code', 'INVALID_QUANTITY');
      end if;
      if p_target_stamp_count = acct.stamp_count then
        return jsonb_build_object('ok', false, 'code', 'NO_CHANGE');
      end if;
      new_stamps := p_target_stamp_count;
      qty := abs(new_stamps - acct.stamp_count);

    when 'CANCEL_MEMBERSHIP' then
      qty := 0;
      new_status := 'cancelled';

    when 'REACTIVATE_MEMBERSHIP' then
      if acct.membership_status = 'active' then
        return jsonb_build_object('ok', false, 'code', 'ALREADY_ACTIVE');
      end if;
      qty := 0;
      new_status := 'active';

    when 'UNDO' then
      select * into target from public.loyalty_transactions
        where loyalty_account_id = acct.id
          and action in ('ADD_CUPS', 'REMOVE_CUPS', 'REDEEM_REWARD', 'ADMIN_ADJUSTMENT')
          and reversed_by is null
        order by seq desc
        limit 1;
      if not found then
        return jsonb_build_object('ok', false, 'code', 'NOTHING_TO_UNDO');
      end if;
      if target.action = 'ADMIN_ADJUSTMENT' and actor.role <> 'admin' then
        return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
      end if;
      -- Only reverse if nothing else changed the balance since.
      if acct.stamp_count <> target.new_stamp_count
         or acct.reward_available <> target.new_reward_available then
        return jsonb_build_object('ok', false, 'code', 'UNDO_STATE_MISMATCH');
      end if;
      new_stamps := target.previous_stamp_count;
      qty := target.quantity;

    else
      return jsonb_build_object('ok', false, 'code', 'UNKNOWN_ACTION');
  end case;

  insert into public.loyalty_transactions (
    loyalty_account_id, actor_user_id, actor_role, action, quantity, delta,
    previous_stamp_count, new_stamp_count,
    previous_reward_available, new_reward_available,
    previous_membership_status, new_membership_status,
    reversal_of, idempotency_key, source
  ) values (
    acct.id, actor.id, actor.role, p_action, qty, new_stamps - acct.stamp_count,
    acct.stamp_count, new_stamps,
    acct.reward_available, new_stamps = max_stamps,
    acct.membership_status, new_status,
    case when p_action = 'UNDO' then target.id else null end,
    p_idempotency_key, left(coalesce(p_source, 'dashboard'), 40)
  )
  returning id into tx_id;

  if p_action = 'UNDO' then
    update public.loyalty_transactions
       set reversed_by = tx_id, reversed_at = now_ts
     where id = target.id;
  end if;

  update public.loyalty_accounts
     set stamp_count = new_stamps,
         reward_available = (new_stamps = max_stamps),
         membership_status = new_status,
         cancelled_at = case when new_status = 'cancelled' then coalesce(acct.cancelled_at, now_ts) else null end,
         last_mutation_at = now_ts,
         wallet_updated_at = clock_timestamp()
   where id = acct.id
  returning * into acct;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'transaction_id', tx_id,
    'action', p_action,
    'reversal_of', case when p_action = 'UNDO' then target.id else null end,
    'reversed_action', case when p_action = 'UNDO' then target.action else null end,
    'previous_stamp_count', prev_stamps,
    'previous_reward_available', prev_reward,
    'new_stamp_count', acct.stamp_count,
    'new_reward_available', acct.reward_available,
    'account', public.loyalty_account_snapshot(acct)
  );
end;
$$;

-- Snapshot helper used in RPC responses (no secrets inside).
create function public.loyalty_account_snapshot(acct public.loyalty_accounts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', acct.id,
    'member_id', acct.member_id,
    'stamp_count', acct.stamp_count,
    'reward_available', acct.reward_available,
    'membership_status', acct.membership_status,
    'pass_serial', acct.pass_serial,
    'last_mutation_at', acct.last_mutation_at,
    'wallet_updated_at', acct.wallet_updated_at
  );
$$;

-- ---------------------------------------------------------------------------
-- Read models for the dashboard
-- ---------------------------------------------------------------------------

-- Escapes LIKE wildcards in user input.
create function public.escape_like(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

create function public.search_customers(
  p_query text default '',
  p_limit int default 20,
  p_offset int default 0,
  p_include_email boolean default false
)
returns table (
  account_id uuid,
  user_id uuid,
  member_id text,
  display_name text,
  email text,
  stamp_count smallint,
  reward_available boolean,
  membership_status public.membership_status,
  last_mutation_at timestamptz,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select btrim(coalesce(p_query, '')) as raw,
           public.escape_like(lower(btrim(coalesce(p_query, '')))) as pattern,
           upper(regexp_replace(btrim(coalesce(p_query, '')), '\s', '', 'g')) as upper_compact
  )
  select a.id, a.user_id, a.member_id, p.display_name, p.email,
         a.stamp_count, a.reward_available, a.membership_status,
         a.last_mutation_at, a.created_at,
         count(*) over () as total_count
    from public.loyalty_accounts a
    join public.profiles p on p.id = a.user_id
    cross join q
   where q.raw = ''
      or lower(p.display_name) like '%' || q.pattern || '%'
      or a.member_id like '%' || public.escape_like(q.upper_compact) || '%'
      or (p_include_email and p.email like '%' || q.pattern || '%')
   order by a.created_at desc, a.id
   limit least(greatest(coalesce(p_limit, 20), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create function public.list_loyalty_transactions(
  p_account_id uuid default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  seq bigint,
  loyalty_account_id uuid,
  member_id text,
  customer_name text,
  customer_email text,
  actor_user_id uuid,
  actor_name text,
  actor_role public.app_role,
  action public.loyalty_action,
  quantity smallint,
  delta smallint,
  previous_stamp_count smallint,
  new_stamp_count smallint,
  previous_reward_available boolean,
  new_reward_available boolean,
  previous_membership_status public.membership_status,
  new_membership_status public.membership_status,
  reversal_of uuid,
  reversed_by uuid,
  reversed_at timestamptz,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.seq, t.loyalty_account_id, a.member_id, cp.display_name, cp.email,
         t.actor_user_id, ap.display_name, t.actor_role, t.action, t.quantity, t.delta,
         t.previous_stamp_count, t.new_stamp_count,
         t.previous_reward_available, t.new_reward_available,
         t.previous_membership_status, t.new_membership_status,
         t.reversal_of, t.reversed_by, t.reversed_at, t.created_at,
         count(*) over () as total_count
    from public.loyalty_transactions t
    join public.loyalty_accounts a on a.id = t.loyalty_account_id
    join public.profiles cp on cp.id = a.user_id
    join public.profiles ap on ap.id = t.actor_user_id
   where p_account_id is null or t.loyalty_account_id = p_account_id
   order by t.seq desc
   limit least(greatest(coalesce(p_limit, 50), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Business-day boundaries use Asia/Riyadh; the Saudi week starts on Sunday.
create function public.admin_dashboard_stats(p_time_zone text default 'Asia/Riyadh')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  local_today date := (now() at time zone p_time_zone)::date;
  day_start timestamptz := (local_today::timestamp) at time zone p_time_zone;
  week_start timestamptz := ((local_today - extract(dow from local_today)::int)::timestamp) at time zone p_time_zone;
  result jsonb;
begin
  select jsonb_build_object(
    'total_customers', (select count(*) from public.loyalty_accounts),
    'active_customers', (select count(*) from public.loyalty_accounts where membership_status = 'active'),
    'cancelled_customers', (select count(*) from public.loyalty_accounts where membership_status = 'cancelled'),
    'new_today', (select count(*) from public.loyalty_accounts where created_at >= day_start),
    'new_this_week', (select count(*) from public.loyalty_accounts where created_at >= week_start),
    'cups_added_today', (
      select coalesce(sum(quantity), 0) from public.loyalty_transactions
       where action = 'ADD_CUPS' and reversed_by is null and created_at >= day_start),
    'rewards_available', (
      select count(*) from public.loyalty_accounts
       where reward_available and membership_status = 'active'),
    'rewards_redeemed_today', (
      select count(*) from public.loyalty_transactions
       where action = 'REDEEM_REWARD' and reversed_by is null and created_at >= day_start),
    'rewards_redeemed_total', (
      select count(*) from public.loyalty_transactions
       where action = 'REDEEM_REWARD' and reversed_by is null),
    'day_start', day_start,
    'week_start', week_start,
    'time_zone', p_time_zone
  ) into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Apple Wallet web-service functions
-- ---------------------------------------------------------------------------
create function public.wallet_register_device(
  p_device_library_identifier text,
  p_push_token text,
  p_pass_type_identifier text,
  p_pass_serial uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted int;
begin
  if not exists (select 1 from public.loyalty_accounts where pass_serial = p_pass_serial) then
    return 'unknown_pass';
  end if;

  insert into public.wallet_devices (device_library_identifier, push_token)
  values (p_device_library_identifier, p_push_token)
  on conflict (device_library_identifier)
  do update set push_token = excluded.push_token
    where public.wallet_devices.push_token is distinct from excluded.push_token;

  insert into public.wallet_registrations (device_library_identifier, pass_type_identifier, pass_serial)
  values (p_device_library_identifier, p_pass_type_identifier, p_pass_serial)
  on conflict do nothing;
  get diagnostics inserted = row_count;

  return case when inserted > 0 then 'created' else 'exists' end;
end;
$$;

create function public.wallet_unregister_device(
  p_device_library_identifier text,
  p_pass_type_identifier text,
  p_pass_serial uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.wallet_registrations
   where device_library_identifier = p_device_library_identifier
     and pass_type_identifier = p_pass_type_identifier
     and pass_serial = p_pass_serial;

  delete from public.wallet_devices d
   where d.device_library_identifier = p_device_library_identifier
     and not exists (
       select 1 from public.wallet_registrations r
        where r.device_library_identifier = d.device_library_identifier);
end;
$$;

-- Returns serials registered on a device updated after p_since_micros
-- (microseconds since epoch, the opaque "lastUpdated" tag we hand to Wallet).
create function public.wallet_updated_serials(
  p_device_library_identifier text,
  p_pass_type_identifier text,
  p_since_micros bigint default null
)
returns table (pass_serial uuid, update_tag bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select a.pass_serial,
         (extract(epoch from a.wallet_updated_at) * 1000000)::bigint as update_tag
    from public.wallet_registrations r
    join public.loyalty_accounts a on a.pass_serial = r.pass_serial
   where r.device_library_identifier = p_device_library_identifier
     and r.pass_type_identifier = p_pass_type_identifier
     and (p_since_micros is null
          or (extract(epoch from a.wallet_updated_at) * 1000000)::bigint > p_since_micros);
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security & privileges (least privilege)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_transactions enable row level security;
alter table public.wallet_devices enable row level security;
alter table public.wallet_registrations enable row level security;

-- Start from zero for browser-facing roles.
revoke all on table public.profiles, public.loyalty_accounts, public.loyalty_transactions,
  public.wallet_devices, public.wallet_registrations from anon, authenticated;

-- Customers may READ their own profile and loyalty account. There are no
-- INSERT / UPDATE / DELETE grants or policies for browser roles at all, so
-- stamp_count, reward_available, roles, transactions and Wallet registrations
-- can only be changed by the server.
grant select on table public.profiles to authenticated;
grant select on table public.loyalty_accounts to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy loyalty_accounts_select_own on public.loyalty_accounts
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- The server uses the service_role key (bypasses RLS) after verifying the
-- caller's JWT and role.
grant all on table public.profiles, public.loyalty_accounts, public.loyalty_transactions,
  public.wallet_devices, public.wallet_registrations to service_role;

-- Functions: nobody but the server may execute privileged functions.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.apply_loyalty_action(uuid, uuid, public.loyalty_action, int, int, uuid, boolean, int, text),
  public.ensure_loyalty_account(uuid),
  public.search_customers(text, int, int, boolean),
  public.list_loyalty_transactions(uuid, int, int),
  public.admin_dashboard_stats(text),
  public.wallet_register_device(text, text, text, uuid),
  public.wallet_unregister_device(text, text, uuid),
  public.wallet_updated_serials(text, text, bigint),
  public.loyalty_account_snapshot(public.loyalty_accounts),
  public.generate_member_id(),
  public.generate_qr_token_id(),
  public.escape_like(text)
to service_role;

-- Trigger functions are invoked by the trigger machinery, never directly.
revoke execute on function public.handle_new_auth_user(), public.handle_auth_user_updated(),
  public.loyalty_transactions_guard(), public.touch_updated_at()
from public, anon, authenticated;

-- Make sure future functions are not executable by browser roles by default.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
