-- Upload + HDR pipeline (core architecture: Upload pipeline / Live pipeline →
-- HDR detection → HDR10/HLG → 1080p HDR · 4K HDR · SDR fallback → adaptive bitrate).
--
-- Hosts upload a source video to the private `uploads` bucket under their own
-- folder, then submit it. The media worker (agents/, WORKER_QUEUES=media) probes
-- it, detects the dynamic range (PQ → HDR10, ARIB STD-B67 → HLG, else SDR),
-- plans a rendition ladder and encodes fMP4 HLS into the public `media` bucket,
-- with a master playlist whose VIDEO-RANGE tags let each player pick HDR or the
-- SDR fallback and adapt bitrate. Live streams enter the same pipeline as
-- recordings (LiveKit participant egress → livekit-webhook `egress_ended`).
--
-- Clients never write these tables: creation/submission are RPCs that fix the
-- storage path, and only the service role (worker) can mark media processed.

insert into public.platform_settings (key, value) values ('media', '{}') on conflict (key) do nothing;
update public.platform_settings set value = jsonb_build_object(
    -- Public base URL of the `media` bucket, e.g. https://<project>.supabase.co/storage/v1/object/public/media
    'media_base', null,
    'uploads_enabled', true,
    'hdr_enabled', true,
    'uhd_enabled', true,           -- 4K HDR rung (heavy to encode; switch off to save cost)
    'record_live', false,          -- record live streams via LiveKit egress into the pipeline
    'max_upload_mb', 2048,
    'max_duration_s', 3600,
    'max_pending_uploads', 5
  ) || value
  where key = 'media';

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references public.hosts(user_id) on delete cascade,
  source_kind text not null default 'upload' check (source_kind in ('upload', 'live_recording')),
  stream_id uuid references public.streams(id) on delete set null,
  egress_id text unique,
  title text not null check (char_length(title) between 1 and 100),
  description text check (char_length(description) <= 500),
  visibility text not null default 'public' check (visibility in ('public', 'unlisted')),
  -- Object name inside the `uploads` bucket: <owner id>/<asset id>.<ext>
  source_path text unique not null,
  status text not null default 'awaiting_upload'
    check (status in ('awaiting_upload', 'queued', 'processing', 'ready', 'failed', 'removed')),
  -- Probe results (written by the worker).
  duration_ms bigint check (duration_ms >= 0),
  width int check (width > 0),
  height int check (height > 0),
  fps numeric(6, 3),
  video_codec text,
  bit_depth int,
  color_primaries text,
  color_transfer text,
  color_space text,
  dynamic_range text check (dynamic_range in ('sdr', 'hdr10', 'hlg')),
  hdr_metadata jsonb,
  has_audio boolean,
  -- Outputs inside the `media` bucket: <asset id>/master.m3u8, <asset id>/thumb.jpg
  playback_path text,
  thumbnail_path text,
  error text,
  view_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
create index media_assets_owner_idx on public.media_assets (owner_id, created_at desc);
create index media_assets_feed_idx on public.media_assets (published_at desc) where status = 'ready' and visibility = 'public';

create table public.media_renditions (
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  label text not null check (label ~ '^[0-9]{3,4}p(_hdr)?$'),
  width int not null check (width > 0),
  height int not null check (height > 0),
  bitrate_kbps int not null check (bitrate_kbps > 0),
  codecs text not null,
  dynamic_range text not null check (dynamic_range in ('sdr', 'hdr10', 'hlg')),
  playlist_path text not null,
  primary key (asset_id, label)
);

create table public.media_views (
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (asset_id, user_id)
);

alter table public.ai_jobs drop constraint ai_jobs_kind_check;
alter table public.ai_jobs add constraint ai_jobs_kind_check check (kind in ('moderate_message', 'moderate_report',
  'fraud_review', 'fraud_sweep', 'support_ticket', 'creator_assist', 'translate_message', 'recommendations',
  'ceo_briefing', 'media_process'));

-- Storage (skipped where the storage schema doesn't exist, e.g. the local test database).
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  -- Sources: private. Hosts write only <their id>/<file>; nobody but the service role reads.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('uploads', 'uploads', false, 2147483648,
          array['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm', 'video/x-matroska'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
  -- Outputs: public CDN reads under unguessable <asset uuid>/ paths; only the service role writes.
  insert into storage.buckets (id, name, public) values ('media', 'media', true)
  on conflict (id) do update set public = true;

  execute $p$drop policy if exists "hosts upload own sources" on storage.objects$p$;
  execute $p$create policy "hosts upload own sources" on storage.objects for insert to authenticated
    with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = public.requesting_user_id()
                and exists (select 1 from public.media_assets a
                            where a.source_path = name and a.owner_id = public.requesting_user_id()
                              and a.status = 'awaiting_upload'))$p$;
end $$;

-- Helpers ---------------------------------------------------------------------

create or replace function private.media_setting(p_key text)
returns jsonb language sql stable security definer set search_path = ''
as $$ select private.setting('media') -> p_key $$;

-- RPCs (clients) ------------------------------------------------------------------

-- Reserves an asset and returns it; the client then uploads the file to
-- uploads/<source_path> and calls submit_media_upload(). The path is fixed here.
create or replace function public.create_media_upload(
  p_title text, p_extension text, p_description text default null, p_visibility text default 'public'
)
returns public.media_assets language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v_id uuid := gen_random_uuid();
  v_ext text := lower(coalesce(p_extension, ''));
  v public.media_assets;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if not exists (select 1 from public.hosts where user_id = uid and status = 'active') then raise exception 'not_a_host'; end if;
  if coalesce((private.media_setting('uploads_enabled'))::boolean, false) is not true then raise exception 'uploads_disabled'; end if;
  if v_ext not in ('mp4', 'mov', 'm4v', 'webm', 'mkv') then raise exception 'invalid_format'; end if;
  if nullif(trim(p_title), '') is null then raise exception 'title_required'; end if;
  if p_visibility not in ('public', 'unlisted') then raise exception 'invalid_visibility'; end if;
  if (select count(*) from public.media_assets where owner_id = uid and status in ('awaiting_upload', 'queued', 'processing'))
     >= coalesce((private.media_setting('max_pending_uploads'))::int, 5) then
    raise exception 'too_many_pending';
  end if;

  insert into public.media_assets (id, owner_id, title, description, visibility, source_path)
  values (v_id, uid, left(trim(p_title), 100), left(nullif(trim(p_description), ''), 500), p_visibility,
          uid || '/' || v_id || '.' || v_ext)
  returning * into v;
  return v;
end $$;

-- The upload finished: check the object is really there, then queue processing.
create or replace function public.submit_media_upload(p_asset_id uuid)
returns public.media_assets language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v public.media_assets;
  v_exists boolean := true;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into v from public.media_assets where id = p_asset_id for update;
  if not found or v.owner_id <> uid then raise exception 'not_found'; end if;
  if v.status <> 'awaiting_upload' then raise exception 'already_submitted'; end if;
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)' into v_exists using 'uploads', v.source_path;
  end if;
  if not v_exists then raise exception 'upload_missing'; end if;

  update public.media_assets set status = 'queued', updated_at = now() where id = p_asset_id returning * into v;
  perform private.enqueue_ai_job('media_process', jsonb_build_object('asset_id', v.id), 'media_process:' || v.id);
  return v;
end $$;

create or replace function public.update_media(p_asset_id uuid, p_title text, p_description text, p_visibility text)
returns public.media_assets language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v public.media_assets;
begin
  if p_visibility not in ('public', 'unlisted') then raise exception 'invalid_visibility'; end if;
  if nullif(trim(p_title), '') is null then raise exception 'title_required'; end if;
  update public.media_assets set title = left(trim(p_title), 100), description = left(nullif(trim(p_description), ''), 500),
    visibility = p_visibility, updated_at = now()
    where id = p_asset_id and owner_id = uid and status <> 'removed' returning * into v;
  if not found then raise exception 'not_found'; end if;
  return v;
end $$;

-- The owner deletes their video, or a platform admin takes it down (audited).
create or replace function public.remove_media(p_asset_id uuid, p_reason text default null)
returns public.media_assets language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v public.media_assets;
begin
  select * into v from public.media_assets where id = p_asset_id for update;
  if not found or (v.owner_id <> uid and not public.is_platform_admin()) then raise exception 'not_found'; end if;
  update public.media_assets set status = 'removed', updated_at = now() where id = p_asset_id returning * into v;
  if v.owner_id <> uid then
    perform private.audit('media_removed', 'media', v.id::text, jsonb_build_object('reason', p_reason));
    perform private.notify(v.owner_id, 'media_removed', 'Video removed', coalesce(p_reason, 'It broke the community rules.'),
      jsonb_build_object('asset_id', v.id));
  end if;
  return v;
end $$;

-- Ready media by id — also resolves unlisted videos for people who have the link.
create or replace function public.get_media(p_asset_id uuid)
returns public.media_assets language sql stable security definer set search_path = ''
as $$
  select a.* from public.media_assets a
  where a.id = p_asset_id
    and (a.owner_id = public.requesting_user_id() or public.is_platform_admin()
         or (a.status = 'ready' and public.user_status(a.owner_id) <> 'banned'))
$$;

-- One view per signed-in user.
create or replace function public.record_media_view(p_asset_id uuid)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_count bigint;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.media_assets where id = p_asset_id and status = 'ready') then raise exception 'not_found'; end if;
  insert into public.media_views (asset_id, user_id) values (p_asset_id, uid) on conflict do nothing;
  if found then
    update public.media_assets set view_count = view_count + 1 where id = p_asset_id;
  end if;
  select view_count into v_count from public.media_assets where id = p_asset_id;
  return v_count;
end $$;

-- Worker / webhook (service role) ------------------------------------------------------

create or replace function public.internal_media_started(p_asset_id uuid)
returns public.media_assets language plpgsql security definer set search_path = ''
as $$
declare v public.media_assets;
begin
  update public.media_assets set status = 'processing', error = null, updated_at = now()
    where id = p_asset_id and status in ('queued', 'processing', 'failed') returning * into v;
  if not found then raise exception 'not_processable'; end if;
  return v;
end $$;

-- Probe + HDR detection results. p_probe keys match the columns.
create or replace function public.internal_media_probed(p_asset_id uuid, p_probe jsonb)
returns public.media_assets language plpgsql security definer set search_path = ''
as $$
declare v public.media_assets;
begin
  if (p_probe ->> 'dynamic_range') not in ('sdr', 'hdr10', 'hlg') then raise exception 'invalid_dynamic_range'; end if;
  update public.media_assets set
    duration_ms = (p_probe ->> 'duration_ms')::bigint,
    width = (p_probe ->> 'width')::int,
    height = (p_probe ->> 'height')::int,
    fps = (p_probe ->> 'fps')::numeric,
    video_codec = p_probe ->> 'video_codec',
    bit_depth = (p_probe ->> 'bit_depth')::int,
    color_primaries = p_probe ->> 'color_primaries',
    color_transfer = p_probe ->> 'color_transfer',
    color_space = p_probe ->> 'color_space',
    dynamic_range = p_probe ->> 'dynamic_range',
    hdr_metadata = p_probe -> 'hdr_metadata',
    has_audio = coalesce((p_probe ->> 'has_audio')::boolean, false),
    updated_at = now()
  where id = p_asset_id and status = 'processing' returning * into v;
  if not found then raise exception 'not_processing'; end if;
  return v;
end $$;

-- Encoding finished: record the ladder and publish.
create or replace function public.internal_media_ready(
  p_asset_id uuid, p_playback_path text, p_thumbnail_path text, p_renditions jsonb
)
returns public.media_assets language plpgsql security definer set search_path = ''
as $$
declare v public.media_assets; r jsonb;
begin
  select * into v from public.media_assets where id = p_asset_id for update;
  if not found or v.status <> 'processing' then raise exception 'not_processing'; end if;
  if jsonb_typeof(p_renditions) <> 'array' or jsonb_array_length(p_renditions) = 0 then raise exception 'no_renditions'; end if;
  -- Every ladder must keep an SDR fallback so non-HDR screens can always play.
  if not exists (select 1 from jsonb_array_elements(p_renditions) e where e ->> 'dynamic_range' = 'sdr') then
    raise exception 'sdr_fallback_required';
  end if;
  if split_part(p_playback_path, '/', 1) <> p_asset_id::text then raise exception 'invalid_path'; end if;

  delete from public.media_renditions where asset_id = p_asset_id;
  for r in select * from jsonb_array_elements(p_renditions) loop
    insert into public.media_renditions (asset_id, label, width, height, bitrate_kbps, codecs, dynamic_range, playlist_path)
    values (p_asset_id, r ->> 'label', (r ->> 'width')::int, (r ->> 'height')::int, (r ->> 'bitrate_kbps')::int,
            r ->> 'codecs', r ->> 'dynamic_range', r ->> 'playlist_path');
  end loop;

  update public.media_assets set status = 'ready', playback_path = p_playback_path, thumbnail_path = p_thumbnail_path,
    error = null, published_at = coalesce(published_at, now()), updated_at = now()
    where id = p_asset_id returning * into v;
  perform private.notify(v.owner_id, 'media_ready', 'Your video is ready', v.title, jsonb_build_object('asset_id', v.id));
  return v;
end $$;

create or replace function public.internal_media_failed(p_asset_id uuid, p_error text)
returns public.media_assets language plpgsql security definer set search_path = ''
as $$
declare v public.media_assets;
begin
  update public.media_assets set status = 'failed', error = left(p_error, 500), updated_at = now()
    where id = p_asset_id and status in ('queued', 'processing') returning * into v;
  if found then
    perform private.notify(v.owner_id, 'media_failed', 'Video processing failed', v.title, jsonb_build_object('asset_id', v.id));
  end if;
  return v;
end $$;

-- LiveKit egress finished recording a host: file it as a replay and queue it.
-- p_path is the object name inside the `uploads` bucket (egress writes there
-- through the storage S3 endpoint). Idempotent on the egress id.
create or replace function public.internal_register_live_recording(p_livekit_room text, p_egress_id text, p_path text)
returns public.media_assets language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.rooms;
  v_stream public.streams;
  v public.media_assets;
begin
  select * into v from public.media_assets where egress_id = p_egress_id;
  if found then return v; end if;
  select * into v_room from public.rooms where livekit_room = p_livekit_room;
  if not found then raise exception 'room_not_found'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> v_room.host_id then raise exception 'invalid_path'; end if;
  select * into v_stream from public.streams where room_id = v_room.id order by started_at desc limit 1;

  insert into public.media_assets (owner_id, source_kind, stream_id, egress_id, title, source_path, status)
  values (v_room.host_id, 'live_recording', v_stream.id, p_egress_id,
          left('Replay: ' || coalesce(v_stream.title, v_room.title), 100), p_path, 'queued')
  returning * into v;
  perform private.enqueue_ai_job('media_process', jsonb_build_object('asset_id', v.id), 'media_process:' || v.id);
  return v;
end $$;

-- Access ------------------------------------------------------------------------

revoke all on public.media_assets, public.media_renditions, public.media_views from anon, authenticated;
grant select on public.media_assets, public.media_renditions to authenticated;
alter table public.media_assets enable row level security;
alter table public.media_renditions enable row level security;
alter table public.media_views enable row level security;

create policy "media visible" on public.media_assets for select to authenticated
  using (owner_id = public.requesting_user_id() or public.is_platform_admin()
         or (status = 'ready' and visibility = 'public' and public.user_status(owner_id) <> 'banned'));
create policy "renditions follow media" on public.media_renditions for select to authenticated
  using (exists (select 1 from public.media_assets a where a.id = asset_id));

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_media_upload(text, text, text, text)', 'public.submit_media_upload(uuid)',
    'public.update_media(uuid, text, text, text)', 'public.remove_media(uuid, text)',
    'public.get_media(uuid)', 'public.record_media_view(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.internal_media_started(uuid)', 'public.internal_media_probed(uuid, jsonb)',
    'public.internal_media_ready(uuid, text, text, jsonb)', 'public.internal_media_failed(uuid, text)',
    'public.internal_register_live_recording(text, text, text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.media_assets;
  end if;
end $$;
