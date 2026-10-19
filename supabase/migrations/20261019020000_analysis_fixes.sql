-- Fixes from the 2026-10-19 app analysis (docs/reports/APP_ANALYSIS.md). Safe to run more than once.
-- Needs 20261019010000_bug_fixes.sql first (private.end_unconnected_lives).

-- H2. Rate limits that can't silently switch off: when Upstash isn't configured the Edge Functions
--     count requests here instead (fixed window per action + user). Service role only.
create table if not exists private.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits int not null
);

create or replace function public.internal_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_hits int;
begin
  insert into private.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  -- Now and then, forget counters whose window ended long ago (the longest window used is 24 h).
  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '2 days';
  end if;
  return v_hits <= p_limit;
end $$;
revoke execute on function public.internal_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.internal_rate_limit(text, int, int) to service_role;

-- H1. Host verification checks that a live person took the "face with CNIC" photo (Didit passive
--     liveness). Auto-approval now needs liveness Approved; anything else goes to a person.
alter table public.host_applications add column if not exists liveness_status text;

drop function if exists public.internal_submit_host_application(text, text, text, text, text, text, text, int, boolean, boolean, int, text, text);
create or replace function public.internal_submit_host_application(
  p_user text, p_full_name text, p_phone text, p_cnic_last4 text, p_agency_code text,
  p_id_status text, p_face_status text, p_face_score int, p_cnic_match boolean, p_name_match boolean,
  p_age int, p_id_request text, p_face_request text, p_liveness_status text default null
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_agency uuid;
  v_status text;
  v_reasons text[] := '{}';
  v_app public.host_applications;
begin
  if public.user_status(p_user) <> 'active' then raise exception 'account_restricted'; end if;
  if exists (select 1 from public.hosts where user_id = p_user and verification_status = 'approved') then
    raise exception 'already_verified';
  end if;

  if nullif(trim(p_agency_code), '') is null then raise exception 'agency_code_required'; end if;
  select id into v_agency from public.agencies where code = trim(p_agency_code) and status = 'active';
  if v_agency is null then raise exception 'invalid_agency_code'; end if;

  if (p_age is not null and p_age < 18) or p_id_status = 'Declined' or p_face_status = 'Declined' then
    -- Hard fails.
    v_status := 'declined';
    if p_age is not null and p_age < 18 then v_reasons := array_append(v_reasons, 'underage'); end if;
    if p_id_status = 'Declined' then v_reasons := array_append(v_reasons, 'id_declined'); end if;
    if p_face_status = 'Declined' then v_reasons := array_append(v_reasons, 'face_mismatch'); end if;
  elsif p_id_status = 'Approved' and p_face_status = 'Approved' and p_age is not null
        and p_liveness_status = 'Approved'
        and coalesce((private.setting('host_verification') ->> 'auto_approve')::boolean, false) then
    -- Verified by Didit (document, face match and a live person) and the owner turned on auto-approval.
    v_status := 'approved';
  elsif p_id_status = 'Approved' and p_face_status = 'Approved' and p_age is not null then
    -- Everything matched, but a person approves: auto-approval is off, or liveness wasn't confirmed
    -- (a printed or on-screen photo, or the check couldn't run).
    v_status := 'in_review';
    v_reasons := array_append(v_reasons, case
      when p_liveness_status is null then 'liveness_not_checked'
      when p_liveness_status = 'Approved' then 'manual_review'
      else 'liveness_failed' end);
  else
    -- Didit hasn't reached a decision (or the age couldn't be read): a person decides.
    v_status := 'in_review';
    if p_id_status is distinct from 'Approved' then v_reasons := array_append(v_reasons, 'id_needs_review'); end if;
    if p_face_status is distinct from 'Approved' then v_reasons := array_append(v_reasons, 'face_needs_review'); end if;
    if p_age is null then v_reasons := array_append(v_reasons, 'age_unknown'); end if;
    if p_liveness_status is distinct from 'Approved' then v_reasons := array_append(v_reasons, 'liveness_failed'); end if;
  end if;
  -- Notes only; never block approval.
  if p_cnic_match is not true then v_reasons := array_append(v_reasons, 'cnic_mismatch'); end if;
  if p_name_match is not true then v_reasons := array_append(v_reasons, 'name_mismatch'); end if;

  perform private.ensure_host(p_user);

  insert into public.host_applications (user_id, full_name, phone, cnic_last4, agency_code, agency_id, id_status, face_status,
    face_score, cnic_match, name_match, age, status, reasons, didit_id_request, didit_face_request, liveness_status)
  values (p_user, trim(p_full_name), p_phone, p_cnic_last4, trim(p_agency_code), v_agency, p_id_status, p_face_status,
    p_face_score, p_cnic_match, p_name_match, p_age, v_status, v_reasons, p_id_request, p_face_request, p_liveness_status)
  returning * into v_app;

  perform private.apply_host_decision(v_app);
  perform private.audit('host_application_' || v_status, 'user', p_user,
    jsonb_build_object('application_id', v_app.id, 'reasons', v_reasons), 'system');
  return jsonb_build_object('id', v_app.id, 'status', v_status, 'reasons', v_reasons);
end $$;
revoke execute on function public.internal_submit_host_application(text, text, text, text, text, text, text, int, boolean, boolean, int, text, text, text) from public, anon, authenticated;
grant execute on function public.internal_submit_host_application(text, text, text, text, text, text, text, int, boolean, boolean, int, text, text, text) to service_role;

-- L3. Lives whose host never connected were only ended when someone joined a live. Every new live
--     now sweeps them too, so a quiet night doesn't leave dead rooms on Home.
create or replace function private.sweep_unconnected_lives()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform private.end_unconnected_lives();
  return null;
end $$;
drop trigger if exists streams_sweep_unconnected on public.streams;
create trigger streams_sweep_unconnected after insert on public.streams
  for each statement execute function private.sweep_unconnected_lives();

-- L7. People search (`ilike '%term%'` on username and display name) uses trigram indexes instead of
--     reading every profile.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
do $$
declare v_schema text;
begin
  select n.nspname into v_schema from pg_opclass o join pg_namespace n on n.oid = o.opcnamespace
    where o.opcname = 'gin_trgm_ops' limit 1;
  execute format('create index if not exists profiles_username_trgm_idx on public.profiles using gin (username %I.gin_trgm_ops)', v_schema);
  execute format('create index if not exists profiles_display_name_trgm_idx on public.profiles using gin (display_name %I.gin_trgm_ops)', v_schema);
end $$;

-- L4. The viewer count came from LiveKit's participant count minus one for the host, which is one
--     too low while the host is reconnecting. Count the viewers who are in the live instead
--     (signed-in viewers other than the host, one per account). p_count is kept for the webhook's
--     call signature and no longer used.
create or replace function public.internal_viewer_event(p_livekit_room text, p_user text, p_joined boolean, p_count int)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room public.rooms; v_count int;
begin
  if p_joined then perform private.end_unconnected_lives(); end if;
  select * into v_room from public.rooms where livekit_room = p_livekit_room;
  if not found or v_room.status <> 'live' then return; end if;
  if p_user is not null and p_user = v_room.host_id and p_joined then
    update public.streams set host_connected_at = now() where id = v_room.current_stream_id and host_connected_at is null;
  end if;
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
  select count(*) into v_count from public.viewers
    where stream_id = v_room.current_stream_id and left_at is null and user_id <> v_room.host_id;
  if v_room.viewer_count is distinct from v_count then
    update public.rooms set viewer_count = v_count
      where id = (select id from public.rooms where id = v_room.id for update skip locked)
        and viewer_count is distinct from v_count;
  end if;
  update public.streams set peak_viewers = v_count
    where id = (select id from public.streams where id = v_room.current_stream_id and peak_viewers < v_count for update skip locked)
      and peak_viewers < v_count;
  -- Guests who left during their seat's 20-second grace and have stayed away for 20 seconds.
  delete from public.room_seats s
    where s.room_id = v_room.id and s.created_at < now() - interval '20 seconds'
      and exists (select 1 from public.viewers v
                  where v.stream_id = v_room.current_stream_id and v.user_id = s.user_id
                    and v.left_at is not null and v.left_at < now() - interval '20 seconds');
end $$;
