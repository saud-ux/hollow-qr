-- Supabase Auth's admin createUser inserts the user first and writes custom
-- app_metadata in a follow-up UPDATE, so the insert trigger cannot see
-- hollow_role yet. Promote the profile when app_metadata (writable only with
-- the service-role key) requests staff/admin. user_metadata is ignored.
create function public.handle_auth_user_role_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text := new.raw_app_meta_data ->> 'hollow_role';
begin
  if requested_role in ('staff', 'admin')
     and requested_role is distinct from (old.raw_app_meta_data ->> 'hollow_role') then
    update public.profiles
       set role = requested_role::public.app_role
     where id = new.id
       and role is distinct from requested_role::public.app_role;
  end if;
  return new;
end;
$$;

revoke execute on function public.handle_auth_user_role_sync() from public, anon, authenticated;

create trigger on_auth_user_role_sync
  after update of raw_app_meta_data on auth.users
  for each row execute function public.handle_auth_user_role_sync();
