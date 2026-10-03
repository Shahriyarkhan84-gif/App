-- Upload + HDR pipeline: who can create/submit uploads, worker-only state
-- transitions, the SDR-fallback invariant, visibility, and live recordings.
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
grant execute on all functions in schema tests to anon, authenticated, service_role;

insert into public.profiles (id, username, display_name) values
  ('md_host', 'md_host', 'Media Host'), ('md_host2', 'md_host2', 'Other Host'),
  ('md_viewer', 'md_viewer', 'Viewer'), ('md_owner', 'md_owner', 'Owner');
update public.profiles set role = 'OWNER_ADMIN' where id = 'md_owner';
insert into public.hosts (user_id) values ('md_host'), ('md_host2');
insert into public.rooms (host_id, status, cover_url) values ('md_host', 'offline', 'https://cdn.test/md.jpg'), ('md_host2', 'offline', null);

---------------------------------------------------------------------------------------
-- Only active hosts reserve uploads; the storage path is fixed by the server
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"md_viewer"}', false);
set role authenticated;
select tests.fails($$select public.create_media_upload('Mine', 'mp4')$$, '%not_a_host%', 'viewers cannot upload');
reset role;

select set_config('request.jwt.claims', '{"sub":"md_host"}', false);
set role authenticated;
select tests.fails($$select public.create_media_upload('Bad', 'exe')$$, '%invalid_format%', 'only video containers');
select tests.fails($$select public.create_media_upload('  ', 'mp4')$$, '%title_required%', 'title required');
select tests.fails($$select public.create_media_upload('Hidden', 'mp4', null, 'private')$$, '%invalid_visibility%', 'visibility checked');
select public.create_media_upload('Sunset HDR', 'MOV', 'Golden hour');
select tests.ok((select source_path from public.media_assets where title = 'Sunset HDR')
  = 'md_host/' || tests.asset('Sunset HDR') || '.mov', 'path is <owner>/<asset id>.<ext>');
select tests.ok((select status from public.media_assets where title = 'Sunset HDR') = 'awaiting_upload', 'starts awaiting upload');
-- Clients cannot write the table directly (e.g. mark their own video ready).
select tests.fails($$update public.media_assets set status = 'ready'$$, '%permission denied%', 'no direct status writes');
select tests.fails($$insert into public.media_assets (owner_id, title, source_path) values ('md_host', 'x', 'md_host/x.mp4')$$, '%permission denied%', 'no direct inserts');
select tests.fails($$select public.internal_media_ready(tests.asset('Sunset HDR'), 'x/master.m3u8', null, '[]')$$, '%permission denied%', 'clients cannot call worker RPCs');
reset role;

-- Someone else cannot submit or edit it.
select set_config('request.jwt.claims', '{"sub":"md_host2"}', false);
set role authenticated;
select tests.fails($$select public.submit_media_upload(tests.asset('Sunset HDR'))$$, '%not_found%', 'other host cannot submit');
select tests.fails($$select public.update_media(tests.asset('Sunset HDR'), 'Stolen', null, 'public')$$, '%not_found%', 'other host cannot edit');
select tests.fails($$select public.remove_media(tests.asset('Sunset HDR'))$$, '%not_found%', 'other host cannot remove');
select tests.ok(not exists (select 1 from public.media_assets where title = 'Sunset HDR'), 'unprocessed media hidden from others');
reset role;

-- Pending uploads are capped per host.
update public.platform_settings set value = value || '{"max_pending_uploads": 2}' where key = 'media';
select set_config('request.jwt.claims', '{"sub":"md_host"}', false);
set role authenticated;
select public.create_media_upload('Second', 'mp4');
select tests.fails($$select public.create_media_upload('Third', 'mp4')$$, '%too_many_pending%', 'pending cap');
reset role;
update public.platform_settings set value = value || '{"max_pending_uploads": 5}' where key = 'media';

---------------------------------------------------------------------------------------
-- Submit queues exactly one processing job
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"md_host"}', false);
set role authenticated;
select public.submit_media_upload(tests.asset('Sunset HDR'));
select tests.fails($$select public.submit_media_upload(tests.asset('Sunset HDR'))$$, '%already_submitted%', 'cannot resubmit');
reset role;
select tests.ok((select count(*) from public.ai_jobs where kind = 'media_process' and payload ->> 'asset_id' = tests.asset('Sunset HDR')::text) = 1, 'one media job queued');

---------------------------------------------------------------------------------------
-- Worker transitions (service role): probe → HDR metadata → ready with SDR fallback
---------------------------------------------------------------------------------------
set role service_role;
select public.internal_media_started(tests.asset('Sunset HDR'));
select tests.fails($$select public.internal_media_probed(tests.asset('Sunset HDR'), '{"dynamic_range": "dolby"}')$$, '%invalid_dynamic_range%', 'dynamic range validated');
select public.internal_media_probed(tests.asset('Sunset HDR'), '{"duration_ms": 12000, "width": 3840, "height": 2160, "fps": 29.97,
  "video_codec": "hevc", "bit_depth": 10, "color_primaries": "bt2020", "color_transfer": "smpte2084", "color_space": "bt2020nc",
  "dynamic_range": "hdr10", "hdr_metadata": {"max_cll": "1000,400"}, "has_audio": true}');
-- A ladder without an SDR rung would leave SDR screens unable to play.
select tests.fails($$select public.internal_media_ready(tests.asset('Sunset HDR'), tests.asset('Sunset HDR') || '/master.m3u8', null,
  '[{"label": "2160p_hdr", "width": 3840, "height": 2160, "bitrate_kbps": 16000, "codecs": "hvc1.2.4.L153.B0", "dynamic_range": "hdr10", "playlist_path": "x"}]')$$,
  '%sdr_fallback_required%', 'SDR fallback is mandatory');
select tests.fails($$select public.internal_media_ready(tests.asset('Sunset HDR'), 'someone-else/master.m3u8', null,
  '[{"label": "720p", "width": 1280, "height": 720, "bitrate_kbps": 2800, "codecs": "avc1.64001f", "dynamic_range": "sdr", "playlist_path": "x"}]')$$,
  '%invalid_path%', 'playback path must be under the asset folder');
select public.internal_media_ready(tests.asset('Sunset HDR'), tests.asset('Sunset HDR') || '/master.m3u8', tests.asset('Sunset HDR') || '/thumb.jpg',
  ('[{"label": "2160p_hdr", "width": 3840, "height": 2160, "bitrate_kbps": 16000, "codecs": "hvc1.2.4.L153.B0", "dynamic_range": "hdr10", "playlist_path": "a"},
     {"label": "1080p_hdr", "width": 1920, "height": 1080, "bitrate_kbps": 6500, "codecs": "hvc1.2.4.L123.B0", "dynamic_range": "hdr10", "playlist_path": "b"},
     {"label": "1080p", "width": 1920, "height": 1080, "bitrate_kbps": 5000, "codecs": "avc1.640028", "dynamic_range": "sdr", "playlist_path": "c"},
     {"label": "720p", "width": 1280, "height": 720, "bitrate_kbps": 2800, "codecs": "avc1.64001f", "dynamic_range": "sdr", "playlist_path": "d"}]')::jsonb);
reset role;
select tests.ok((select status from public.media_assets where title = 'Sunset HDR') = 'ready', 'asset ready');
select tests.ok((select count(*) from public.media_renditions where asset_id = tests.asset('Sunset HDR')) = 4, 'ladder recorded');
select tests.ok(exists (select 1 from public.notifications where user_id = 'md_host' and type = 'media_ready'), 'owner notified');

---------------------------------------------------------------------------------------
-- Visibility: public ready media is listed; unlisted only resolves by id
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"md_viewer"}', false);
set role authenticated;
select tests.ok(exists (select 1 from public.media_assets where title = 'Sunset HDR'), 'public ready media listed');
select tests.ok((select count(*) from public.media_renditions where asset_id = tests.asset('Sunset HDR')) = 4, 'renditions readable');
select tests.ok(not exists (select 1 from public.media_assets where title = 'Second'), 'pending media of others hidden');
select tests.ok(public.record_media_view(tests.asset('Sunset HDR')) = 1, 'first view counted');
select tests.ok(public.record_media_view(tests.asset('Sunset HDR')) = 1, 'repeat view not double counted');
reset role;

select set_config('request.jwt.claims', '{"sub":"md_host"}', false);
set role authenticated;
select public.update_media(tests.asset('Sunset HDR'), 'Sunset HDR', 'Golden hour', 'unlisted');
reset role;
select set_config('request.jwt.claims', '{"sub":"md_viewer"}', false);
set role authenticated;
select tests.ok(not exists (select 1 from public.media_assets where title = 'Sunset HDR'), 'unlisted not listed');
select tests.ok((public.get_media(tests.asset('Sunset HDR'))).id is not null, 'unlisted resolves by id');
select tests.ok((public.get_media(tests.asset('Second'))).id is null, 'get_media hides unprocessed media of others');
select tests.fails($$select public.remove_media(tests.asset('Sunset HDR'))$$, '%not_found%', 'viewer cannot remove');
reset role;

-- Platform admins can take media down; it is audited and the owner is told.
select set_config('request.jwt.claims', '{"sub":"md_owner"}', false);
set role authenticated;
select public.remove_media(tests.asset('Sunset HDR'), 'Copyrighted music');
reset role;
select tests.ok((select status from public.media_assets where title = 'Sunset HDR') = 'removed', 'admin removed media');
select tests.ok(exists (select 1 from public.audit_logs where action = 'media_removed' and actor_id = 'md_owner'), 'removal audited');
select tests.ok(exists (select 1 from public.notifications where user_id = 'md_host' and type = 'media_removed'), 'owner told');
select set_config('request.jwt.claims', '{"sub":"md_viewer"}', false);
set role authenticated;
select tests.ok((public.get_media(tests.asset('Sunset HDR'))).id is null, 'removed media no longer resolves');
reset role;

-- Failure path.
set role service_role;
select tests.fails($$select public.internal_media_started(tests.asset('Second'))$$, '%not_processable%', 'cannot process an unsubmitted upload');
reset role;

---------------------------------------------------------------------------------------
-- Live recordings enter the same pipeline, once per egress
---------------------------------------------------------------------------------------
insert into public.streams (room_id, host_id, title, ended_at)
  values ((select id from public.rooms where host_id = 'md_host'), 'md_host', 'Friday night chat', now());
set role service_role;
select tests.fails($$select public.internal_register_live_recording((select livekit_room from public.rooms where host_id = 'md_host'), 'EG_1', 'md_host2/rec.mp4')$$,
  '%invalid_path%', 'recording path must be in the host folder');
select public.internal_register_live_recording((select livekit_room from public.rooms where host_id = 'md_host'), 'EG_1', 'md_host/rec-1.mp4');
select public.internal_register_live_recording((select livekit_room from public.rooms where host_id = 'md_host'), 'EG_1', 'md_host/rec-1.mp4');
reset role;
select tests.ok((select count(*) from public.media_assets where egress_id = 'EG_1') = 1, 'egress registered once');
select tests.ok((select title from public.media_assets where egress_id = 'EG_1') = 'Replay: Friday night chat', 'replay titled from stream');
select tests.ok((select status from public.media_assets where egress_id = 'EG_1') = 'queued', 'recording queued');
select tests.ok(exists (select 1 from public.ai_jobs where kind = 'media_process' and payload ->> 'asset_id' = (select id::text from public.media_assets where egress_id = 'EG_1')), 'recording job queued');

set role service_role;
select public.internal_media_started((select id from public.media_assets where egress_id = 'EG_1'));
select public.internal_media_failed((select id from public.media_assets where egress_id = 'EG_1'), 'ffmpeg exited 1');
reset role;
select tests.ok((select status from public.media_assets where egress_id = 'EG_1') = 'failed', 'failure recorded');
select tests.ok(exists (select 1 from public.notifications where user_id = 'md_host' and type = 'media_failed'), 'owner told about failure');

---------------------------------------------------------------------------------------
-- Anonymous callers get nothing
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{}', false);
set role anon;
select tests.fails($$select * from public.media_assets$$, '%permission denied%', 'anon cannot read media');
select tests.fails($$select public.create_media_upload('x', 'mp4')$$, '%permission denied%', 'anon cannot upload');
reset role;

drop schema tests cascade;
