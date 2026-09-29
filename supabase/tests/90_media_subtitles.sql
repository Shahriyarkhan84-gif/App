-- Subtitles: queued only for ready videos with audio, worker-only writes,
-- exactly one source-language track, paths confined to the asset folder.
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;
create function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'TEST FAILED: %', p_msg; end if;
end $$;
create function tests.fails(p_sql text, p_like text, p_msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED (no error): %', p_msg;
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  if sqlerrm not like p_like then raise exception 'TEST FAILED (wrong error "%"): %', sqlerrm, p_msg; end if;
end $$;
create function tests.asset(p_title text) returns uuid language sql security definer
as $$ select id from public.media_assets where title = p_title $$;
-- Takes an asset from reserved → ready with the given audio flag (as the worker would).
create function tests.make_ready(p_title text, p_audio boolean) returns void language plpgsql security definer as $$
declare v_id uuid := tests.asset(p_title);
begin
  update public.media_assets set status = 'queued' where id = v_id;
  perform public.internal_media_started(v_id);
  perform public.internal_media_probed(v_id, jsonb_build_object('width', 1920, 'height', 1080, 'dynamic_range', 'sdr', 'has_audio', p_audio));
  perform public.internal_media_ready(v_id, v_id || '/master.m3u8', null,
    '[{"label": "1080p", "width": 1920, "height": 1080, "bitrate_kbps": 5000, "codecs": "avc1.640028", "dynamic_range": "sdr", "playlist_path": "x"}]');
end $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

insert into public.profiles (id, username, display_name) values ('st_host', 'st_host', 'Sub Host'), ('st_viewer', 'st_viewer', 'Viewer');
insert into public.hosts (user_id) values ('st_host');

select set_config('request.jwt.claims', '{"sub":"st_host"}', false);
set role authenticated;
select public.create_media_upload('Talk show', 'mp4');
select public.create_media_upload('Silent timelapse', 'mp4');
reset role;

select tests.make_ready('Talk show', true);
select tests.make_ready('Silent timelapse', false);
select tests.ok((select subtitle_status from public.media_assets where title = 'Talk show') = 'pending', 'video with audio awaits subtitles');
select tests.ok((select subtitle_status from public.media_assets where title = 'Silent timelapse') is null, 'no audio, no subtitles');
select tests.ok((select count(*) from public.ai_jobs where kind = 'media_subtitles' and payload ->> 'asset_id' = tests.asset('Talk show')::text) = 1, 'one subtitles job for the video with audio');
select tests.ok(not exists (select 1 from public.ai_jobs where kind = 'media_subtitles' and payload ->> 'asset_id' = tests.asset('Silent timelapse')::text), 'none for the silent video');

-- Switched off → nothing queued.
update public.platform_settings set value = value || '{"subtitles_enabled": false}' where key = 'media';
select set_config('request.jwt.claims', '{"sub":"st_host"}', false);
set role authenticated;
select public.create_media_upload('Off air', 'mp4');
reset role;
select tests.make_ready('Off air', true);
select tests.ok((select subtitle_status from public.media_assets where title = 'Off air') is null, 'disabled setting skips subtitles');
update public.platform_settings set value = value || '{"subtitles_enabled": true}' where key = 'media';

-- Clients cannot write subtitles.
select set_config('request.jwt.claims', '{"sub":"st_host"}', false);
set role authenticated;
select tests.fails($$select public.internal_media_subtitles(tests.asset('Talk show'), '[]')$$, '%permission denied%', 'owner cannot write subtitles');
select tests.fails($$insert into public.media_subtitles (asset_id, language, name, vtt_path, playlist_path) values (tests.asset('Talk show'), 'en', 'English', 'x', 'y')$$,
  '%permission denied%', 'no direct inserts');
reset role;

set role service_role;
select tests.fails($$select public.internal_media_subtitles(tests.asset('Talk show'),
  jsonb_build_array(jsonb_build_object('language', 'en', 'name', 'English', 'is_source', false, 'vtt_path', tests.asset('Talk show') || '/subs/en.vtt', 'playlist_path', tests.asset('Talk show') || '/subs/en.m3u8')))$$,
  '%one_source_track_required%', 'exactly one source track');
select tests.fails($$select public.internal_media_subtitles(tests.asset('Talk show'),
  jsonb_build_array(jsonb_build_object('language', 'ur', 'name', 'اردو', 'is_source', true, 'vtt_path', 'elsewhere/subs/ur.vtt', 'playlist_path', tests.asset('Talk show') || '/subs/ur.m3u8')))$$,
  '%invalid_path%', 'paths must stay in the asset folder');
select public.internal_media_subtitles(tests.asset('Talk show'), jsonb_build_array(
  jsonb_build_object('language', 'ur', 'name', 'اردو', 'is_source', true, 'vtt_path', tests.asset('Talk show') || '/subs/ur.vtt', 'playlist_path', tests.asset('Talk show') || '/subs/ur.m3u8'),
  jsonb_build_object('language', 'en', 'name', 'English', 'is_source', false, 'vtt_path', tests.asset('Talk show') || '/subs/en.vtt', 'playlist_path', tests.asset('Talk show') || '/subs/en.m3u8')));
reset role;
select tests.ok((select subtitle_status from public.media_assets where title = 'Talk show') = 'done', 'subtitles done');
select tests.ok((select count(*) from public.media_subtitles where asset_id = tests.asset('Talk show')) = 2, 'tracks stored');

select set_config('request.jwt.claims', '{"sub":"st_viewer"}', false);
set role authenticated;
select tests.ok((select count(*) from public.media_subtitles where asset_id = tests.asset('Talk show')) = 2, 'viewers read tracks of public videos');
reset role;

-- No speech / failure outcomes.
set role service_role;
select public.internal_media_subtitles(tests.asset('Silent timelapse'), '[]');
select public.internal_media_subtitles(tests.asset('Off air'), null, true);
reset role;
select tests.ok((select subtitle_status from public.media_assets where title = 'Silent timelapse') = 'no_speech', 'no speech recorded');
select tests.ok((select subtitle_status from public.media_assets where title = 'Off air') = 'failed', 'failure recorded');

drop schema tests cascade;
