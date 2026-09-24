-- Host identity verification (KYC) with Didit.
--
-- Hosts verify their identity (ID document + liveness + face match) before they
-- can go live or withdraw earnings. Verification results arrive only through
-- the signed Didit webhook (service role); clients can read their own status
-- but can never write it. Only a minimal, non-PII summary of the decision is
-- stored here; the full decision (names, document numbers, images) stays in Didit.

alter table public.hosts
  add column verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'in_review', 'approved', 'declined')),
  add column verified_at timestamptz;

create table public.host_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(id) on delete cascade,
  provider text not null default 'didit',
  session_id text not null unique,
  provider_status text not null default 'Not Started',
  status text not null default 'pending'
    check (status in ('unverified', 'pending', 'in_review', 'approved', 'declined')),
  summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index host_verifications_user_idx on public.host_verifications (user_id, created_at desc);

insert into public.platform_settings (key, value) values
  ('host_verification', '{"required_to_go_live": true, "required_to_withdraw": true}')
on conflict (key) do nothing;

create or replace function private.host_verification_required(p_action text)
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((private.setting('host_verification') ->> ('required_to_' || p_action))::boolean, true) $$;

-- Didit status -> our status.
create or replace function private.map_didit_status(p_status text)
returns text language sql immutable set search_path = ''
as $$
  select case p_status
    when 'Approved' then 'approved'
    when 'Declined' then 'declined'
    when 'In Review' then 'in_review'
    when 'Not Started' then 'pending'
    when 'In Progress' then 'pending'
    when 'Awaiting User' then 'pending'
    when 'Resubmitted' then 'pending'
    else 'unverified' -- Expired, Abandoned, Kyc Expired, unknown
  end
$$;

-- Records a new Didit session for a host (called by the didit-session function).
create or replace function public.internal_start_host_verification(p_user text, p_session_id text)
returns public.host_verifications language plpgsql security definer set search_path = ''
as $$
declare v_host public.hosts; v_row public.host_verifications;
begin
  select * into v_host from public.hosts where user_id = p_user for update;
  if not found then raise exception 'not_a_host'; end if;
  if v_host.verification_status = 'approved' then raise exception 'already_verified'; end if;
  insert into public.host_verifications (user_id, session_id) values (p_user, p_session_id)
    returning * into v_row;
  update public.hosts set verification_status = 'pending' where user_id = p_user;
  return v_row;
end $$;

-- Applies a verified Didit status (called by the didit-webhook function after it
-- re-reads the authoritative decision from Didit). Idempotent.
create or replace function public.internal_apply_host_verification(p_session_id text, p_provider_status text, p_summary jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v public.host_verifications;
  v_status text := private.map_didit_status(p_provider_status);
  v_latest uuid;
  v_before text;
begin
  select * into v from public.host_verifications where session_id = p_session_id for update;
  if not found then raise exception 'unknown_session'; end if;
  if v.provider_status = p_provider_status then
    return jsonb_build_object('changed', false, 'status', v.status);
  end if;

  update public.host_verifications
    set provider_status = p_provider_status, status = v_status, summary = coalesce(p_summary, '{}'), updated_at = now()
    where id = v.id;

  -- Only the host's most recent session drives their status.
  select id into v_latest from public.host_verifications where user_id = v.user_id order by created_at desc limit 1;
  if v_latest <> v.id then
    return jsonb_build_object('changed', true, 'status', v_status, 'applied_to_host', false);
  end if;

  select verification_status into v_before from public.hosts where user_id = v.user_id for update;
  update public.hosts
    set verification_status = v_status,
        verified_at = case when v_status = 'approved' then now() when v_status = 'declined' then null else verified_at end
    where user_id = v.user_id;

  if v_status is distinct from v_before and v_status in ('approved', 'declined', 'in_review') then
    perform private.notify(v.user_id, 'verification',
      case v_status
        when 'approved' then 'You''re verified'
        when 'declined' then 'Verification unsuccessful'
        else 'Verification under review' end,
      case v_status
        when 'approved' then 'Your identity is confirmed. You can now go live and withdraw earnings.'
        when 'declined' then 'We couldn''t verify your identity. You can try again from the Create tab.'
        else 'Our team is reviewing your documents. This usually takes less than a day.' end,
      jsonb_build_object('session_id', p_session_id));
  end if;
  perform private.audit('host_verification_' || v_status, 'user', v.user_id,
    jsonb_build_object('session_id', p_session_id, 'provider_status', p_provider_status), 'system');
  return jsonb_build_object('changed', true, 'status', v_status, 'applied_to_host', true);
end $$;

-- Gate going live on verification ----------------------------------------------------
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
  if private.host_verification_required('go_live')
     and (select verification_status from public.hosts where user_id = uid) <> 'approved' then
    raise exception 'verification_required';
  end if;
  if v_room.status = 'live' then return v_room; end if;
  insert into public.streams (room_id, host_id, title) values (v_room.id, uid, coalesce(nullif(trim(p_title), ''), 'Live now'))
    returning id into v_stream;
  update public.rooms set status = 'live', title = coalesce(nullif(trim(p_title), ''), 'Live now'),
    category = p_category, current_stream_id = v_stream, viewer_count = 0, updated_at = now()
    where id = v_room.id returning * into v_room;
  insert into public.notifications (user_id, type, title, body, data)
    select f.follower_id, 'live', coalesce(p.display_name, p.username, 'A host you follow') || ' is live',
           v_room.title, jsonb_build_object('room_id', v_room.id)
    from public.follows f join public.profiles p on p.id = uid
    where f.followee_id = uid;
  return v_room;
end $$;

-- Gate withdrawals on verification ------------------------------------------------------
create or replace function public.request_withdrawal(p_coins bigint, p_payout_method jsonb)
returns public.withdrawals language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v_cfg jsonb := private.setting('withdrawal');
  v_rate numeric := (v_cfg ->> 'pkr_per_coin')::numeric;
  v_earn public.creator_earnings;
  v_row public.withdrawals;
begin
  if not exists (select 1 from public.hosts where user_id = uid and status = 'active') then raise exception 'not_a_host'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if private.host_verification_required('withdraw')
     and (select verification_status from public.hosts where user_id = uid) <> 'approved' then
    raise exception 'verification_required';
  end if;
  if v_rate is null or v_rate <= 0 then raise exception 'withdrawals_not_configured'; end if;
  if p_coins is null or p_coins < (v_cfg ->> 'min_coins')::bigint then raise exception 'below_minimum'; end if;
  if p_payout_method is null or jsonb_typeof(p_payout_method) <> 'object' or not (p_payout_method ? 'type') then
    raise exception 'invalid_payout_method';
  end if;

  select * into v_earn from public.creator_earnings where host_id = uid for update;
  if not found or v_earn.balance < p_coins then raise exception 'insufficient_earnings'; end if;

  update public.creator_earnings set balance = balance - p_coins, held = held + p_coins, updated_at = now()
    where host_id = uid;
  insert into public.withdrawals (host_id, coins, amount_minor, currency, payout_method)
    values (uid, p_coins, floor(p_coins * v_rate * 100)::bigint, 'pkr', p_payout_method)
    returning * into v_row;
  insert into public.earning_entries (host_id, delta, kind, ref_id) values (uid, -p_coins, 'withdrawal_hold', v_row.id::text);
  return v_row;
end $$;

-- Access ------------------------------------------------------------------------------------
alter table public.host_verifications enable row level security;
revoke all on public.host_verifications from anon, authenticated;
grant select on public.host_verifications to authenticated;
create policy "own verifications" on public.host_verifications for select to authenticated
  using (user_id = public.requesting_user_id() or public.is_platform_admin());

revoke execute on function public.internal_start_host_verification(text, text) from public, anon, authenticated;
revoke execute on function public.internal_apply_host_verification(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.internal_start_host_verification(text, text) to service_role;
grant execute on function public.internal_apply_host_verification(text, text, jsonb) to service_role;
