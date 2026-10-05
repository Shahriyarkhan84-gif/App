-- Fixes from the third AI review pass (server side). Safe to run more than once.

-- 1. Gifts: who charged back (clawed_coins) and send keys are private. Everyone signed in can
--    still read the public gift feed columns.
revoke select on public.gifts from authenticated;
grant select (id, room_id, stream_id, sender_id, host_id, gift_id, quantity, coins_total, host_share, created_at)
  on public.gifts to authenticated;

-- 2. A room mute also takes the person off their party seat and out of the queue, and a muted
--    person can't be given a seat.
create or replace function private.unseat_on_room_ban()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind in ('kick', 'block') or (new.kind = 'mute' and (new.expires_at is null or new.expires_at > now())) then
    delete from public.room_seats where room_id = new.room_id and user_id = new.user_id;
    delete from public.seat_requests where room_id = new.room_id and user_id = new.user_id;
  end if;
  return new;
end $$;

create or replace function public.approve_seat(p_room uuid, p_user text)
returns smallint language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms; v_seat smallint;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found or not private.can_moderate_room(v_room, uid) then raise exception 'forbidden'; end if;
  if v_room.status <> 'live' or v_room.mode = 'live' then raise exception 'not_a_party'; end if;
  if not exists (select 1 from public.seat_requests where room_id = p_room and user_id = p_user) then raise exception 'no_request'; end if;
  if exists (select 1 from public.room_bans where room_id = p_room and user_id = p_user and kind in ('mute', 'kick', 'block')
             and (expires_at is null or expires_at > now())) then
    delete from public.seat_requests where room_id = p_room and user_id = p_user;
    raise exception 'banned_from_room';
  end if;
  select s into v_seat from generate_series(1, private.party_capacity(v_room.mode)) s
    where not exists (select 1 from public.room_seats where room_id = p_room and seat = s) order by s limit 1;
  if v_seat is null then raise exception 'seats_full'; end if;
  insert into public.room_seats (room_id, seat, user_id) values (p_room, v_seat, p_user);
  delete from public.seat_requests where room_id = p_room and user_id = p_user;
  perform private.audit('seat_approved', 'user', p_user, jsonb_build_object('room', p_room, 'seat', v_seat));
  return v_seat;
end $$;

-- 3. A just-approved guest reconnects with a guest token, and LiveKit reports the old connection
--    leaving: that must not delete the seat they were just given (20-second grace).
create or replace function public.internal_viewer_event(p_livekit_room text, p_user text, p_joined boolean, p_count int)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room public.rooms;
begin
  select * into v_room from public.rooms where livekit_room = p_livekit_room;
  if not found or v_room.status <> 'live' then return; end if;
  update public.rooms set viewer_count = greatest(p_count, 0) where id = v_room.id;
  update public.streams set peak_viewers = greatest(peak_viewers, p_count) where id = v_room.current_stream_id;
  if p_user is not null and p_user <> v_room.host_id and exists (select 1 from public.profiles where id = p_user) then
    if p_joined then
      insert into public.viewers (stream_id, user_id) values (v_room.current_stream_id, p_user)
        on conflict (stream_id, user_id) do update set left_at = null;
    else
      update public.viewers set left_at = now() where stream_id = v_room.current_stream_id and user_id = p_user;
      delete from public.room_seats where room_id = v_room.id and user_id = p_user and created_at < now() - interval '20 seconds';
      delete from public.seat_requests where room_id = v_room.id and user_id = p_user;
    end if;
  end if;
end $$;

-- 4. New profiles start with their signup country as their country, so Nearby works at once.
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
  update public.profiles set display_name = left(p_display_name, 50)
    where id = uid and display_name is null and nullif(trim(p_display_name), '') is not null;
  insert into public.wallets (user_id) values (uid) on conflict (user_id) do nothing;
  select * into v from public.profiles where id = uid;
  return v;
end $$;

-- 5. Translations: only the app's languages, only visible messages, at most 30 a minute per user
--    (each one is a paid AI call).
create or replace function public.request_translation(p_message_id bigint, p_language text)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_language not in ('en', 'ur', 'hi', 'bn') then raise exception 'invalid_language'; end if;
  if not exists (select 1 from public.messages where id = p_message_id and status = 'visible') then raise exception 'not_found'; end if;
  if exists (select 1 from public.message_translations where message_id = p_message_id and language = p_language) then return; end if;
  if (select count(*) from public.ai_jobs where kind = 'translate_message' and payload ->> 'requested_by' = uid
        and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'rate_limited';
  end if;
  perform private.enqueue_ai_job('translate_message',
    jsonb_build_object('message_id', p_message_id, 'language', p_language, 'requested_by', uid),
    'tr:' || p_message_id || ':' || p_language);
end $$;
