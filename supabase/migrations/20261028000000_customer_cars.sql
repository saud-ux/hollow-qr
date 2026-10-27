-- The customer's Account page: saved cars for curbside pickup, picked with one
-- tap at checkout. A car has a name (as people call it: كامري، جمس), a colour
-- and, optionally, its Saudi plate (letters in their Latin form, then digits).
-- An order keeps its car as text in orders.car_description, as before.

create table public.customer_cars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null
    constraint customer_cars_name_length check (char_length(btrim(name)) between 1 and 30),
  color text not null
    constraint customer_cars_color check (color in ('black', 'white', 'lead', 'gray', 'other')),
  -- The customer's own colour, only for "other".
  color_name text
    constraint customer_cars_color_name_length check (color_name is null or char_length(btrim(color_name)) between 1 and 20),
  plate_letters text
    constraint customer_cars_plate_letters check (plate_letters is null or plate_letters ~ '^[ABJDRSXTEGKLZNHUV]{1,3}$'),
  plate_numbers text
    constraint customer_cars_plate_numbers check (plate_numbers is null or plate_numbers ~ '^[0-9]{1,4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_cars_color_name_for_other check ((color = 'other') = (color_name is not null)),
  constraint customer_cars_whole_plate check ((plate_letters is null) = (plate_numbers is null))
);

create index customer_cars_user_idx on public.customer_cars (user_id, created_at);

alter table public.customer_cars enable row level security;
revoke all on table public.customer_cars from anon, authenticated;
grant all on table public.customer_cars to service_role;

create function public.car_json(c public.customer_cars)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'color', c.color, 'colorName', c.color_name,
    'plateLetters', c.plate_letters, 'plateNumbers', c.plate_numbers
  );
$$;

-- In the order they were added.
create function public.cars_list(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.car_json(c) order by c.created_at, c.id), '[]'::jsonb)
    from public.customer_cars c
   where c.user_id = p_user_id;
$$;

-- Adds (p_id null) or edits a car; a customer keeps at most 5 cars.
create function public.car_save(
  p_user_id uuid,
  p_id uuid,
  p_name text,
  p_color text,
  p_color_name text,
  p_plate_letters text,
  p_plate_numbers text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.customer_cars;
  color_name_value text := case when p_color = 'other' then nullif(btrim(p_color_name), '') end;
begin
  perform 1 from public.profiles where id = p_user_id and disabled_at is null for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if p_id is null then
    if (select count(*) from public.customer_cars where user_id = p_user_id) >= 5 then
      return jsonb_build_object('ok', false, 'code', 'CARS_LIMIT');
    end if;
    insert into public.customer_cars (user_id, name, color, color_name, plate_letters, plate_numbers)
    values (p_user_id, btrim(p_name), p_color, color_name_value, p_plate_letters, p_plate_numbers)
    returning * into saved;
  else
    update public.customer_cars
       set name = btrim(p_name), color = p_color, color_name = color_name_value,
           plate_letters = p_plate_letters, plate_numbers = p_plate_numbers, updated_at = now()
     where id = p_id and user_id = p_user_id
    returning * into saved;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'car', public.car_json(saved));
end;
$$;

create function public.car_delete(p_user_id uuid, p_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.customer_cars where id = p_id and user_id = p_user_id returning 1
  )
  select exists (select 1 from gone);
$$;

-- A removed account (deleted customer or removed staff) forgets its cars.
create function public.forget_cars_on_disable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.customer_cars where user_id = new.id;
  return new;
end;
$$;

create trigger profiles_forget_cars
  after update of disabled_at on public.profiles
  for each row
  when (old.disabled_at is null and new.disabled_at is not null)
  execute function public.forget_cars_on_disable();

revoke execute on function public.car_json(public.customer_cars) from public, anon, authenticated;
revoke execute on function public.cars_list(uuid) from public, anon, authenticated;
revoke execute on function public.car_save(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.car_delete(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.forget_cars_on_disable() from public, anon, authenticated;
grant execute on function public.car_json(public.customer_cars) to service_role;
grant execute on function public.cars_list(uuid) to service_role;
grant execute on function public.car_save(uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.car_delete(uuid, uuid) to service_role;
