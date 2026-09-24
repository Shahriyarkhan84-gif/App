-- User IDs are now 8 random digits (e.g. 48213075) instead of 11.
-- Every existing profile gets a fresh 8-digit ID; new profiles get one at sign-up.

create or replace function private.new_user_number() returns bigint
language plpgsql volatile set search_path = ''
as $$
declare v bigint;
begin
  loop
    v := 10000000 + floor(random() * 90000000)::bigint;
    exit when not exists (select 1 from public.profiles where user_number = v);
  end loop;
  return v;
end $$;

alter table public.profiles drop constraint profiles_user_number_digits;

-- The trigger freezes user_number on update, so pause it for the one-off reissue.
alter table public.profiles disable trigger profiles_user_number;
do $$
declare r record;
begin
  for r in select id from public.profiles loop
    update public.profiles set user_number = private.new_user_number() where id = r.id;
  end loop;
end $$;
alter table public.profiles enable trigger profiles_user_number;

alter table public.profiles
  add constraint profiles_user_number_digits check (user_number between 10000000 and 99999999);
