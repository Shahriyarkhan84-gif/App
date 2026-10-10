-- Viral lives (load test, docs/LOAD_TEST.md): every LiveKit join/leave rewrote the room's
-- viewer_count and the stream's peak_viewers, so thousands of joins to one room queued on those
-- two rows (~460 events/s, p95 0.34 s). Now:
--   * viewer_count: written only if it changed, and skipped when another event is writing it
--     (SKIP LOCKED); LiveKit sends the full participant count with every event, so the next one
--     sets it right.
--   * peak_viewers: written only when the count is higher (and skipped while another event holds
--     the row; a later, higher count still raises it).
-- Joining/leaving bookkeeping (viewers, seats, seat requests) is unchanged. Safe to run more than once.
create or replace function public.internal_viewer_event(p_livekit_room text, p_user text, p_joined boolean, p_count int)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room public.rooms; v_count int := greatest(coalesce(p_count, 0), 0);
begin
  select * into v_room from public.rooms where livekit_room = p_livekit_room;
  if not found or v_room.status <> 'live' then return; end if;
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
end $$;
