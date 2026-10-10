-- Indexes for foreign keys the app actually looks up by (Supabase performance advisor
-- "unindexed_foreign_keys", filtered to real query paths). Without them these lookups, RLS checks
-- and ON DELETE cascades scan the whole table. Left out on purpose: tiny catalog tables
-- (gift_catalog, coin_packages, frame_catalog, regions, events) and admin-only "reviewed_by" /
-- "created_by" columns, where an index only slows writes down, and gifts.room_id: nothing reads
-- gifts by room (screens read by host or stream, both indexed) and gifts is the busiest write table.
-- Safe to run more than once.

-- "Where is this person?" lookups and account-deletion cleanup across party/live tables.
create index if not exists room_bans_user_idx on public.room_bans (user_id);
create index if not exists room_seats_user_idx on public.room_seats (user_id);
create index if not exists seat_requests_user_idx on public.seat_requests (user_id);
create index if not exists room_admins_user_idx on public.room_admins (user_id);
create index if not exists viewers_user_idx on public.viewers (user_id);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

-- Agency membership is checked inside RLS (member_agency_ids / admin_agency_ids) on many reads.
create index if not exists agency_members_user_idx on public.agency_members (user_id);
-- Agency portal: applications per agency.
create index if not exists host_applications_agency_idx on public.host_applications (agency_id, created_at desc);

-- Streams per room, and chat per stream (the AI coach reads each finished stream's chat).
create index if not exists streams_room_idx on public.streams (room_id, started_at desc);
create index if not exists messages_stream_idx on public.messages (stream_id);
-- Only live rooms point at a stream or battle, so partial indexes stay tiny.
create index if not exists rooms_current_stream_idx on public.rooms (current_stream_id) where current_stream_id is not null;
create index if not exists rooms_current_battle_idx on public.rooms (current_battle_id) where current_battle_id is not null;
create index if not exists user_recommendations_room_idx on public.user_recommendations (room_id);

-- "My ..." lists (own-row RLS policies filter by the signed-in user).
create index if not exists event_scores_user_idx on public.event_scores (user_id);
create index if not exists event_results_user_idx on public.event_results (user_id);
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);
create index if not exists support_tickets_user_idx on public.support_tickets (user_id, created_at desc);
create index if not exists refund_requests_user_idx on public.refund_requests (user_id);
create index if not exists media_views_user_idx on public.media_views (user_id);

-- Owner command center: actions on a report, AI proposals about a person.
create index if not exists moderation_actions_report_idx on public.moderation_actions (report_id) where report_id is not null;
create index if not exists ai_actions_target_user_idx on public.ai_actions (target_user_id) where target_user_id is not null;
