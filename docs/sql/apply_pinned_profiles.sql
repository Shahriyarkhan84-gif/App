-- Zynalive: verified IDs pinned on Home. Paste into Supabase → SQL Editor (project zynalive) → Run. Safe to run more than once.

-- Verified IDs pinned on Home. The owner verifies an account (blue badge) and pins verified
-- accounts to the top of Home, where everyone sees their profile whether or not they are live.
-- Only the owner (OWNER_ADMIN / SUPER_ADMIN) can verify or pin; clients only read the pin list.

create table if not exists public.pinned_profiles (
  user_id text primary key references public.profiles(id) on delete cascade,
  position int not null default 0,
  pinned_by text references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.pinned_profiles enable row level security;
drop policy if exists "pinned profiles public" on public.pinned_profiles;
create policy "pinned profiles public" on public.pinned_profiles for select using (true);
revoke all on public.pinned_profiles from anon, authenticated;
grant select (user_id, position, created_at) on public.pinned_profiles to anon, authenticated;

-- Owner marks an account verified (or removes it). Removing verification also unpins it.
create or replace function public.set_profile_verified(p_user text, p_verified boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  update public.profiles set verified_at = case when p_verified then coalesce(verified_at, now()) end where id = p_user;
  if not found then raise exception 'user_not_found'; end if;
  if not p_verified then delete from public.pinned_profiles where user_id = p_user; end if;
  perform private.audit(case when p_verified then 'profile_verified' else 'profile_unverified' end, 'user', p_user);
end $$;

-- Owner pins a verified account to Home (lower position shows first), or unpins it.
create or replace function public.set_profile_pinned(p_user text, p_pinned boolean, p_position int default 0)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if p_pinned then
    if not exists (select 1 from public.profiles where id = p_user and verified_at is not null and deleted_at is null) then
      raise exception 'not_verified';
    end if;
    if (select count(*) from public.pinned_profiles where user_id <> p_user) >= 20 then raise exception 'pin_limit'; end if;
    insert into public.pinned_profiles (user_id, position, pinned_by) values (p_user, coalesce(p_position, 0), public.requesting_user_id())
      on conflict (user_id) do update set position = excluded.position;
  else
    delete from public.pinned_profiles where user_id = p_user;
  end if;
  perform private.audit(case when p_pinned then 'profile_pinned' else 'profile_unpinned' end, 'user', p_user,
    jsonb_build_object('position', p_position));
end $$;

revoke execute on function public.set_profile_verified(text, boolean), public.set_profile_pinned(text, boolean, int) from public, anon;
grant execute on function public.set_profile_verified(text, boolean), public.set_profile_pinned(text, boolean, int) to authenticated;
