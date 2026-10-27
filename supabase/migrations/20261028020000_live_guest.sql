-- Request to join a solo live: a normal live ('live' mode) gets one guest seat, using the same
-- seat_requests → approve_seat → room_seats flow as party rooms. livekit-token lets the seated
-- guest publish camera + mic. No guest requests while the host is in a PK battle.

create or replace function private.party_capacity(p_mode text)
returns smallint language sql immutable set search_path = ''
as $$ select case p_mode when 'voice' then 8 when 'video' then 6 when 'live' then 1 else 0 end::smallint $$;

create or replace function public.request_seat(p_room uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms; v_kind text;
begin
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  select * into v_room from public.rooms where id = p_room;
  if not found or v_room.status <> 'live' then raise exception 'not_a_party'; end if;
  if v_room.mode = 'live' and v_room.current_battle_id is not null then raise exception 'in_pk_battle'; end if;
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
  if v_room.status <> 'live' then raise exception 'not_a_party'; end if;
  if v_room.mode = 'live' and v_room.current_battle_id is not null then raise exception 'in_pk_battle'; end if;
  if not exists (select 1 from public.seat_requests where room_id = p_room and user_id = p_user) then raise exception 'no_request'; end if;
  if public.user_status(p_user) <> 'active' then
    delete from public.seat_requests where room_id = p_room and user_id = p_user;
    raise exception 'account_restricted';
  end if;
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

-- A PK battle starting ends the solo guest's turn (the split screen has no room for a guest).
create or replace function private.clear_live_guest_on_battle()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.mode = 'live' and new.current_battle_id is not null and old.current_battle_id is null then
    delete from public.room_seats where room_id = new.id;
    delete from public.seat_requests where room_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists clear_live_guest_on_battle on public.rooms;
create trigger clear_live_guest_on_battle after update of current_battle_id on public.rooms
  for each row execute function private.clear_live_guest_on_battle();
