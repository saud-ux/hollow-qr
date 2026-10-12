-- =============================================================================
-- Browser notifications for the website (Web Push)
--   * push_devices also holds browsers: platform 'web', keyed by the SHA-256 of
--     the subscription endpoint, with the endpoint and its two keys.
--   * web_push_keys: the server's VAPID key pair, made by the Worker on first
--     use (one row, service role only).
--   * staff_push_devices / offer_push_devices: like the *_tokens functions, but
--     whole rows, so a browser can be reached through its endpoint.
-- =============================================================================

alter table public.push_devices drop constraint push_devices_platform;

alter table public.push_devices
  add constraint push_devices_platform check (platform in ('ios', 'web')),
  add column web_endpoint text
    constraint push_devices_web_endpoint check (web_endpoint is null or (web_endpoint like 'https://%' and char_length(web_endpoint) <= 1024)),
  add column web_p256dh text
    constraint push_devices_web_p256dh check (web_p256dh is null or web_p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  add column web_auth text
    constraint push_devices_web_auth check (web_auth is null or web_auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  add constraint push_devices_web_fields check (
    (platform = 'web') = (web_endpoint is not null and web_p256dh is not null and web_auth is not null)
  );

create table public.web_push_keys (
  id smallint primary key default 1 constraint web_push_keys_single check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.web_push_keys enable row level security;
revoke all on table public.web_push_keys from anon, authenticated;
grant all on table public.web_push_keys to service_role;

-- Devices of staff/admins who want alerts: 'new_orders' (staff + admin) or
-- 'daily_summary' (admin).
create function public.staff_push_devices(p_kind text)
returns setof public.push_devices
language sql
stable
security definer
set search_path = ''
as $$
  select d.*
    from public.push_devices d
    join public.profiles p on p.id = d.user_id
    left join public.notification_prefs n on n.user_id = d.user_id
   where p.disabled_at is null
     and case p_kind
           when 'new_orders' then p.role in ('staff', 'admin') and coalesce(n.new_orders, true)
           when 'daily_summary' then p.role = 'admin' and coalesce(n.daily_summary, true)
           else false
         end
   order by d.updated_at desc
   limit 20;
$$;

-- Devices of people who opted in to offers, in token order for batching.
create function public.offer_push_devices(p_after text default null, p_limit int default 35)
returns setof public.push_devices
language sql
stable
security definer
set search_path = ''
as $$
  select d.*
    from public.push_devices d
    join public.profiles p on p.id = d.user_id
    join public.notification_prefs n on n.user_id = d.user_id and n.offers
   where p.disabled_at is null
     and (p_after is null or d.token > p_after)
   order by d.token
   limit least(greatest(coalesce(p_limit, 35), 1), 100);
$$;

revoke execute on function public.staff_push_devices(text) from public, anon, authenticated;
revoke execute on function public.offer_push_devices(text, int) from public, anon, authenticated;
grant execute on function public.staff_push_devices(text) to service_role;
grant execute on function public.offer_push_devices(text, int) to service_role;
