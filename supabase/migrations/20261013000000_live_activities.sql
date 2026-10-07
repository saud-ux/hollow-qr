-- iOS Live Activities: the lock-screen order tracker. Each one has its own
-- APNs push token; the server pushes every status change to it and drops it
-- once the order is finished.
create table public.live_activities (
  push_token text primary key
    constraint live_activities_token_format check (push_token ~ '^[0-9a-f]+$' and char_length(push_token) between 32 and 400),
  order_id uuid not null references public.orders (id) on delete cascade,
  lang text not null default 'ar'
    constraint live_activities_lang check (lang in ('ar', 'en')),
  created_at timestamptz not null default now()
);

create index live_activities_order_idx on public.live_activities (order_id);

alter table public.live_activities enable row level security;
revoke all on table public.live_activities from anon, authenticated;
grant all on table public.live_activities to service_role;
