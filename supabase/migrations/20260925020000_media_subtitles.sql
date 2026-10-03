-- 🤖 Subtitles (AI system branch): speech-to-text captions for ready videos
-- (uploads and live replays), translated into the platform's languages and
-- exposed as HLS subtitle tracks in the master playlist.
--
-- internal_media_ready() now queues a `media_subtitles` job when the video has
-- audio and subtitles are enabled; the media worker transcribes, translates
-- (Claude) and reports back through internal_media_subtitles().

update public.platform_settings set value = jsonb_build_object(
    'subtitles_enabled', true,
    -- Tracks produced for every video: the spoken language + these (BCP-47).
    'subtitle_languages', jsonb_build_array('en', 'ur', 'hi', 'bn')
  ) || value
  where key = 'media';

alter table public.media_assets add column subtitle_status text
  check (subtitle_status in ('pending', 'done', 'no_speech', 'failed'));

create table public.media_subtitles (
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  language text not null check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  name text not null check (char_length(name) between 1 and 40),
  is_source boolean not null default false,   -- the spoken language (transcribed, not translated)
  vtt_path text not null,
  playlist_path text not null,
  created_at timestamptz not null default now(),
  primary key (asset_id, language)
);

alter table public.ai_jobs drop constraint ai_jobs_kind_check;
alter table public.ai_jobs add constraint ai_jobs_kind_check check (kind in ('moderate_message', 'moderate_report',
  'fraud_review', 'fraud_sweep', 'support_ticket', 'creator_assist', 'translate_message', 'recommendations',
  'ceo_briefing', 'media_process', 'media_subtitles'));

-- internal_media_ready: unchanged except it queues subtitles.
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
    error = null, published_at = coalesce(published_at, now()), updated_at = now(),
    subtitle_status = case when has_audio and coalesce((private.media_setting('subtitles_enabled'))::boolean, false)
                           then 'pending' end
    where id = p_asset_id returning * into v;
  if v.subtitle_status = 'pending' then
    perform private.enqueue_ai_job('media_subtitles', jsonb_build_object('asset_id', v.id), 'media_subtitles:' || v.id);
  end if;
  perform private.notify(v.owner_id, 'media_ready', 'Your video is ready', v.title, jsonb_build_object('asset_id', v.id));
  return v;
end $$;

-- Worker reports the tracks (empty array = no speech found) or a failure.
create or replace function public.internal_media_subtitles(p_asset_id uuid, p_tracks jsonb, p_failed boolean default false)
returns public.media_assets language plpgsql security definer set search_path = ''
as $$
declare v public.media_assets; t jsonb; v_sources int;
begin
  select * into v from public.media_assets where id = p_asset_id for update;
  if not found or v.status <> 'ready' then raise exception 'not_ready'; end if;
  if p_failed then
    update public.media_assets set subtitle_status = 'failed', updated_at = now() where id = p_asset_id returning * into v;
    return v;
  end if;
  if jsonb_typeof(p_tracks) <> 'array' then raise exception 'invalid_tracks'; end if;
  select count(*) into v_sources from jsonb_array_elements(p_tracks) e where (e ->> 'is_source')::boolean;
  if jsonb_array_length(p_tracks) > 0 and v_sources <> 1 then raise exception 'one_source_track_required'; end if;

  delete from public.media_subtitles where asset_id = p_asset_id;
  for t in select * from jsonb_array_elements(p_tracks) loop
    if split_part(t ->> 'vtt_path', '/', 1) <> p_asset_id::text or split_part(t ->> 'playlist_path', '/', 1) <> p_asset_id::text then
      raise exception 'invalid_path';
    end if;
    insert into public.media_subtitles (asset_id, language, name, is_source, vtt_path, playlist_path)
    values (p_asset_id, t ->> 'language', t ->> 'name', coalesce((t ->> 'is_source')::boolean, false), t ->> 'vtt_path', t ->> 'playlist_path');
  end loop;
  update public.media_assets set subtitle_status = case when jsonb_array_length(p_tracks) = 0 then 'no_speech' else 'done' end,
    updated_at = now() where id = p_asset_id returning * into v;
  return v;
end $$;

-- Access ------------------------------------------------------------------------

revoke all on public.media_subtitles from anon, authenticated;
grant select on public.media_subtitles to authenticated;
alter table public.media_subtitles enable row level security;
create policy "subtitles follow media" on public.media_subtitles for select to authenticated
  using (exists (select 1 from public.media_assets a where a.id = asset_id));

revoke execute on function public.internal_media_subtitles(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.internal_media_subtitles(uuid, jsonb, boolean) to service_role;
revoke execute on function public.internal_media_ready(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.internal_media_ready(uuid, text, text, jsonb) to service_role;
