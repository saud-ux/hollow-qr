-- Paste into Supabase Dashboard -> SQL Editor -> Run (once).
-- Part of the V1 schema; applied manually because the automated tool holds
-- statements containing DELETE for an interactive confirmation.
create or replace function public.wallet_unregister_device(
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
     and not exists (select 1 from public.wallet_registrations r
                      where r.device_library_identifier = d.device_library_identifier);
end;
$$;

revoke execute on function public.wallet_unregister_device(text, text, uuid) from public, anon, authenticated;
grant execute on function public.wallet_unregister_device(text, text, uuid) to service_role;
