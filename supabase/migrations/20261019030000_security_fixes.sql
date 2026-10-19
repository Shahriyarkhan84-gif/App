-- Fixes from the 2026-10-19 backend security audit. Safe to run more than once.
-- Needs 20261019010000_bug_fixes.sql and 20261019020000_analysis_fixes.sql first.

-- M4. Only Clerk sessions count as a signed-in user. Supabase Auth's own tokens (issued by
--     <project>/auth/v1, e.g. from a direct sign-up with the public key) no longer map to a user,
--     so they can't call any RPC as someone. (Also turn off Supabase Auth sign-ups in the dashboard.)
create or replace function public.requesting_user_id()
returns text language sql stable set search_path = ''
as $$
  select case when coalesce(auth.jwt() ->> 'iss', '') like '%/auth/v1' then null
              else nullif(auth.jwt() ->> 'sub', '') end
$$;

-- L2. Platform admin rights need an active, not deleted account (a banned or deleted owner loses
--     them at once), and only a super admin can action a super admin.
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select p.role in ('OWNER_ADMIN', 'SUPER_ADMIN') and p.deleted_at is null
           and (p.status = 'active' or (p.status_until is not null and p.status_until <= now()))
    from public.profiles p where p.id = public.requesting_user_id()
  ), false)
$$;

create or replace function public.apply_moderation_action(
  p_user text, p_action text, p_reason text, p_hours int default null, p_report uuid default null
)
returns public.moderation_actions language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if (select role from public.profiles where id = p_user) = 'SUPER_ADMIN'
     and public.current_app_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'protected_account';
  end if;
  return private.apply_moderation(p_user, p_action, p_reason, p_hours, 'admin', p_report);
end $$;

-- M2. Public videos only from hosts who passed the ID check (going live and withdrawing already
--     required it); `host_verification.required_to_upload` = false switches this off.
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
  if private.host_verification_required('upload')
     and not exists (select 1 from public.hosts where user_id = uid and verification_status = 'approved') then
    raise exception 'verification_required';
  end if;
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

-- M6. Support tickets each start a paid AI job: at most 5 a day per person.
create or replace function public.create_support_ticket(p_subject text, p_body text)
returns public.support_tickets language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_row public.support_tickets;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if (select count(*) from public.support_tickets where user_id = uid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'slow_down';
  end if;
  insert into public.support_tickets (user_id, subject, body) values (uid, p_subject, p_body) returning * into v_row;
  perform private.enqueue_ai_job('support_ticket', jsonb_build_object('ticket_id', v_row.id), 'ticket:' || v_row.id);
  return v_row;
end $$;

-- M5. One CNIC, one host account: host-application stores a keyed hash of the full CNIC (never
--     the number; the key is the CNIC_HASH_KEY Edge secret), and a CNIC already used by another
--     account goes to a person instead of being approved automatically.
alter table public.host_applications add column if not exists cnic_hash text;
create index if not exists host_applications_cnic_hash_idx on public.host_applications (cnic_hash) where cnic_hash is not null;

drop function if exists public.internal_submit_host_application(text, text, text, text, text, text, text, int, boolean, boolean, int, text, text, text);
create or replace function public.internal_submit_host_application(
  p_user text, p_full_name text, p_phone text, p_cnic_last4 text, p_agency_code text,
  p_id_status text, p_face_status text, p_face_score int, p_cnic_match boolean, p_name_match boolean,
  p_age int, p_id_request text, p_face_request text, p_liveness_status text default null, p_cnic_hash text default null
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_agency uuid;
  v_status text;
  v_reasons text[] := '{}';
  v_app public.host_applications;
  v_reused boolean := false;
begin
  if public.user_status(p_user) <> 'active' then raise exception 'account_restricted'; end if;
  if exists (select 1 from public.hosts where user_id = p_user and verification_status = 'approved') then
    raise exception 'already_verified';
  end if;

  if nullif(trim(p_agency_code), '') is null then raise exception 'agency_code_required'; end if;
  select id into v_agency from public.agencies where code = trim(p_agency_code) and status = 'active';
  if v_agency is null then raise exception 'invalid_agency_code'; end if;
  -- One person, one host account: a CNIC already used by another account's approved (or pending)
  -- application never auto-approves.
  if p_cnic_hash is not null then
    select exists (select 1 from public.host_applications where cnic_hash = p_cnic_hash and user_id <> p_user
                   and status in ('approved', 'in_review')) into v_reused;
  end if;

  if (p_age is not null and p_age < 18) or p_id_status = 'Declined' or p_face_status = 'Declined' then
    -- Hard fails.
    v_status := 'declined';
    if p_age is not null and p_age < 18 then v_reasons := array_append(v_reasons, 'underage'); end if;
    if p_id_status = 'Declined' then v_reasons := array_append(v_reasons, 'id_declined'); end if;
    if p_face_status = 'Declined' then v_reasons := array_append(v_reasons, 'face_mismatch'); end if;
  elsif p_id_status = 'Approved' and p_face_status = 'Approved' and p_age is not null
        and p_liveness_status = 'Approved' and not v_reused
        and coalesce((private.setting('host_verification') ->> 'auto_approve')::boolean, false) then
    -- Verified by Didit (document, face match and a live person) and the owner turned on auto-approval.
    v_status := 'approved';
  elsif p_id_status = 'Approved' and p_face_status = 'Approved' and p_age is not null then
    -- Everything matched, but a person approves: auto-approval is off, or liveness wasn't confirmed
    -- (a printed or on-screen photo, or the check couldn't run).
    v_status := 'in_review';
    v_reasons := array_append(v_reasons, case
      when v_reused then 'cnic_reused'
      when p_liveness_status is null then 'liveness_not_checked'
      when p_liveness_status = 'Approved' then 'manual_review'
      else 'liveness_failed' end);
  else
    -- Didit hasn't reached a decision (or the age couldn't be read): a person decides.
    v_status := 'in_review';
    if p_id_status is distinct from 'Approved' then v_reasons := array_append(v_reasons, 'id_needs_review'); end if;
    if p_face_status is distinct from 'Approved' then v_reasons := array_append(v_reasons, 'face_needs_review'); end if;
    if p_age is null then v_reasons := array_append(v_reasons, 'age_unknown'); end if;
    if p_liveness_status is distinct from 'Approved' then v_reasons := array_append(v_reasons, 'liveness_failed'); end if;
    if v_reused then v_reasons := array_append(v_reasons, 'cnic_reused'); end if;
  end if;
  -- Notes only; never block approval.
  if p_cnic_match is not true then v_reasons := array_append(v_reasons, 'cnic_mismatch'); end if;
  if p_name_match is not true then v_reasons := array_append(v_reasons, 'name_mismatch'); end if;

  perform private.ensure_host(p_user);

  insert into public.host_applications (user_id, full_name, phone, cnic_last4, agency_code, agency_id, id_status, face_status,
    face_score, cnic_match, name_match, age, status, reasons, didit_id_request, didit_face_request, liveness_status, cnic_hash)
  values (p_user, trim(p_full_name), p_phone, p_cnic_last4, trim(p_agency_code), v_agency, p_id_status, p_face_status,
    p_face_score, p_cnic_match, p_name_match, p_age, v_status, v_reasons, p_id_request, p_face_request, p_liveness_status, p_cnic_hash)
  returning * into v_app;

  perform private.apply_host_decision(v_app);
  perform private.audit('host_application_' || v_status, 'user', p_user,
    jsonb_build_object('application_id', v_app.id, 'reasons', v_reasons), 'system');
  return jsonb_build_object('id', v_app.id, 'status', v_status, 'reasons', v_reasons);
end $$;
revoke execute on function public.internal_submit_host_application(text, text, text, text, text, text, text, int, boolean, boolean, int, text, text, text, text) from public, anon, authenticated;
grant execute on function public.internal_submit_host_application(text, text, text, text, text, text, text, int, boolean, boolean, int, text, text, text, text) to service_role;

-- L3. Agency managers no longer see who reported their hosts or their hosts' payout accounts
--     (the agency portal reads its totals through agency_portal(), which is unaffected).
drop policy if exists "reports" on public.reports;
create policy "reports" on public.reports for select to authenticated
  using (reporter_id = public.requesting_user_id() or public.is_platform_admin());
drop policy if exists "withdrawals" on public.withdrawals;
create policy "withdrawals" on public.withdrawals for select to authenticated
  using (host_id = public.requesting_user_id() or public.is_platform_admin());

-- L4. A translation is readable only while its message is visible (hidden chat can't be read
--     through an earlier translation).
drop policy if exists "translations readable" on public.message_translations;
create policy "translations readable" on public.message_translations for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and m.status = 'visible'));

-- L5. A host's AI coaching is private: it moves from streams.ai_summary (readable by everyone)
--     to stream_coaching, readable only by that host (and the owner).
create table if not exists public.stream_coaching (
  stream_id uuid primary key references public.streams (id) on delete cascade,
  host_id text not null references public.profiles (id) on delete cascade,
  summary jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists stream_coaching_host_idx on public.stream_coaching (host_id);
alter table public.stream_coaching enable row level security;
revoke all on public.stream_coaching from anon, authenticated;
grant select on public.stream_coaching to authenticated;
drop policy if exists "own coaching" on public.stream_coaching;
create policy "own coaching" on public.stream_coaching for select to authenticated
  using (host_id = public.requesting_user_id() or public.is_platform_admin());
insert into public.stream_coaching (stream_id, host_id, summary)
  select id, host_id, ai_summary from public.streams where ai_summary is not null
  on conflict (stream_id) do nothing;
-- The old column is emptied (kept so older workers don't fail); new coaching is written to stream_coaching.
update public.streams set ai_summary = null where ai_summary is not null;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'stream_coaching') then
    alter publication supabase_realtime add table public.stream_coaching;
  end if;
end $$;

-- L6. Tor exits (T1) no longer fall back to the device's region: that was a way to pick cheaper
--     prices. Sign-ups whose country header is missing keep the device region, as before.
create or replace function public.ensure_profile(p_display_name text default null, p_region text default null)
returns public.profiles language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v public.profiles;
  v_country text := private.request_country();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if v_country = 'T1' then
    v_country := null;
  elsif v_country is null or v_country !~ '^[A-Z]{2}$' or v_country = 'XX' then
    v_country := case when upper(p_region) ~ '^[A-Z]{2}$' then upper(p_region) end;
  end if;
  insert into public.profiles (id, display_name, signup_country, country) values (uid, left(p_display_name, 50), v_country, v_country)
    on conflict (id) do nothing;
  update public.profiles set signup_country = v_country where id = uid and signup_country is null and v_country is not null;
  update public.profiles set display_name = left(trim(p_display_name), 50)
    where id = uid and nullif(trim(display_name), '') is null and nullif(trim(p_display_name), '') is not null;
  insert into public.wallets (user_id) values (uid) on conflict (user_id) do nothing;
  select * into v from public.profiles where id = uid;
  return v;
end $$;
