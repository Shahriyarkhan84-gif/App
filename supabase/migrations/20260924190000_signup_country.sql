-- Country the account was created from, shown on public profiles.
-- Recorded once when the profile is created and never changes afterwards
-- (unlike profiles.country, which the user can edit). Source: the edge's
-- country header when present (cf-ipcountry), else the device region the app
-- sends at sign-up. Accounts created before this change get it on their next
-- sign-in, once.

alter table public.profiles add column if not exists signup_country text check (signup_country ~ '^[A-Z]{2}$');
grant select (signup_country) on public.profiles to authenticated;

create or replace function private.request_country() returns text
language sql stable set search_path = ''
as $$
  select upper(nullif(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'cf-ipcountry', ''))
$$;

-- Frozen after it's first set; cleared when the account is deleted.
create or replace function private.profiles_signup_country() returns trigger
language plpgsql set search_path = ''
as $$
begin
  -- Deleted accounts lose it (personal data); otherwise it never changes once set.
  if new.deleted_at is not null then new.signup_country := null;
  elsif old.signup_country is not null then new.signup_country := old.signup_country;
  end if;
  return new;
end $$;
drop trigger if exists profiles_signup_country on public.profiles;
create trigger profiles_signup_country before update on public.profiles
  for each row execute function private.profiles_signup_country();

drop function if exists public.ensure_profile(text);
create or replace function public.ensure_profile(p_display_name text default null, p_region text default null)
returns public.profiles language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v public.profiles;
  v_country text := private.request_country();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if v_country is null or v_country !~ '^[A-Z]{2}$' or v_country in ('XX', 'T1') then
    v_country := case when upper(p_region) ~ '^[A-Z]{2}$' then upper(p_region) end;
  end if;
  insert into public.profiles (id, display_name, signup_country) values (uid, left(p_display_name, 50), v_country)
    on conflict (id) do nothing;
  update public.profiles set signup_country = v_country where id = uid and signup_country is null and v_country is not null;
  insert into public.wallets (user_id) values (uid) on conflict (user_id) do nothing;
  select * into v from public.profiles where id = uid;
  return v;
end $$;
revoke execute on function public.ensure_profile(text, text) from public, anon;
grant execute on function public.ensure_profile(text, text) to authenticated;
