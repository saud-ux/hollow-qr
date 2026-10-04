-- Soft-removal for staff accounts.
-- Historical loyalty transactions reference public.profiles, so staff records
-- must remain in place. disabled_at revokes access while preserving audit history.

alter table public.profiles
  add column if not exists disabled_at timestamptz;

create index if not exists profiles_active_staff_idx
  on public.profiles (role, created_at)
  where disabled_at is null;

comment on column public.profiles.disabled_at is
  'When set, the account is denied all authenticated app access. Used to remove staff without deleting historical audit references.';
