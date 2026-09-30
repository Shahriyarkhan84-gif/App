-- The live project was first created with an MVP script (migration
-- 20260910204533_zynalive_mvp_schema, not in this repo) that left three
-- placeholder tables in `public` with RLS disabled — `users` (with
-- password_hash), `rooms` and `chat_messages` — holding only demo seed rows.
-- Nothing in the app uses them, and `public.rooms` would collide with the
-- real schema in 20260924010000_core.sql. Remove them before the repo schema.
-- No-op on databases built from this repo.

drop table if exists public.chat_messages cascade;
drop table if exists public.rooms cascade;
drop table if exists public.users cascade;
drop type if exists public.room_status;
drop type if exists public.role;
