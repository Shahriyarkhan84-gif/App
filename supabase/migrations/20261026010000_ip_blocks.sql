-- IP blocks: every API request from a blocked address (or range) is refused with HTTP 403 before
-- it reaches any table or function, for the app, the website and the Android app alike.
-- Admins manage the list with block_ip() / unblock_ip(); clients cannot read it.

create table if not exists private.blocked_ips (
  ip inet primary key,              -- one address (162.128.44.156) or a range (162.128.44.0/24)
  reason text,
  user_id text,                     -- the account it was blocked for, if any
  created_by text,
  created_at timestamptz not null default now()
);
alter table private.blocked_ips enable row level security;
revoke all on private.blocked_ips from public, anon, authenticated;

-- The caller's address. Supabase sits behind Cloudflare, which sets cf-connecting-ip itself (a
-- client can't fake it); the others are fallbacks. Null when unknown, so nothing is blocked.
create or replace function private.request_ip()
returns inet language plpgsql stable set search_path = ''
as $$
declare h json; v text;
begin
  h := nullif(current_setting('request.headers', true), '')::json;
  v := coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', split_part(h->>'x-forwarded-for', ',', 1));
  return nullif(trim(v), '')::inet;
exception when others then
  return null;
end $$;

-- Runs before every API request (pgrst.db_pre_request below).
create or replace function public.check_request_ip()
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.blocked_ips b where b.ip >>= private.request_ip()) then
    raise sqlstate 'PT403' using message = 'blocked', hint = 'Access from this network is blocked.';
  end if;
end $$;
revoke all on function public.check_request_ip() from public;
grant execute on function public.check_request_ip() to anon, authenticated, service_role;

create or replace function public.block_ip(p_ip text, p_reason text default null, p_user text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v inet;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  begin v := p_ip::inet; exception when others then raise exception 'invalid_ip'; end;
  insert into private.blocked_ips (ip, reason, user_id, created_by)
  values (v, p_reason, p_user, public.requesting_user_id())
  on conflict (ip) do update set reason = excluded.reason, user_id = excluded.user_id, created_by = excluded.created_by;
  perform private.audit('ip_blocked', 'ip', v::text, jsonb_build_object('reason', p_reason, 'user_id', p_user));
end $$;

create or replace function public.unblock_ip(p_ip text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v inet;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  begin v := p_ip::inet; exception when others then raise exception 'invalid_ip'; end;
  delete from private.blocked_ips where ip = v;
  perform private.audit('ip_unblocked', 'ip', v::text);
end $$;
revoke all on function public.block_ip(text, text, text), public.unblock_ip(text) from public, anon;
grant execute on function public.block_ip(text, text, text), public.unblock_ip(text) to authenticated;

-- Turn the check on for the API (the test database has no authenticator role).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''public.check_request_ip''';
  end if;
end $$;
notify pgrst, 'reload config';
