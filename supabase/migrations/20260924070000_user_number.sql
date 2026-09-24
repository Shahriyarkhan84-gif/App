-- Public 11-digit user ID (e.g. 48213075916), assigned automatically when a
-- profile is created and never changeable. Random rather than sequential so it
-- doesn't reveal how many users exist.

alter table public.profiles add column user_number bigint;

create or replace function private.new_user_number() returns bigint
language plpgsql volatile set search_path = ''
as $$
declare v bigint;
begin
  loop
    v := 10000000000 + floor(random() * 90000000000)::bigint;
    exit when not exists (select 1 from public.profiles where user_number = v);
  end loop;
  return v;
end $$;

-- Always assigned by the database on insert (client values are ignored) and
-- frozen afterwards, whoever writes the row.
create or replace function private.profiles_user_number() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.user_number := private.new_user_number();
  else
    new.user_number := old.user_number;
  end if;
  return new;
end $$;

-- Existing profiles, one at a time so each sees the numbers already taken.
do $$
declare r record;
begin
  for r in select id from public.profiles where user_number is null loop
    update public.profiles set user_number = private.new_user_number() where id = r.id;
  end loop;
end $$;

create trigger profiles_user_number
  before insert or update on public.profiles
  for each row execute function private.profiles_user_number();

alter table public.profiles
  alter column user_number set not null,
  add constraint profiles_user_number_key unique (user_number),
  add constraint profiles_user_number_digits check (user_number between 10000000000 and 99999999999);

-- Readable like other public profile fields; no client update grant.
grant select (user_number) on public.profiles to authenticated;
