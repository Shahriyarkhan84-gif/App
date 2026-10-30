-- Push notifications (Expo push service). Every in-app notification, every new direct message and
-- "<host> is live now" for followers also reach the phone. The database hands each one to the
-- push-send Edge Function (pg_net, asynchronous: never slows the action that caused it); push-send
-- asks internal_push_messages() what to send, so only the database decides who gets what.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

-- Device tokens --------------------------------------------------------------------------------
create table if not exists public.push_tokens (
  token text primary key check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$'),
  user_id text not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated; -- only through the functions below

-- A phone that signs in to another account moves its token to that account.
create or replace function public.register_push_token(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  insert into public.push_tokens (token, user_id, platform) values (p_token, uid, p_platform)
    on conflict (token) do update set user_id = uid, platform = excluded.platform, updated_at = now();
exception when check_violation then raise exception 'invalid_push_token';
end $$;

create or replace function public.unregister_push_token(p_token text)
returns void language sql security definer set search_path = ''
as $$ delete from public.push_tokens where token = p_token and user_id = public.requesting_user_id() $$;

-- Mutable groups: lives (someone you follow went live) and messages (direct messages) join
-- pk_battles and events. Payments, withdrawals, verification and safety notices stay on.
create or replace function private.notification_group(p_type text)
returns text language sql immutable set search_path = ''
as $$ select case when p_type like 'pk_battle%' then 'pk_battles' when p_type = 'event_reward' then 'events'
                  when p_type = 'live_started' then 'lives' when p_type = 'direct_message' then 'messages' end $$;

create or replace function public.set_notification_muted(p_group text, p_muted boolean)
returns text[] language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v text[];
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_group not in ('pk_battles', 'events', 'lives', 'messages') then raise exception 'not_mutable'; end if;
  insert into public.notification_settings (user_id, muted) values (uid, '{}') on conflict (user_id) do nothing;
  update public.notification_settings
     set muted = case when p_muted then array(select distinct unnest(muted || p_group)) else array_remove(muted, p_group) end,
         updated_at = now()
   where user_id = uid
  returning muted into v;
  return v;
end $$;

-- Delivery --------------------------------------------------------------------------------------
-- Set once per project (SQL editor):
--   insert into private.push_config (url, secret) values ('https://<project-ref>.supabase.co/functions/v1/push-send', '<random secret>');
-- Without a row nothing is sent; everything else works as before.
create table if not exists private.push_config (
  id boolean primary key default true check (id),
  url text not null,
  secret text not null check (char_length(secret) >= 24)
);

create or replace function private.push_dispatch(p_kind text, p_id text)
returns void language plpgsql security definer set search_path = ''
as $$
declare c private.push_config;
begin
  select * into c from private.push_config;
  if not found then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    using c.url, jsonb_build_object('kind', p_kind, 'id', p_id),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || c.secret);
exception when others then
  null; -- a push is best effort; never fail the notification, message or go-live that caused it
end $$;

create or replace function private.push_on_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- live_started is sent in one batch per live (push_on_live), not one call per follower.
  if new.type <> 'live_started' and exists (select 1 from public.push_tokens where user_id = new.user_id) then
    perform private.push_dispatch('notification', new.id::text);
  end if;
  return null;
end $$;
drop trigger if exists push_on_notification on public.notifications;
create trigger push_on_notification after insert on public.notifications
  for each row execute function private.push_on_notification();

create or replace function private.push_on_direct_message()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.push_tokens where user_id = new.recipient_id)
     and not exists (select 1 from public.notification_settings where user_id = new.recipient_id and 'messages' = any(muted)) then
    perform private.push_dispatch('direct_message', new.id::text);
  end if;
  return null;
end $$;
drop trigger if exists push_on_direct_message on public.direct_messages;
create trigger push_on_direct_message after insert on public.direct_messages
  for each row execute function private.push_on_direct_message();

-- "<host> is live now" for followers: an in-app notification each (one insert) and one push batch.
-- At most once per host every 30 minutes, so reconnects and quick restarts don't spam followers.
create table if not exists private.live_alerts (host_id text primary key, sent_at timestamptz not null);

create or replace function private.push_on_live()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_name text;
begin
  if new.status <> 'live' or old.status = 'live' then return null; end if;
  if exists (select 1 from private.live_alerts where host_id = new.host_id and sent_at > now() - interval '30 minutes') then return null; end if;
  insert into private.live_alerts (host_id, sent_at) values (new.host_id, now())
    on conflict (host_id) do update set sent_at = now();
  select coalesce(display_name, username, 'Someone you follow') into v_name from public.profiles where id = new.host_id;
  insert into public.notifications (user_id, type, title, body, data)
  select f.follower_id, 'live_started', v_name || ' is live now', new.title, jsonb_build_object('room_id', new.id, 'host_id', new.host_id)
  from public.follows f
  where f.followee_id = new.host_id
    and not exists (select 1 from public.notification_settings s where s.user_id = f.follower_id and 'lives' = any(s.muted))
    and not exists (select 1 from public.user_blocks b where b.blocker_id = f.follower_id and b.blocked_id = new.host_id)
  order by f.created_at desc
  limit 10000;
  perform private.push_dispatch('live', new.id::text);
  return null;
end $$;
drop trigger if exists push_on_live on public.rooms;
create trigger push_on_live after update of status on public.rooms
  for each row execute function private.push_on_live();

-- What push-send sends: [{ token, title, body, data }]. Called with the shared secret, so only
-- push-send (which received it from the database) can read messages and tokens.
create or replace function public.internal_push_messages(p_kind text, p_id text, p_secret text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not exists (select 1 from private.push_config where secret = p_secret) then raise exception 'forbidden'; end if;
  if p_kind = 'notification' then
    select coalesce(jsonb_agg(jsonb_build_object('token', t.token, 'title', n.title, 'body', coalesce(n.body, ''),
             'data', jsonb_build_object('type', n.type, 'url',
               case when n.data ? 'room_id' and n.type not like 'pk_battle%' then '/live/' || (n.data ->> 'room_id') else '/messages' end))), '[]')
      into v
    from public.notifications n join public.push_tokens t on t.user_id = n.user_id
    where n.id = p_id::bigint;
  elsif p_kind = 'direct_message' then
    select coalesce(jsonb_agg(jsonb_build_object('token', t.token,
             'title', coalesce(p.display_name, p.username, 'New message'),
             'body', left(m.body, 140),
             'data', jsonb_build_object('type', 'direct_message', 'url', '/chat/' || m.sender_id))), '[]')
      into v
    from public.direct_messages m
    join public.profiles p on p.id = m.sender_id
    join public.push_tokens t on t.user_id = m.recipient_id
    where m.id = p_id::bigint;
  elsif p_kind = 'live' then
    -- Followers just told in the app (live_started rows from the last minute for this room).
    select coalesce(jsonb_agg(jsonb_build_object('token', t.token, 'title', n.title, 'body', coalesce(n.body, ''),
             'data', jsonb_build_object('type', 'live_started', 'url', '/live/' || p_id))), '[]')
      into v
    from public.notifications n join public.push_tokens t on t.user_id = n.user_id
    where n.type = 'live_started' and n.data ->> 'room_id' = p_id and n.created_at > now() - interval '1 minute';
  else
    raise exception 'invalid_kind';
  end if;
  return v;
end $$;

-- Tokens Expo says no longer reach a phone (app uninstalled, notifications turned off).
create or replace function public.internal_remove_push_tokens(p_tokens text[], p_secret text)
returns int language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  if not exists (select 1 from private.push_config where secret = p_secret) then raise exception 'forbidden'; end if;
  delete from public.push_tokens where token = any(p_tokens);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.register_push_token(text, text), public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text), public.unregister_push_token(text) to authenticated;
revoke all on function public.internal_push_messages(text, text, text), public.internal_remove_push_tokens(text[], text) from public, anon, authenticated;
grant execute on function public.internal_push_messages(text, text, text), public.internal_remove_push_tokens(text[], text) to service_role;
