-- =============================================================================
-- Owner and staff tools, round two:
--   * profiles.staff_paused: a staff account can be paused and resumed. A
--     paused account is disabled (disabled_at is set, so every existing check
--     denies it) but stays on the admin's staff list. Removing it clears the flag.
--   * notification_prefs.low_ratings: admins get a push when a customer gives
--     one or two stars (staff_push_devices('low_ratings')).
--   * push_broadcasts scheduling: an offer can be written now and sent later.
--     A cron run claims a due offer (with a short lease so two runs never send
--     the same batch), sends one batch and records where it stopped.
--   * service_report: preparation and waiting times, cancellations and their
--     reasons, for the sales dashboard.
-- =============================================================================

alter table public.profiles
  add column staff_paused boolean not null default false,
  add constraint profiles_staff_paused_disabled check (not staff_paused or disabled_at is not null);

comment on column public.profiles.staff_paused is
  'A paused staff account: disabled like a removed one, but listed for the admin and can be resumed.';

alter table public.notification_prefs
  add column low_ratings boolean not null default true;

alter table public.push_broadcasts
  add column scheduled_at timestamptz,
  add column started_at timestamptz,
  add column finished_at timestamptz,
  add column cancelled_at timestamptz,
  add column send_cursor text,
  add column lease_until timestamptz;

create index push_broadcasts_due_idx on public.push_broadcasts (scheduled_at)
  where scheduled_at is not null and finished_at is null and cancelled_at is null;

-- Devices of staff/admins who want alerts: 'new_orders' (staff + admin),
-- 'daily_summary' and 'low_ratings' (admin).
create or replace function public.staff_push_devices(p_kind text)
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
           when 'low_ratings' then p.role = 'admin' and coalesce(n.low_ratings, true)
           else false
         end
   order by d.updated_at desc
   limit 20;
$$;

-- The oldest scheduled offer that is due and not being sent by another run.
-- The first claim counts the recipients at that moment.
create function public.claim_due_broadcast(p_now timestamptz, p_lease_seconds int default 50)
returns setof public.push_broadcasts
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  select b.id into target
    from public.push_broadcasts b
   where b.scheduled_at is not null
     and b.scheduled_at <= p_now
     and b.finished_at is null
     and b.cancelled_at is null
     and (b.lease_until is null or b.lease_until < p_now)
   order by b.scheduled_at, b.id
   limit 1
   for update skip locked;
  if target is null then
    return;
  end if;
  return query
    update public.push_broadcasts b
       set lease_until = p_now + make_interval(secs => greatest(coalesce(p_lease_seconds, 50), 5)),
           recipients = case when b.started_at is null then public.offer_push_count() else b.recipients end,
           started_at = coalesce(b.started_at, p_now)
     where b.id = target
    returning b.*;
end;
$$;

-- Records a sent batch: the new total, where the next batch starts, and
-- whether the offer is done. Releases the lease.
create function public.advance_broadcast(p_id uuid, p_sent int, p_cursor text, p_finished boolean, p_now timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.push_broadcasts
     set sent = p_sent,
         send_cursor = p_cursor,
         finished_at = case when p_finished then p_now else null end,
         lease_until = null
   where id = p_id and finished_at is null;
$$;

-- Cancels a scheduled offer that has not started sending.
create function public.cancel_broadcast(p_id uuid, p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.push_broadcasts;
begin
  select * into b from public.push_broadcasts where id = p_id for update;
  if not found then
    return 'NOT_FOUND';
  end if;
  if b.scheduled_at is null or b.started_at is not null or b.finished_at is not null then
    return 'ALREADY_SENT';
  end if;
  if b.cancelled_at is not null then
    return 'ok';
  end if;
  update public.push_broadcasts set cancelled_at = p_now where id = p_id;
  return 'ok';
end;
$$;

-- How fast orders were served and how many were cancelled, for orders
-- placed in a period and the period before it. Times are in minutes.
--   accept: placed -> accepted
--   prep:   accepted -> ready (or out for delivery)
--   wait:   placed -> ready (or out for delivery), what the customer feels
create function public.service_report(
  p_from timestamptz,
  p_to timestamptz,
  p_prev_from timestamptz,
  p_prev_to timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with periods as (
    select 'cur' as period, p_from as f, p_to as t
    union all
    select 'prev', p_prev_from, p_prev_to
  ),
  timed as (
    select pr.period,
           o.status,
           extract(epoch from (o.accepted_at - o.created_at)) / 60 as accept_min,
           extract(epoch from (coalesce(o.ready_at, o.out_for_delivery_at) - o.accepted_at)) / 60 as prep_min,
           extract(epoch from (coalesce(o.ready_at, o.out_for_delivery_at) - o.created_at)) / 60 as wait_min
      from periods pr
      join public.orders o on o.created_at >= pr.f and o.created_at < pr.t
     where o.status in ('completed', 'cancelled')
  ),
  summary as (
    select period,
           count(*) filter (where status = 'completed') as completed,
           count(*) filter (where status = 'cancelled') as cancelled,
           round(avg(accept_min) filter (where status = 'completed' and accept_min >= 0)::numeric, 1) as accept,
           round(avg(prep_min) filter (where status = 'completed' and prep_min >= 0)::numeric, 1) as prep,
           round(avg(wait_min) filter (where status = 'completed' and wait_min >= 0)::numeric, 1) as wait,
           count(*) filter (where status = 'completed' and wait_min > 15) as slow
      from timed
     group by period
  )
  select jsonb_build_object(
    'current', coalesce(
      (select jsonb_build_object('completed', s.completed, 'cancelled', s.cancelled, 'accept_minutes', s.accept,
                                 'prep_minutes', s.prep, 'wait_minutes', s.wait, 'slow', s.slow)
         from summary s where s.period = 'cur'),
      jsonb_build_object('completed', 0, 'cancelled', 0, 'accept_minutes', null, 'prep_minutes', null, 'wait_minutes', null, 'slow', 0)
    ),
    'previous', coalesce(
      (select jsonb_build_object('completed', s.completed, 'cancelled', s.cancelled, 'accept_minutes', s.accept,
                                 'prep_minutes', s.prep, 'wait_minutes', s.wait, 'slow', s.slow)
         from summary s where s.period = 'prev'),
      jsonb_build_object('completed', 0, 'cancelled', 0, 'accept_minutes', null, 'prep_minutes', null, 'wait_minutes', null, 'slow', 0)
    ),
    'reasons', (
      select coalesce(jsonb_agg(jsonb_build_object('by', r.by, 'reason', r.reason, 'count', r.n) order by r.n desc, r.reason nulls last), '[]'::jsonb)
        from (
          select coalesce(o.cancelled_by, 'staff') as by,
                 nullif(btrim(o.cancel_reason), '') as reason,
                 count(*) as n
            from public.orders o
           where o.status = 'cancelled' and o.created_at >= p_from and o.created_at < p_to
           group by 1, 2
           order by n desc, reason nulls last
           limit 6
        ) r
    )
  );
$$;

revoke execute on function public.claim_due_broadcast(timestamptz, int) from public, anon, authenticated;
revoke execute on function public.advance_broadcast(uuid, int, text, boolean, timestamptz) from public, anon, authenticated;
revoke execute on function public.cancel_broadcast(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.service_report(timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_due_broadcast(timestamptz, int) to service_role;
grant execute on function public.advance_broadcast(uuid, int, text, boolean, timestamptz) to service_role;
grant execute on function public.cancel_broadcast(uuid, timestamptz) to service_role;
grant execute on function public.service_report(timestamptz, timestamptz, timestamptz, timestamptz) to service_role;
