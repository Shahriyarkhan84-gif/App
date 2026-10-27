-- Ideas taken from the iOS/Android page set (not its look):
--  * Birthday check: everyone gives a birth date once; under-18s are restricted everywhere
--    (user_status() reports them 'restricted', which every action RPC already refuses).
--  * Interests: the topics picked after sign-up order Discover.
--  * Fan club: free to join for a host's followers; members get a Fan badge in that host's chat.
--  * Chat list options: pin, mute or clear a conversation (your own rows only).

-- Birthday ------------------------------------------------------------------------------
-- The date itself stays private; the profile only says adult / minor / unknown (not readable by others).
create table if not exists private.birthdates (
  user_id text primary key references public.profiles(id) on delete cascade,
  birth_date date not null,
  created_at timestamptz not null default now()
);
alter table private.birthdates enable row level security;
revoke all on private.birthdates from public, anon, authenticated;

alter table public.profiles add column if not exists age_check text not null default 'unknown'
  check (age_check in ('unknown', 'adult', 'minor'));

-- Set once. A wrong date is fixed by support, so a minor can't simply try again with another year.
create or replace function public.set_birth_date(p_birth_date date)
returns text language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_birth_date is null or p_birth_date > current_date or p_birth_date < date '1900-01-01' then
    raise exception 'invalid_birth_date';
  end if;
  if exists (select 1 from private.birthdates where user_id = uid) then raise exception 'birth_date_already_set'; end if;
  v := case when p_birth_date <= (current_date - interval '18 years')::date then 'adult' else 'minor' end;
  insert into private.birthdates (user_id, birth_date) values (uid, p_birth_date);
  update public.profiles set age_check = v where id = uid;
  perform private.audit('birth_date_set', 'profile', uid, jsonb_build_object('result', v));
  return v;
end $$;
revoke all on function public.set_birth_date(date) from public, anon;
grant execute on function public.set_birth_date(date) to authenticated;

-- Moderation status wins; otherwise a minor is 'restricted' (no live, gifts, messages, PK, purchases).
create or replace function public.user_status(p_user text)
returns public.account_status language sql stable security definer set search_path = ''
as $$
  select case
    when p.status <> 'active' and (p.status_until is null or p.status_until > now()) then p.status
    when p.age_check = 'minor' then 'restricted'::public.account_status
    else 'active'::public.account_status end
  from public.profiles p where p.id = p_user
$$;

-- Interests -----------------------------------------------------------------------------
alter table public.profiles add column if not exists interests text[] not null default '{}'
  check (cardinality(interests) <= 6 and interests <@ array['chat', 'music', 'gaming', 'talent', 'education', 'other']);
grant update (interests) on public.profiles to authenticated;

-- Fan club ------------------------------------------------------------------------------
create table if not exists public.fan_club_members (
  host_id text not null references public.profiles(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (host_id, user_id),
  check (host_id <> user_id)
);
create index if not exists fan_club_members_user_idx on public.fan_club_members (user_id);
alter table public.fan_club_members enable row level security;
drop policy if exists "fan clubs public" on public.fan_club_members;
create policy "fan clubs public" on public.fan_club_members for select to authenticated using (true);
-- Join only yourself, only a host's club, only one you follow, and only while your account is active.
drop policy if exists "join fan club as self" on public.fan_club_members;
create policy "join fan club as self" on public.fan_club_members for insert to authenticated with check (
  user_id = public.requesting_user_id()
  and public.user_status(user_id) = 'active'
  and exists (select 1 from public.hosts h where h.user_id = host_id)
  and exists (select 1 from public.follows f where f.follower_id = user_id and f.followee_id = host_id)
);
drop policy if exists "leave fan club as self" on public.fan_club_members;
create policy "leave fan club as self" on public.fan_club_members for delete to authenticated
  using (user_id = public.requesting_user_id());
revoke all on public.fan_club_members from anon, authenticated;
grant select, insert, delete on public.fan_club_members to authenticated;

-- Chat list options ---------------------------------------------------------------------
create table if not exists public.dm_thread_prefs (
  user_id text not null references public.profiles(id) on delete cascade,
  other_id text not null references public.profiles(id) on delete cascade,
  pinned boolean not null default false,
  muted boolean not null default false,
  cleared_at timestamptz,               -- "Delete chat": messages up to here are hidden for you only
  primary key (user_id, other_id)
);
alter table public.dm_thread_prefs enable row level security;
drop policy if exists "own thread prefs" on public.dm_thread_prefs;
create policy "own thread prefs" on public.dm_thread_prefs for all to authenticated
  using (user_id = public.requesting_user_id()) with check (user_id = public.requesting_user_id());
revoke all on public.dm_thread_prefs from anon, authenticated;
grant select, insert, update, delete on public.dm_thread_prefs to authenticated;

-- Under-18s can't buy diamonds (same function as 20261015010000_checkout_reuse.sql plus the age check).
create or replace function public.internal_create_payment(p_user text, p_package_id int)
returns public.payments language plpgsql security definer set search_path = ''
as $$
declare v_pkg public.coin_packages; v_row public.payments;
begin
  select * into v_pkg from public.coin_packages where id = p_package_id and active;
  if not found then raise exception 'invalid_package'; end if;
  if v_pkg.region <> private.user_region(p_user) then raise exception 'invalid_package'; end if;
  if public.user_status(p_user) = 'banned' then raise exception 'account_restricted'; end if;
  if (select age_check from public.profiles where id = p_user) = 'minor' then raise exception 'under_18'; end if;

  perform pg_advisory_xact_lock(hashtextextended('checkout:' || p_user, 0));
  select * into v_row from public.payments
    where user_id = p_user and package_id = v_pkg.id and status = 'pending'
      and provider = 'stripe' and created_at > now() - interval '30 minutes'
    order by created_at desc limit 1;
  if found then return v_row; end if;

  insert into public.payments (user_id, package_id, coins, amount_minor, currency)
  values (p_user, v_pkg.id, v_pkg.coins, v_pkg.price_minor, v_pkg.currency)
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.internal_create_payment(text, int) from public, anon, authenticated;
grant execute on function public.internal_create_payment(text, int) to service_role;
