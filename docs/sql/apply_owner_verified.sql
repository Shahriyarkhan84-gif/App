-- Zynalive: owner blue tick (separate from the Host badge) + round-4 fixes. Paste into Supabase → SQL Editor (project zynalive) → Run. Safe to run more than once.

-- Owner verification gets its own column. profiles.verified_at stays the Didit host verification
-- (Host badge, kept in sync by the hosts trigger); owner_verified_at is the owner's blue tick and
-- what Home pins require. One writer each, so a Didit result never undoes the owner's choice.

alter table public.profiles add column if not exists owner_verified_at timestamptz;
grant select (owner_verified_at) on public.profiles to authenticated;

create or replace function public.set_profile_verified(p_user text, p_verified boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  update public.profiles set owner_verified_at = case when p_verified then coalesce(owner_verified_at, now()) end
    where id = p_user and deleted_at is null;
  if not found then raise exception 'user_not_found'; end if;
  if not p_verified then delete from public.pinned_profiles where user_id = p_user; end if;
  perform private.audit(case when p_verified then 'profile_verified' else 'profile_unverified' end, 'user', p_user);
end $$;

create or replace function public.set_profile_pinned(p_user text, p_pinned boolean, p_position int default 0)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if p_pinned then
    if not exists (select 1 from public.profiles where id = p_user and owner_verified_at is not null and deleted_at is null) then
      raise exception 'not_verified';
    end if;
    -- Only pins that actually show on Home count towards the limit.
    if (select count(*) from public.pinned_profiles pp join public.profiles p on p.id = pp.user_id
        where pp.user_id <> p_user and p.owner_verified_at is not null and p.deleted_at is null) >= 20 then
      raise exception 'pin_limit';
    end if;
    insert into public.pinned_profiles (user_id, position, pinned_by) values (p_user, coalesce(p_position, 0), public.requesting_user_id())
      on conflict (user_id) do update set position = excluded.position;
  else
    delete from public.pinned_profiles where user_id = p_user;
  end if;
  perform private.audit(case when p_pinned then 'profile_pinned' else 'profile_unpinned' end, 'user', p_user,
    jsonb_build_object('position', p_position));
end $$;

-- A deleted account loses its owner tick and its pin.
create or replace function private.clear_owner_verification_on_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    new.owner_verified_at := null;
    delete from public.pinned_profiles where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists clear_owner_verification_on_delete on public.profiles;
create trigger clear_owner_verification_on_delete before update of deleted_at on public.profiles
  for each row execute function private.clear_owner_verification_on_delete();

-- Profiles whose display name was saved as an empty string also get the Clerk name/username.
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
  insert into public.profiles (id, display_name, signup_country, country) values (uid, left(p_display_name, 50), v_country, v_country)
    on conflict (id) do nothing;
  update public.profiles set signup_country = v_country where id = uid and signup_country is null and v_country is not null;
  update public.profiles set display_name = left(trim(p_display_name), 50)
    where id = uid and nullif(trim(display_name), '') is null and nullif(trim(p_display_name), '') is not null;
  insert into public.wallets (user_id) values (uid) on conflict (user_id) do nothing;
  select * into v from public.profiles where id = uid;
  return v;
end $$;

-- A muted person is told they're muted (not "can't join this room") when asking for a seat or
-- being given one; kicks and blocks keep banned_from_room.
create or replace function public.request_seat(p_room uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms; v_kind text;
begin
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  select * into v_room from public.rooms where id = p_room;
  if not found or v_room.status <> 'live' or v_room.mode = 'live' then raise exception 'not_a_party'; end if;
  if v_room.host_id = uid then raise exception 'host_has_seat'; end if;
  select kind into v_kind from public.room_bans where room_id = p_room and user_id = uid and kind in ('mute', 'kick', 'block')
    and (expires_at is null or expires_at > now()) order by (kind = 'mute') limit 1;
  if v_kind = 'mute' then raise exception 'muted_in_room'; elsif v_kind is not null then raise exception 'banned_from_room'; end if;
  if exists (select 1 from public.room_seats where room_id = p_room and user_id = uid) then return; end if;
  insert into public.seat_requests (room_id, user_id) values (p_room, uid) on conflict do nothing;
end $$;

create or replace function public.approve_seat(p_room uuid, p_user text)
returns smallint language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms; v_seat smallint; v_kind text;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found or not private.can_moderate_room(v_room, uid) then raise exception 'forbidden'; end if;
  if v_room.status <> 'live' or v_room.mode = 'live' then raise exception 'not_a_party'; end if;
  if not exists (select 1 from public.seat_requests where room_id = p_room and user_id = p_user) then raise exception 'no_request'; end if;
  select kind into v_kind from public.room_bans where room_id = p_room and user_id = p_user and kind in ('mute', 'kick', 'block')
    and (expires_at is null or expires_at > now()) order by (kind = 'mute') limit 1;
  if v_kind is not null then
    delete from public.seat_requests where room_id = p_room and user_id = p_user;
    if v_kind = 'mute' then raise exception 'muted_in_room'; else raise exception 'banned_from_room'; end if;
  end if;
  select s into v_seat from generate_series(1, private.party_capacity(v_room.mode)) s
    where not exists (select 1 from public.room_seats where room_id = p_room and seat = s) order by s limit 1;
  if v_seat is null then raise exception 'seats_full'; end if;
  insert into public.room_seats (room_id, seat, user_id) values (p_room, v_seat, p_user);
  delete from public.seat_requests where room_id = p_room and user_id = p_user;
  perform private.audit('seat_approved', 'user', p_user, jsonb_build_object('room', p_room, 'seat', v_seat));
  return v_seat;
end $$;
