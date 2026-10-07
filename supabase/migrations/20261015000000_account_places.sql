-- The customer's Account page: saved delivery places (home, work and named
-- ones, picked on a map) and changing one's own name.

create table public.customer_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null
    constraint customer_places_kind check (kind in ('home', 'work', 'other')),
  -- Only "other" places have a name of their own; home and work are named by the app.
  label text
    constraint customer_places_label_length check (label is null or char_length(btrim(label)) between 1 and 30),
  address text not null
    constraint customer_places_address_length check (char_length(btrim(address)) between 1 and 300),
  details text
    constraint customer_places_details_length check (details is null or char_length(details) between 1 and 200),
  lat double precision not null
    constraint customer_places_lat_range check (lat between -90 and 90),
  lng double precision not null
    constraint customer_places_lng_range check (lng between -180 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_places_label_for_other check ((kind = 'other') = (label is not null))
);

-- One home and one work per customer.
create unique index customer_places_one_home_work on public.customer_places (user_id, kind) where kind in ('home', 'work');
create index customer_places_user_idx on public.customer_places (user_id, created_at);

alter table public.customer_places enable row level security;
revoke all on table public.customer_places from anon, authenticated;
grant all on table public.customer_places to service_role;

create function public.place_json(p public.customer_places)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'label', p.label, 'address', p.address,
    'details', p.details, 'lat', p.lat, 'lng', p.lng
  );
$$;

-- Home and work first, then the named places in the order they were added.
create function public.places_list(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.place_json(p) order by case p.kind when 'home' then 0 when 'work' then 1 else 2 end, p.created_at), '[]'::jsonb)
    from public.customer_places p
   where p.user_id = p_user_id;
$$;

-- Adds (p_id null) or edits a place. Saving a new home or work replaces the
-- existing one; a customer keeps at most 5 places.
create function public.place_save(
  p_user_id uuid,
  p_id uuid,
  p_kind text,
  p_label text,
  p_address text,
  p_details text,
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := p_id;
  saved public.customer_places;
  label_value text := case when p_kind = 'other' then nullif(btrim(p_label), '') end;
  details_value text := nullif(btrim(coalesce(p_details, '')), '');
begin
  perform 1 from public.profiles where id = p_user_id and disabled_at is null for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if target is not null then
    perform 1 from public.customer_places where id = target and user_id = p_user_id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
  elsif p_kind in ('home', 'work') then
    select id into target from public.customer_places where user_id = p_user_id and kind = p_kind;
  end if;

  if p_kind in ('home', 'work') and exists (
    select 1 from public.customer_places
     where user_id = p_user_id and kind = p_kind and id is distinct from target
  ) then
    return jsonb_build_object('ok', false, 'code', 'KIND_TAKEN');
  end if;

  if target is null then
    if (select count(*) from public.customer_places where user_id = p_user_id) >= 5 then
      return jsonb_build_object('ok', false, 'code', 'PLACES_LIMIT');
    end if;
    insert into public.customer_places (user_id, kind, label, address, details, lat, lng)
    values (p_user_id, p_kind, label_value, btrim(p_address), details_value, p_lat, p_lng)
    returning * into saved;
  else
    update public.customer_places
       set kind = p_kind, label = label_value, address = btrim(p_address), details = details_value,
           lat = p_lat, lng = p_lng, updated_at = now()
     where id = target
    returning * into saved;
  end if;

  return jsonb_build_object('ok', true, 'place', public.place_json(saved));
end;
$$;

create function public.place_delete(p_user_id uuid, p_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.customer_places where id = p_id and user_id = p_user_id returning 1
  )
  select exists (select 1 from gone);
$$;

-- A customer renames themself. The Wallet pass shows the name, so it is
-- marked as changed; the caller then asks Wallet to fetch it again.
create function public.set_display_name(p_user_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  serial uuid;
begin
  update public.profiles set display_name = btrim(p_name)
   where id = p_user_id and disabled_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  update public.loyalty_accounts set wallet_updated_at = clock_timestamp()
   where user_id = p_user_id
  returning pass_serial into serial;
  return jsonb_build_object('ok', true, 'passSerial', serial);
end;
$$;

-- A removed account (deleted customer or removed staff) forgets its places.
create function public.forget_places_on_disable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.customer_places where user_id = new.id;
  return new;
end;
$$;

create trigger profiles_forget_places
  after update of disabled_at on public.profiles
  for each row
  when (old.disabled_at is null and new.disabled_at is not null)
  execute function public.forget_places_on_disable();

revoke execute on function public.place_json(public.customer_places) from public, anon, authenticated;
revoke execute on function public.places_list(uuid) from public, anon, authenticated;
revoke execute on function public.place_save(uuid, uuid, text, text, text, text, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.place_delete(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.set_display_name(uuid, text) from public, anon, authenticated;
revoke execute on function public.forget_places_on_disable() from public, anon, authenticated;
grant execute on function public.place_json(public.customer_places) to service_role;
grant execute on function public.places_list(uuid) to service_role;
grant execute on function public.place_save(uuid, uuid, text, text, text, text, double precision, double precision) to service_role;
grant execute on function public.place_delete(uuid, uuid) to service_role;
grant execute on function public.set_display_name(uuid, text) to service_role;
