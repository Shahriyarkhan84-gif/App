-- Zynalive core: identity, RBAC, agencies, hosts, rooms, social graph.
-- Auth is Clerk via Supabase third-party auth; the Clerk user id is JWT `sub`.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;

create type public.app_role as enum ('USER', 'HOST', 'AGENCY_MEMBER', 'AGENCY_ADMIN', 'OWNER_ADMIN', 'SUPER_ADMIN');
create type public.account_status as enum ('active', 'restricted', 'banned');

create or replace function public.requesting_user_id()
returns text language sql stable
as $$ select nullif(auth.jwt() ->> 'sub', '')::text $$;

-- Profiles -------------------------------------------------------------------
create table public.profiles (
  id text primary key,
  username text unique check (username ~ '^[a-z0-9_.]{3,24}$'),
  display_name text check (char_length(display_name) <= 50),
  avatar_url text,
  bio text check (char_length(bio) <= 280),
  country text check (country ~ '^[A-Z]{2}$'),
  language text not null default 'en' check (char_length(language) between 2 and 8),
  email text,
  -- role/status are never client-writable (column grants + RPCs only).
  role public.app_role not null default 'USER',
  status public.account_status not null default 'active',
  status_until timestamptz,
  created_at timestamptz not null default now()
);

-- Role helpers (security definer so RLS policies can call them cheaply).
create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = public.requesting_user_id() $$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_app_role() in ('OWNER_ADMIN', 'SUPER_ADMIN'), false) $$;

-- Effective status, accounting for expired temporary actions.
create or replace function public.user_status(p_user text)
returns public.account_status language sql stable security definer set search_path = ''
as $$
  select case
    when p.status = 'active' then 'active'::public.account_status
    when p.status_until is not null and p.status_until <= now() then 'active'::public.account_status
    else p.status end
  from public.profiles p where p.id = p_user
$$;

-- Agencies -------------------------------------------------------------------
create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('AG-' || upper(substr(md5(gen_random_uuid()::text), 1, 6))),
  name text not null check (char_length(name) between 2 and 80),
  manager_id text references public.profiles(id),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table public.agency_members (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  member_role text not null check (member_role in ('admin', 'manager', 'agent')),
  created_at timestamptz not null default now(),
  primary key (agency_id, user_id)
);

-- Agencies where the caller is admin/manager (can see money + reports).
create or replace function public.admin_agency_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select agency_id from public.agency_members
  where user_id = public.requesting_user_id() and member_role in ('admin', 'manager')
  union
  select id from public.agencies where manager_id = public.requesting_user_id()
$$;

-- Any agency the caller belongs to (agents included).
create or replace function public.member_agency_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select agency_id from public.agency_members where user_id = public.requesting_user_id()
  union
  select id from public.agencies where manager_id = public.requesting_user_id()
$$;

-- Hosts & rooms --------------------------------------------------------------
create sequence public.host_code_seq start 1;

create table public.hosts (
  user_id text primary key references public.profiles(id) on delete cascade,
  host_code text unique not null default ('HOST-' || lpad(nextval('public.host_code_seq')::text, 8, '0')),
  agency_id uuid references public.agencies(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  total_live_seconds bigint not null default 0,
  created_at timestamptz not null default now()
);
create index hosts_agency_idx on public.hosts (agency_id);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  host_id text unique not null references public.hosts(user_id) on delete cascade,
  title text not null default 'Live now' check (char_length(title) between 1 and 80),
  category text not null default 'chat' check (category in ('chat', 'music', 'gaming', 'talent', 'education', 'other')),
  cover_url text,
  status text not null default 'offline' check (status in ('offline', 'live')),
  livekit_room text unique not null default ('room_' || replace(gen_random_uuid()::text, '-', '')),
  viewer_count int not null default 0 check (viewer_count >= 0),
  current_stream_id uuid,
  updated_at timestamptz not null default now()
);
create index rooms_live_idx on public.rooms (status, viewer_count desc);

create table public.streams (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  host_id text not null references public.hosts(user_id) on delete cascade,
  title text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  peak_viewers int not null default 0,
  gift_coins bigint not null default 0,
  pool_coins bigint not null default 0,
  ai_summary jsonb
);
create index streams_host_idx on public.streams (host_id, started_at desc);
alter table public.rooms add constraint rooms_current_stream_fk
  foreign key (current_stream_id) references public.streams(id) on delete set null;

create table public.room_admins (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create or replace function private.enforce_room_admin_limit()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.room_admins where room_id = new.room_id) >= 5 then
    raise exception 'room_admin_limit' using detail = 'A room can have at most 5 admins';
  end if;
  return new;
end $$;
create trigger room_admin_limit before insert on public.room_admins
  for each row execute function private.enforce_room_admin_limit();

create table public.room_bans (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('mute', 'kick', 'block')),
  expires_at timestamptz,
  created_by text references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (room_id, user_id, kind)
);

create table public.viewers (
  stream_id uuid not null references public.streams(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (stream_id, user_id)
);

-- Social ---------------------------------------------------------------------
create table public.follows (
  follower_id text not null default public.requesting_user_id() references public.profiles(id) on delete cascade,
  followee_id text not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id);

create table public.user_blocks (
  blocker_id text not null default public.requesting_user_id() references public.profiles(id) on delete cascade,
  blocked_id text not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- Room chat. Inserted only through send_chat_message().
create table public.messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  stream_id uuid references public.streams(id) on delete set null,
  sender_id text not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  moderation jsonb,
  created_at timestamptz not null default now()
);
create index messages_room_idx on public.messages (room_id, created_at desc);
create index messages_sender_idx on public.messages (sender_id, created_at desc);

create table public.direct_messages (
  id bigint generated always as identity primary key,
  sender_id text not null references public.profiles(id) on delete cascade,
  recipient_id text not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index dm_recipient_idx on public.direct_messages (recipient_id, created_at desc);
create index dm_sender_idx on public.direct_messages (sender_id, created_at desc);

create table public.word_filters (
  term text primary key check (term = lower(term)),
  action text not null default 'mask' check (action in ('mask', 'block'))
);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id text,
  actor_kind text not null default 'user' check (actor_kind in ('user', 'ai', 'system')),
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create or replace function private.audit(
  p_action text, p_target_type text, p_target_id text,
  p_details jsonb default '{}', p_actor_kind text default 'user'
)
returns void language sql security definer set search_path = ''
as $$
  insert into public.audit_logs (actor_id, actor_kind, action, target_type, target_id, details)
  values (public.requesting_user_id(), p_actor_kind, p_action, p_target_type, p_target_id, p_details)
$$;

create or replace function private.notify(p_user text, p_type text, p_title text, p_body text, p_data jsonb default '{}')
returns void language sql security definer set search_path = ''
as $$ insert into public.notifications (user_id, type, title, body, data) values (p_user, p_type, p_title, p_body, p_data) $$;

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (key, value) values
  -- Gift engine: coins spent on a gift are split host / stream pool / owner.
  ('gift_split', '{"host_pct": 90, "stream_pct": 5, "owner_pct": 5}'),
  -- Purchase money path in basis points (see docs/ECONOMY.md).
  ('purchase_split', '{"agency_margin_bps": 1333, "coin_reserve_bps_of_platform": 7692, "livekit_bps_of_internal": 6000}'),
  -- Open question from the architecture: the coin -> PKR rate for withdrawals.
  -- Withdrawals stay disabled until an owner sets {"pkr_per_coin": <number>}.
  ('withdrawal', '{"pkr_per_coin": null, "min_coins": 1000}'),
  ('ai_moderation', '{"mode": "all"}');
