-- Fixes from the 2026-10-19 bug list. Safe to run more than once.

-- 1. my_region() was callable by signed-out visitors (Supabase security advisor). Signed-in only.
revoke execute on function public.my_region() from public, anon;
grant execute on function public.my_region() to authenticated;

-- 2. Indexes for foreign keys the performance advisor flagged (deleting or joining a parent row
--    no longer scans the child table). gifts.gift_id / gifts.room_id are left out on purpose: gifts
--    is the hottest insert path, and nothing deletes gifts or rooms.
create index if not exists ai_actions_reviewed_by_idx on public.ai_actions (reviewed_by);
create index if not exists coin_packages_region_idx on public.coin_packages (region);
create index if not exists events_created_by_idx on public.events (created_by);
create index if not exists events_region_idx on public.events (region);
create index if not exists frame_purchases_frame_idx on public.frame_purchases (frame_id);
create index if not exists host_applications_reviewed_by_idx on public.host_applications (reviewed_by);
create index if not exists media_assets_stream_idx on public.media_assets (stream_id);
create index if not exists moderation_actions_actor_idx on public.moderation_actions (actor_id);
create index if not exists payments_agency_idx on public.payments (agency_id);
create index if not exists payments_package_idx on public.payments (package_id);
create index if not exists pinned_profiles_pinned_by_idx on public.pinned_profiles (pinned_by);
create index if not exists pk_battles_winner_room_idx on public.pk_battles (winner_room_id);
create index if not exists profiles_active_frame_idx on public.profiles (active_frame_id);
create index if not exists refund_requests_reviewed_by_idx on public.refund_requests (reviewed_by);
create index if not exists room_bans_created_by_idx on public.room_bans (created_by);
create index if not exists withdrawals_reviewed_by_idx on public.withdrawals (reviewed_by);

-- 3. A late LiveKit room_finished for the previous live (fixed room names) could end a new live
--    started within LiveKit's empty-room window. The webhook now passes when that LiveKit room was
--    created; an event for a room created well before the current stream started is ignored.
drop function if exists public.internal_end_stream_by_livekit_room(text);
create or replace function public.internal_end_stream_by_livekit_room(p_livekit_room text, p_room_created_at timestamptz default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room public.rooms;
begin
  select * into v_room from public.rooms where livekit_room = p_livekit_room;
  if not found then return; end if;
  if p_room_created_at is not null and exists (
    select 1 from public.streams where id = v_room.current_stream_id and started_at > p_room_created_at + interval '30 seconds'
  ) then
    return; -- the finished LiveKit room belonged to an earlier live
  end if;
  perform private.end_stream(v_room.id);
end $$;
revoke execute on function public.internal_end_stream_by_livekit_room(text, timestamptz) from public, anon, authenticated;
grant execute on function public.internal_end_stream_by_livekit_room(text, timestamptz) to service_role;

-- 4. Rooms stuck "live" when the host's app died before connecting to LiveKit (no LiveKit room, so
--    no room_finished ever arrives), and seats kept by a guest who left inside the 20-second
--    reconnect grace and never came back. With no scheduler (pg_cron) on the project, both are swept
--    by the LiveKit viewer events that already arrive for every join and leave.
alter table public.streams add column if not exists host_connected_at timestamptz;
-- Lives already running were connected (or are being ended by LiveKit as usual).
update public.streams set host_connected_at = started_at where ended_at is null and host_connected_at is null;

create or replace function private.end_unconnected_lives()
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room uuid;
begin
  for v_room in
    select r.id from public.rooms r join public.streams s on s.id = r.current_stream_id
    where r.status = 'live' and s.host_connected_at is null and s.started_at < now() - interval '10 minutes'
    order by s.started_at limit 5
  loop
    perform private.end_stream(v_room);
  end loop;
end $$;

create or replace function public.internal_viewer_event(p_livekit_room text, p_user text, p_joined boolean, p_count int)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room public.rooms; v_count int := greatest(coalesce(p_count, 0), 0);
begin
  if p_joined then perform private.end_unconnected_lives(); end if;
  select * into v_room from public.rooms where livekit_room = p_livekit_room;
  if not found or v_room.status <> 'live' then return; end if;
  if p_user is not null and p_user = v_room.host_id and p_joined then
    update public.streams set host_connected_at = now() where id = v_room.current_stream_id and host_connected_at is null;
  end if;
  if v_room.viewer_count is distinct from v_count then
    update public.rooms set viewer_count = v_count
      where id = (select id from public.rooms where id = v_room.id for update skip locked)
        and viewer_count is distinct from v_count;
  end if;
  update public.streams set peak_viewers = v_count
    where id = (select id from public.streams where id = v_room.current_stream_id and peak_viewers < v_count for update skip locked)
      and peak_viewers < v_count;
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
  -- Guests who left during their seat's 20-second grace and have stayed away for 20 seconds.
  delete from public.room_seats s
    where s.room_id = v_room.id and s.created_at < now() - interval '20 seconds'
      and exists (select 1 from public.viewers v
                  where v.stream_id = v_room.current_stream_id and v.user_id = s.user_id
                    and v.left_at is not null and v.left_at < now() - interval '20 seconds');
end $$;

-- 5. Profile photos: clients could set avatar_url to any address. Now only through set_avatar(),
--    which accepts a picture in the caller's own folder of the avatars bucket (or clears it).
--    Sign-in photos from Google/Apple are still set by the Clerk webhook (service role).
update public.platform_settings
  set value = value || jsonb_build_object('avatars_base', replace(value ->> 'covers_base', '/object/public/covers', '/object/public/avatars'))
  where key = 'media' and value ? 'covers_base' and not value ? 'avatars_base';

create or replace function public.set_avatar(p_path text)
returns public.profiles language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v_base text := private.setting('media') ->> 'avatars_base';
  v_exists boolean := true;
  v_profile public.profiles;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_path is not null then
    if split_part(p_path, '/', 1) <> uid or p_path !~ '^[^/]+/[A-Za-z0-9._-]{1,80}\.(jpg|jpeg|png|webp)$' then
      raise exception 'invalid_avatar';
    end if;
    if v_base is null then raise exception 'not_configured'; end if;
    if to_regclass('storage.objects') is not null then
      execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)' into v_exists using 'avatars', p_path;
    end if;
    if not v_exists then raise exception 'invalid_avatar'; end if;
  end if;
  update public.profiles
    set avatar_url = case when p_path is null then null else rtrim(v_base, '/') || '/' || p_path end
    where id = uid returning * into v_profile;
  return v_profile;
end $$;
revoke execute on function public.set_avatar(text) from public, anon;
grant execute on function public.set_avatar(text) to authenticated;
revoke update (avatar_url) on public.profiles from authenticated;

-- 6. DMs to strangers: up to 3 messages until the other person replies or follows back
--    (stops message spam to people who never answered).
create or replace function public.send_direct_message(p_recipient text, p_body text)
returns public.direct_messages language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_body text := trim(p_body); v_row public.direct_messages;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if char_length(v_body) not between 1 and 1000 then raise exception 'invalid_length'; end if;
  if exists (select 1 from public.user_blocks
             where (blocker_id = p_recipient and blocked_id = uid) or (blocker_id = uid and blocked_id = p_recipient)) then
    raise exception 'blocked';
  end if;
  if (select count(*) from public.direct_messages where sender_id = uid and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'slow_down';
  end if;
  if not exists (select 1 from public.follows where follower_id = p_recipient and followee_id = uid)
     and not exists (select 1 from public.direct_messages where sender_id = p_recipient and recipient_id = uid)
     and (select count(*) from public.direct_messages where sender_id = uid and recipient_id = p_recipient) >= 3 then
    raise exception 'wait_for_reply';
  end if;
  insert into public.direct_messages (sender_id, recipient_id, body) values (uid, p_recipient, private.filter_text(v_body))
    returning * into v_row;
  return v_row;
end $$;
