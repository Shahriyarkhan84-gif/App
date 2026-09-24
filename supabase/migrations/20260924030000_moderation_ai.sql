-- Safety & moderation, AI system tables, and the RPCs the app calls for
-- rooms, chat, social, agencies and admin work.

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id text not null references public.profiles(id),
  target_type text not null check (target_type in ('user', 'room', 'message')),
  target_id text not null,
  target_user_id text references public.profiles(id),
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  ai_assessment jsonb,
  created_at timestamptz not null default now()
);
create index reports_status_idx on public.reports (status, created_at desc);
create index reports_target_user_idx on public.reports (target_user_id);

-- Action ladder: warning -> temp restriction -> temp ban -> permanent ban
-- (+ content removal, account review).
create table public.moderation_actions (
  id bigint generated always as identity primary key,
  target_user_id text not null references public.profiles(id),
  action text not null check (action in ('warning', 'temp_restriction', 'temp_ban', 'permanent_ban', 'content_removal', 'account_review')),
  reason text not null,
  expires_at timestamptz,
  actor_id text references public.profiles(id),
  source text not null check (source in ('admin', 'ai', 'system', 'room_admin')),
  report_id uuid references public.reports(id),
  created_at timestamptz not null default now()
);
create index moderation_actions_target_idx on public.moderation_actions (target_user_id, created_at desc);

-- AI system -------------------------------------------------------------------

-- Postgres-backed job queue consumed by the LangGraph worker (agents/).
create table public.ai_jobs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('moderate_message', 'moderate_report', 'fraud_review', 'fraud_sweep',
    'support_ticket', 'creator_assist', 'translate_message', 'recommendations', 'ceo_briefing')),
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  dedupe_key text unique,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_jobs_ready_idx on public.ai_jobs (status, run_after) where status = 'queued';

create table public.ai_reports (
  id bigint generated always as identity primary key,
  kind text not null,
  headline text not null,
  summary text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index ai_reports_kind_idx on public.ai_reports (kind, created_at desc);

-- AI never executes high-impact actions directly: it proposes, an owner approves,
-- and the worker executes the approved action.
create table public.ai_actions (
  id bigint generated always as identity primary key,
  agent text not null,
  action_type text not null check (action_type in ('warning', 'temp_restriction', 'temp_ban', 'permanent_ban',
    'account_review', 'freeze_wallet', 'unfreeze_wallet', 'note')),
  target_user_id text references public.profiles(id),
  rationale text not null,
  confidence numeric check (confidence between 0 and 1),
  params jsonb not null default '{}',
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'executed', 'failed')),
  reviewed_by text references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_actions_status_idx on public.ai_actions (status, created_at desc);

create table public.message_translations (
  message_id bigint not null references public.messages(id) on delete cascade,
  language text not null,
  body text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, language)
);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(id),
  subject text not null check (char_length(subject) between 3 and 120),
  body text not null check (char_length(body) between 5 and 4000),
  category text,
  status text not null default 'open' check (status in ('open', 'answered', 'escalated', 'closed')),
  ai_reply text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_recommendations (
  user_id text not null references public.profiles(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  score numeric not null,
  reason text,
  updated_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

create or replace function private.enqueue_ai_job(p_kind text, p_payload jsonb, p_dedupe text default null, p_delay interval default '0')
returns void language sql security definer set search_path = ''
as $$
  insert into public.ai_jobs (kind, payload, dedupe_key, run_after)
  values (p_kind, p_payload, p_dedupe, now() + p_delay)
  on conflict (dedupe_key) do nothing
$$;

-- Moderation core ---------------------------------------------------------------

create or replace function private.apply_moderation(
  p_user text, p_action text, p_reason text, p_hours int, p_source text, p_report uuid
)
returns public.moderation_actions language plpgsql security definer set search_path = ''
as $$
declare v_row public.moderation_actions; v_until timestamptz;
begin
  if p_action in ('temp_restriction', 'temp_ban') then
    if p_hours is null or p_hours < 1 or p_hours > 24 * 90 then raise exception 'invalid_duration'; end if;
    v_until := now() + make_interval(hours => p_hours);
  end if;
  -- Staff accounts are never actioned automatically.
  if (select role from public.profiles where id = p_user) in ('OWNER_ADMIN', 'SUPER_ADMIN') and p_source <> 'admin' then
    raise exception 'protected_account';
  end if;

  insert into public.moderation_actions (target_user_id, action, reason, expires_at, actor_id, source, report_id)
  values (p_user, p_action, p_reason, v_until, public.requesting_user_id(), p_source, p_report)
  returning * into v_row;

  if p_action = 'temp_restriction' then
    update public.profiles set status = 'restricted', status_until = v_until where id = p_user and status <> 'banned';
  elsif p_action = 'temp_ban' then
    update public.profiles set status = 'banned', status_until = v_until where id = p_user;
  elsif p_action = 'permanent_ban' then
    update public.profiles set status = 'banned', status_until = null where id = p_user;
  end if;
  if p_action in ('temp_ban', 'permanent_ban') then
    update public.rooms set status = 'offline', viewer_count = 0 where host_id = p_user and status = 'live';
  end if;
  if p_report is not null then
    update public.reports set status = 'actioned' where id = p_report;
  end if;

  perform private.audit('moderation_' || p_action, 'user', p_user,
    jsonb_build_object('reason', p_reason, 'hours', p_hours, 'source', p_source),
    case when p_source = 'ai' then 'ai' else 'user' end);
  perform private.notify(p_user, 'moderation', 'Account notice: ' || replace(p_action, '_', ' '), p_reason);
  return v_row;
end $$;

create or replace function public.apply_moderation_action(
  p_user text, p_action text, p_reason text, p_hours int default null, p_report uuid default null
)
returns public.moderation_actions language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  return private.apply_moderation(p_user, p_action, p_reason, p_hours, 'admin', p_report);
end $$;

-- Used by the AI worker for low-impact automatic actions (warnings, content removal).
create or replace function public.internal_ai_moderation(p_user text, p_action text, p_reason text, p_report uuid default null)
returns public.moderation_actions language plpgsql security definer set search_path = ''
as $$
begin
  if p_action not in ('warning', 'content_removal') then raise exception 'ai_action_requires_approval'; end if;
  return private.apply_moderation(p_user, p_action, p_reason, null, 'ai', p_report);
end $$;

create or replace function public.internal_hide_message(p_message_id bigint, p_moderation jsonb)
returns void language sql security definer set search_path = ''
as $$ update public.messages set status = 'hidden', moderation = p_moderation where id = p_message_id $$;

-- Executes an owner-approved AI proposal (called by the worker).
create or replace function public.internal_execute_ai_action(p_action_id bigint)
returns public.ai_actions language plpgsql security definer set search_path = ''
as $$
declare v public.ai_actions;
begin
  select * into v from public.ai_actions where id = p_action_id and status = 'approved' for update;
  if not found then raise exception 'not_approved'; end if;
  if v.action_type in ('warning', 'temp_restriction', 'temp_ban', 'permanent_ban', 'account_review') then
    perform private.apply_moderation(v.target_user_id, v.action_type, v.rationale,
      (v.params ->> 'hours')::int, 'ai', null);
  elsif v.action_type in ('freeze_wallet', 'unfreeze_wallet') then
    perform private.lock_wallet(v.target_user_id);
    update public.wallets set frozen = (v.action_type = 'freeze_wallet'), updated_at = now()
      where user_id = v.target_user_id;
    perform private.audit(v.action_type, 'user', v.target_user_id, jsonb_build_object('ai_action', v.id), 'ai');
  end if;
  update public.ai_actions set status = 'executed', updated_at = now() where id = v.id returning * into v;
  return v;
end $$;

create or replace function public.review_ai_action(p_action_id bigint, p_approve boolean)
returns public.ai_actions language plpgsql security definer set search_path = ''
as $$
declare v public.ai_actions;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  update public.ai_actions set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = public.requesting_user_id(), updated_at = now()
    where id = p_action_id and status = 'proposed' returning * into v;
  if not found then raise exception 'not_found'; end if;
  perform private.audit('ai_action_' || v.status, 'ai_action', v.id::text, jsonb_build_object('type', v.action_type));
  return v;
end $$;

create or replace function public.request_ceo_briefing()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  perform private.enqueue_ai_job('ceo_briefing', '{"requested": true}', 'ceo:manual:' || to_char(now(), 'YYYYMMDDHH24MI'));
end $$;

create or replace function public.dismiss_report(p_report uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  update public.reports set status = 'dismissed' where id = p_report and status in ('open', 'reviewing');
  if not found then raise exception 'not_found'; end if;
  perform private.audit('report_dismissed', 'report', p_report::text);
end $$;

-- Profiles, roles, agencies ------------------------------------------------------

-- Called on app start; creates the caller's profile + wallet if the Clerk
-- webhook hasn't yet. Role is always USER here.
create or replace function public.ensure_profile(p_display_name text default null)
returns public.profiles language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v public.profiles;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  insert into public.profiles (id, display_name) values (uid, left(p_display_name, 50))
    on conflict (id) do nothing;
  insert into public.wallets (user_id) values (uid) on conflict (user_id) do nothing;
  select * into v from public.profiles where id = uid;
  return v;
end $$;

create or replace function public.set_user_role(p_user text, p_role public.app_role)
returns public.profiles language plpgsql security definer set search_path = ''
as $$
declare v public.profiles;
begin
  if public.current_app_role() is distinct from 'SUPER_ADMIN' then raise exception 'forbidden'; end if;
  if p_user = public.requesting_user_id() then raise exception 'cannot_change_own_role'; end if;
  update public.profiles set role = p_role where id = p_user returning * into v;
  if not found then raise exception 'not_found'; end if;
  perform private.audit('role_changed', 'user', p_user, jsonb_build_object('role', p_role));
  return v;
end $$;

create or replace function public.create_agency(p_name text, p_manager text)
returns public.agencies language plpgsql security definer set search_path = ''
as $$
declare v public.agencies;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  insert into public.agencies (name, manager_id) values (p_name, p_manager) returning * into v;
  insert into public.agency_members (agency_id, user_id, member_role) values (v.id, p_manager, 'admin');
  update public.profiles set role = 'AGENCY_ADMIN' where id = p_manager and role in ('USER', 'HOST', 'AGENCY_MEMBER');
  perform private.audit('agency_created', 'agency', v.id::text, jsonb_build_object('name', p_name));
  return v;
end $$;

create or replace function public.add_agency_member(p_agency uuid, p_user text, p_member_role text)
returns public.agency_members language plpgsql security definer set search_path = ''
as $$
declare v public.agency_members;
begin
  if p_agency is null or not (public.is_platform_admin() or p_agency in (select public.admin_agency_ids())) then
    raise exception 'forbidden';
  end if;
  if p_member_role not in ('manager', 'agent') and not public.is_platform_admin() then raise exception 'forbidden'; end if;
  insert into public.agency_members (agency_id, user_id, member_role) values (p_agency, p_user, p_member_role)
    on conflict (agency_id, user_id) do update set member_role = excluded.member_role
    returning * into v;
  update public.profiles set role = 'AGENCY_MEMBER' where id = p_user and role in ('USER', 'HOST');
  perform private.audit('agency_member_added', 'agency', p_agency::text, jsonb_build_object('user', p_user, 'role', p_member_role));
  return v;
end $$;

-- Agency staff may recruit only unassigned hosts, into their own agency.
create or replace function public.assign_host_to_agency(p_host text, p_agency uuid)
returns public.hosts language plpgsql security definer set search_path = ''
as $$
declare v public.hosts;
begin
  if public.is_platform_admin() then
    update public.hosts set agency_id = p_agency where user_id = p_host returning * into v;
  elsif p_agency is not null and p_agency in (select public.member_agency_ids()) then
    update public.hosts set agency_id = p_agency where user_id = p_host and agency_id is null returning * into v;
  else
    raise exception 'forbidden';
  end if;
  if not found then raise exception 'not_found_or_already_assigned'; end if;
  perform private.audit('host_assigned', 'host', p_host, jsonb_build_object('agency', p_agency));
  return v;
end $$;

-- Hosting & rooms ----------------------------------------------------------------

create or replace function public.become_host()
returns public.hosts language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v public.hosts;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  insert into public.hosts (user_id) values (uid) on conflict (user_id) do nothing;
  insert into public.rooms (host_id) values (uid) on conflict (host_id) do nothing;
  insert into public.creator_earnings (host_id) values (uid) on conflict (host_id) do nothing;
  update public.profiles set role = 'HOST' where id = uid and role = 'USER';
  select * into v from public.hosts where user_id = uid;
  return v;
end $$;

create or replace function public.go_live(p_title text, p_category text default 'chat')
returns public.rooms language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms; v_stream uuid;
begin
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  select * into v_room from public.rooms where host_id = uid for update;
  if not found or not exists (select 1 from public.hosts where user_id = uid and status = 'active') then
    raise exception 'not_a_host';
  end if;
  if v_room.status = 'live' then return v_room; end if;
  insert into public.streams (room_id, host_id, title) values (v_room.id, uid, coalesce(nullif(trim(p_title), ''), 'Live now'))
    returning id into v_stream;
  update public.rooms set status = 'live', title = coalesce(nullif(trim(p_title), ''), 'Live now'),
    category = p_category, current_stream_id = v_stream, viewer_count = 0, updated_at = now()
    where id = v_room.id returning * into v_room;
  -- Tell followers.
  insert into public.notifications (user_id, type, title, body, data)
    select f.follower_id, 'live', coalesce(p.display_name, p.username, 'A host you follow') || ' is live',
           v_room.title, jsonb_build_object('room_id', v_room.id)
    from public.follows f join public.profiles p on p.id = uid
    where f.followee_id = uid;
  return v_room;
end $$;

create or replace function private.end_stream(p_room uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room public.rooms; v_stream public.streams;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if v_room.status <> 'live' then return; end if;
  update public.streams set ended_at = now() where id = v_room.current_stream_id and ended_at is null
    returning * into v_stream;
  update public.rooms set status = 'offline', viewer_count = 0, updated_at = now() where id = p_room;
  if v_stream.id is not null then
    update public.hosts set total_live_seconds = total_live_seconds + extract(epoch from (v_stream.ended_at - v_stream.started_at))::bigint
      where user_id = v_stream.host_id;
    update public.viewers set left_at = now() where stream_id = v_stream.id and left_at is null;
    perform private.enqueue_ai_job('creator_assist', jsonb_build_object('stream_id', v_stream.id), 'creator_assist:' || v_stream.id);
  end if;
end $$;

create or replace function public.end_live()
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room uuid;
begin
  select id into v_room from public.rooms where host_id = public.requesting_user_id();
  if v_room is null then raise exception 'not_a_host'; end if;
  perform private.end_stream(v_room);
end $$;

-- LiveKit webhook hooks (service role).
create or replace function public.internal_end_stream_by_livekit_room(p_livekit_room text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room uuid;
begin
  select id into v_room from public.rooms where livekit_room = p_livekit_room;
  if v_room is not null then perform private.end_stream(v_room); end if;
end $$;

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
    end if;
  end if;
end $$;

-- Is the caller allowed to moderate this room right now? The host always can;
-- room admins only while the host is live.
create or replace function private.can_moderate_room(p_room public.rooms, p_user text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_room.host_id = p_user
      or (p_room.status = 'live' and exists (select 1 from public.room_admins where room_id = p_room.id and user_id = p_user))
$$;

create or replace function public.room_moderate(p_room uuid, p_target text, p_action text, p_minutes int default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room;
  if not found or not private.can_moderate_room(v_room, uid) then raise exception 'forbidden'; end if;
  if p_target = v_room.host_id then raise exception 'cannot_moderate_host'; end if;
  if uid <> v_room.host_id and exists (select 1 from public.room_admins where room_id = p_room and user_id = p_target) then
    raise exception 'cannot_moderate_admin';
  end if;

  if p_action in ('mute', 'kick', 'block') then
    insert into public.room_bans (room_id, user_id, kind, expires_at, created_by)
    values (p_room, p_target, p_action,
            case when p_minutes is null then null else now() + make_interval(mins => least(p_minutes, 60 * 24 * 30)) end, uid)
    on conflict (room_id, user_id, kind) do update set expires_at = excluded.expires_at, created_by = excluded.created_by;
  elsif p_action in ('unmute', 'unblock') then
    delete from public.room_bans where room_id = p_room and user_id = p_target
      and kind = case p_action when 'unmute' then 'mute' else 'block' end;
  else
    raise exception 'invalid_action';
  end if;
  perform private.audit('room_' || p_action, 'user', p_target, jsonb_build_object('room', p_room, 'minutes', p_minutes));
end $$;

create or replace function public.set_room_admin(p_user text, p_enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room uuid;
begin
  select id into v_room from public.rooms where host_id = public.requesting_user_id();
  if v_room is null then raise exception 'not_a_host'; end if;
  if p_enabled then
    insert into public.room_admins (room_id, user_id) values (v_room, p_user) on conflict do nothing;
  else
    delete from public.room_admins where room_id = v_room and user_id = p_user;
  end if;
  perform private.audit(case when p_enabled then 'room_admin_added' else 'room_admin_removed' end, 'user', p_user,
    jsonb_build_object('room', v_room));
end $$;

-- Chat -----------------------------------------------------------------------------

create or replace function private.filter_text(p_body text)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v_body text := p_body; v_term record;
begin
  for v_term in select term, action from public.word_filters loop
    if position(v_term.term in lower(v_body)) > 0 then
      if v_term.action = 'block' then raise exception 'message_blocked'; end if;
      v_body := regexp_replace(v_body, regexp_replace(v_term.term, '([.*+?^${}()|\[\]\\])', '\\\1', 'g'),
                               repeat('*', char_length(v_term.term)), 'gi');
    end if;
  end loop;
  return v_body;
end $$;

create or replace function public.send_chat_message(p_room uuid, p_body text)
returns public.messages language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms; v_body text := trim(p_body); v_row public.messages;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if char_length(v_body) not between 1 and 300 then raise exception 'invalid_length'; end if;
  select * into v_room from public.rooms where id = p_room;
  if not found or v_room.status <> 'live' then raise exception 'room_not_live'; end if;
  if exists (select 1 from public.room_bans where room_id = p_room and user_id = uid
             and (expires_at is null or expires_at > now())) then
    raise exception 'muted_in_room';
  end if;
  -- Anti-spam: at most 5 messages per 10 seconds, and no immediate repeats.
  if (select count(*) from public.messages where sender_id = uid and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'slow_down';
  end if;
  if exists (select 1 from public.messages where sender_id = uid and room_id = p_room and body = v_body
             and created_at > now() - interval '30 seconds') then
    raise exception 'duplicate_message';
  end if;

  v_body := private.filter_text(v_body);
  insert into public.messages (room_id, stream_id, sender_id, body) values (p_room, v_room.current_stream_id, uid, v_body)
    returning * into v_row;
  if (private.setting('ai_moderation') ->> 'mode') = 'all' then
    perform private.enqueue_ai_job('moderate_message', jsonb_build_object('message_id', v_row.id), 'msg:' || v_row.id);
  end if;
  return v_row;
end $$;

create or replace function public.request_translation(p_message_id bigint, p_language text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.requesting_user_id() is null then raise exception 'not_authenticated'; end if;
  if p_language !~ '^[a-z]{2}(-[A-Z]{2})?$' then raise exception 'invalid_language'; end if;
  if exists (select 1 from public.message_translations where message_id = p_message_id and language = p_language) then return; end if;
  perform private.enqueue_ai_job('translate_message', jsonb_build_object('message_id', p_message_id, 'language', p_language),
    'tr:' || p_message_id || ':' || p_language);
end $$;

create or replace function public.send_direct_message(p_recipient text, p_body text)
returns public.direct_messages language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_body text := trim(p_body); v_row public.direct_messages;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if char_length(v_body) not between 1 and 1000 then raise exception 'invalid_length'; end if;
  if exists (select 1 from public.user_blocks where blocker_id = p_recipient and blocked_id = uid) then raise exception 'blocked'; end if;
  if (select count(*) from public.direct_messages where sender_id = uid and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'slow_down';
  end if;
  insert into public.direct_messages (sender_id, recipient_id, body) values (uid, p_recipient, private.filter_text(v_body))
    returning * into v_row;
  return v_row;
end $$;

create or replace function public.report_content(p_target_type text, p_target_id text, p_reason text)
returns public.reports language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_target_user text; v_row public.reports;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if (select count(*) from public.reports where reporter_id = uid and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'slow_down';
  end if;
  v_target_user := case p_target_type
    when 'user' then (select id from public.profiles where id = p_target_id)
    when 'room' then (select host_id from public.rooms where id::text = p_target_id)
    when 'message' then (select sender_id from public.messages where id::text = p_target_id)
  end;
  if v_target_user is null then raise exception 'not_found'; end if;
  insert into public.reports (reporter_id, target_type, target_id, target_user_id, reason)
    values (uid, p_target_type, p_target_id, v_target_user, p_reason) returning * into v_row;
  perform private.enqueue_ai_job('moderate_report', jsonb_build_object('report_id', v_row.id), 'report:' || v_row.id);
  return v_row;
end $$;

create or replace function public.create_support_ticket(p_subject text, p_body text)
returns public.support_tickets language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_row public.support_tickets;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  insert into public.support_tickets (user_id, subject, body) values (uid, p_subject, p_body) returning * into v_row;
  perform private.enqueue_ai_job('support_ticket', jsonb_build_object('ticket_id', v_row.id), 'ticket:' || v_row.id);
  return v_row;
end $$;

-- Rankings -------------------------------------------------------------------------

create or replace function public.get_rankings(p_kind text, p_period text default 'week')
returns table (rank bigint, subject_id text, label text, avatar_url text, score bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare v_since timestamptz := case p_period when 'day' then now() - interval '1 day'
  when 'month' then now() - interval '30 days' else now() - interval '7 days' end;
begin
  if p_kind = 'gifter' then
    return query select row_number() over (order by sum(g.coins_total) desc), g.sender_id,
      coalesce(p.display_name, p.username, 'Viewer'), p.avatar_url, sum(g.coins_total)::bigint
      from public.gifts g join public.profiles p on p.id = g.sender_id
      where g.created_at >= v_since group by g.sender_id, p.display_name, p.username, p.avatar_url
      order by 5 desc limit 50;
  elsif p_kind = 'creator' then
    return query select row_number() over (order by sum(g.coins_total) desc), g.host_id,
      coalesce(p.display_name, p.username, 'Host'), p.avatar_url, sum(g.coins_total)::bigint
      from public.gifts g join public.profiles p on p.id = g.host_id
      where g.created_at >= v_since group by g.host_id, p.display_name, p.username, p.avatar_url
      order by 5 desc limit 50;
  elsif p_kind = 'country' then
    return query select row_number() over (order by sum(g.coins_total) desc), coalesce(p.country, '??'),
      coalesce(p.country, 'Unknown'), null::text, sum(g.coins_total)::bigint
      from public.gifts g join public.profiles p on p.id = g.host_id
      where g.created_at >= v_since group by p.country order by 5 desc limit 50;
  elsif p_kind = 'live' then
    return query select row_number() over (order by r.viewer_count desc), r.id::text, r.title,
      p.avatar_url, r.viewer_count::bigint
      from public.rooms r join public.profiles p on p.id = r.host_id
      where r.status = 'live' order by r.viewer_count desc limit 50;
  else
    raise exception 'invalid_kind';
  end if;
end $$;

insert into public.word_filters (term, action) values ('spam-link.example', 'block'), ('idiot', 'mask');
