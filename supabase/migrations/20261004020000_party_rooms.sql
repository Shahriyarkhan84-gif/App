-- Party rooms (design canvas: Voice party room, Video party room).
-- A host's room can run as a normal live ('live'), a voice party ('voice', up to
-- 8 guest seats, audio only) or a video party ('video', up to 6 guest seats).
-- Viewers ask for a seat; the host (or a room admin while live) approves. Guests
-- can leave or mute themselves; the host/admins can remove them. Seats and
-- requests are cleared when the room goes offline. Clients never write these
-- tables directly — everything goes through the security definer RPCs below, and
-- livekit-token only lets a seated guest publish.

alter table public.rooms add column if not exists mode text not null default 'live'
  check (mode in ('live', 'voice', 'video'));

create table if not exists public.room_seats (
  room_id uuid not null references public.rooms(id) on delete cascade,
  seat smallint not null check (seat between 1 and 8),
  user_id text not null references public.profiles(id) on delete cascade,
  muted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (room_id, seat),
  unique (room_id, user_id)
);

create table if not exists public.seat_requests (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_seats enable row level security;
alter table public.seat_requests enable row level security;

drop policy if exists "room seats public" on public.room_seats;
create policy "room seats public" on public.room_seats for select using (true);

-- Requests: the requester sees their own; the host and admins see the queue.
drop policy if exists "seat requests own or staff" on public.seat_requests;
create policy "seat requests own or staff" on public.seat_requests for select using (
  user_id = public.requesting_user_id()
  or exists (select 1 from public.rooms r where r.id = room_id and private.can_moderate_room(r, public.requesting_user_id()))
);

revoke all on public.room_seats, public.seat_requests from anon, authenticated;
grant select on public.room_seats to anon, authenticated;
grant select on public.seat_requests to authenticated;

create or replace function private.party_capacity(p_mode text)
returns smallint language sql immutable set search_path = ''
as $$ select case p_mode when 'voice' then 8 when 'video' then 6 else 0 end::smallint $$;

-- Host picks the room mode (before or during a live).
create or replace function public.set_room_mode(p_mode text)
returns public.rooms language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms;
begin
  if p_mode not in ('live', 'voice', 'video') then raise exception 'invalid_mode'; end if;
  select * into v_room from public.rooms where host_id = uid for update;
  if not found then raise exception 'not_a_host'; end if;
  update public.rooms set mode = p_mode, updated_at = now() where id = v_room.id returning * into v_room;
  -- Switching to a normal live, or to fewer seats, frees seats that no longer exist.
  delete from public.room_seats where room_id = v_room.id and seat > private.party_capacity(p_mode);
  if p_mode = 'live' then delete from public.seat_requests where room_id = v_room.id; end if;
  return v_room;
end $$;

-- A viewer asks for a seat in a live party.
create or replace function public.request_seat(p_room uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms;
begin
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  select * into v_room from public.rooms where id = p_room;
  if not found or v_room.status <> 'live' or v_room.mode = 'live' then raise exception 'not_a_party'; end if;
  if v_room.host_id = uid then raise exception 'host_has_seat'; end if;
  if exists (select 1 from public.room_bans where room_id = p_room and user_id = uid and kind in ('mute', 'kick', 'block')
             and (expires_at is null or expires_at > now())) then
    raise exception 'banned_from_room';
  end if;
  if exists (select 1 from public.room_seats where room_id = p_room and user_id = uid) then return; end if;
  insert into public.seat_requests (room_id, user_id) values (p_room, uid) on conflict do nothing;
end $$;

-- Host/admin seats a requester in the lowest free seat.
create or replace function public.approve_seat(p_room uuid, p_user text)
returns smallint language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms; v_seat smallint;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found or not private.can_moderate_room(v_room, uid) then raise exception 'forbidden'; end if;
  if v_room.status <> 'live' or v_room.mode = 'live' then raise exception 'not_a_party'; end if;
  if not exists (select 1 from public.seat_requests where room_id = p_room and user_id = p_user) then raise exception 'no_request'; end if;
  select s into v_seat from generate_series(1, private.party_capacity(v_room.mode)) s
    where not exists (select 1 from public.room_seats where room_id = p_room and seat = s) order by s limit 1;
  if v_seat is null then raise exception 'seats_full'; end if;
  insert into public.room_seats (room_id, seat, user_id) values (p_room, v_seat, p_user);
  delete from public.seat_requests where room_id = p_room and user_id = p_user;
  perform private.audit('seat_approved', 'user', p_user, jsonb_build_object('room', p_room, 'seat', v_seat));
  return v_seat;
end $$;

-- Host/admin declines a request or removes a guest from their seat.
create or replace function public.remove_from_seat(p_room uuid, p_user text)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room;
  if not found or not private.can_moderate_room(v_room, uid) then raise exception 'forbidden'; end if;
  delete from public.room_seats where room_id = p_room and user_id = p_user;
  delete from public.seat_requests where room_id = p_room and user_id = p_user;
end $$;

-- A guest leaves their seat or withdraws their request.
create or replace function public.leave_seat(p_room uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.room_seats where room_id = p_room and user_id = public.requesting_user_id();
  delete from public.seat_requests where room_id = p_room and user_id = public.requesting_user_id();
end $$;

-- A guest mutes/unmutes their own seat (shown on the seat; the mic itself is muted on device).
create or replace function public.set_seat_muted(p_room uuid, p_muted boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.room_seats set muted = p_muted where room_id = p_room and user_id = public.requesting_user_id();
  if not found then raise exception 'not_seated'; end if;
end $$;

-- Seats and requests end with the live.
create or replace function private.clear_party_on_offline()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'live' and old.status = 'live' then
    delete from public.room_seats where room_id = new.id;
    delete from public.seat_requests where room_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists clear_party_on_offline on public.rooms;
create trigger clear_party_on_offline after update of status on public.rooms
  for each row execute function private.clear_party_on_offline();

revoke execute on function public.set_room_mode(text), public.request_seat(uuid), public.approve_seat(uuid, text),
  public.remove_from_seat(uuid, text), public.leave_seat(uuid), public.set_seat_muted(uuid, boolean) from public, anon;
grant execute on function public.set_room_mode(text), public.request_seat(uuid), public.approve_seat(uuid, text),
  public.remove_from_seat(uuid, text), public.leave_seat(uuid), public.set_seat_muted(uuid, boolean) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.room_seats, public.seat_requests;
  end if;
end $$;
