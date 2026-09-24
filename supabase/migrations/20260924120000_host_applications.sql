-- In-app host application: the user fills name, phone, CNIC number, CNIC
-- front/back photos, a face photo holding the CNIC and their agency code (required).
-- The host-application edge function sends the photos to Didit's ID
-- verification and face-match APIs and never stores them. Zynalive keeps only
-- what is below: no images, no full CNIC number.

create table public.host_applications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 3 and 80),
  phone text not null check (phone ~ '^\+923[0-9]{9}$'),
  cnic_last4 text not null check (cnic_last4 ~ '^[0-9]{4}$'),
  agency_code text not null,
  agency_id uuid references public.agencies(id) on delete set null,
  id_status text,           -- Didit ID verification: Approved / Declined / In Review
  face_status text,         -- Didit face match
  face_score int,
  cnic_match boolean,       -- typed CNIC number = number read from the card
  name_match boolean,       -- typed name ≈ name read from the card
  age int,
  status text not null check (status in ('approved', 'in_review', 'declined')),
  reasons text[] not null default '{}',
  didit_id_request text,
  didit_face_request text,
  reviewed_by text references public.profiles(id),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index host_applications_user_idx on public.host_applications (user_id, created_at desc);
create index host_applications_review_idx on public.host_applications (status, created_at) where status = 'in_review';

alter table public.host_applications enable row level security;
revoke all on public.host_applications from anon, authenticated;
grant select on public.host_applications to authenticated;
create policy "own or admin applications" on public.host_applications for select to authenticated
  using (user_id = public.requesting_user_id() or public.is_platform_admin());

-- Shared by become_host() and applications: host row, room, earnings, role.
create or replace function private.ensure_host(p_user text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.hosts (user_id) values (p_user) on conflict (user_id) do nothing;
  insert into public.rooms (host_id) values (p_user) on conflict (host_id) do nothing;
  insert into public.creator_earnings (host_id) values (p_user) on conflict (host_id) do nothing;
  update public.profiles set role = 'HOST' where id = p_user and role = 'USER';
end $$;

-- Applies a final decision to the host: status, agency link (host's consent via
-- the code they typed; only if they have no agency yet) and a notification.
create or replace function private.apply_host_decision(p_app public.host_applications) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.hosts
    set verification_status = p_app.status,
        verified_at = case when p_app.status = 'approved' then now() when p_app.status = 'declined' then null else verified_at end,
        agency_id = case when p_app.status = 'approved' and agency_id is null then p_app.agency_id else agency_id end
    where user_id = p_app.user_id;

  perform private.notify(p_app.user_id, 'verification',
    case p_app.status
      when 'approved' then 'You''re verified — Host badge unlocked'
      when 'declined' then 'Verification unsuccessful'
      else 'Verification under review' end,
    case p_app.status
      when 'approved' then 'Your identity is confirmed and you''ve earned the Host badge. You can now go live and withdraw earnings.'
      when 'declined' then 'We couldn''t verify your identity. Check your photos and details and try again from Hosting.'
      else 'Our team is checking your details. This usually takes less than a day.' end,
    jsonb_build_object('application_id', p_app.id));
end $$;

create or replace function public.internal_submit_host_application(
  p_user text, p_full_name text, p_phone text, p_cnic_last4 text, p_agency_code text,
  p_id_status text, p_face_status text, p_face_score int, p_cnic_match boolean, p_name_match boolean,
  p_age int, p_id_request text, p_face_request text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_agency uuid;
  v_status text := 'approved';
  v_reasons text[] := '{}';
  v_app public.host_applications;
begin
  if public.user_status(p_user) <> 'active' then raise exception 'account_restricted'; end if;
  if exists (select 1 from public.hosts where user_id = p_user and verification_status = 'approved') then
    raise exception 'already_verified';
  end if;

  if nullif(trim(p_agency_code), '') is null then raise exception 'agency_code_required'; end if;
  select id into v_agency from public.agencies where code = upper(trim(p_agency_code)) and status = 'active';
  if v_agency is null then raise exception 'invalid_agency_code'; end if;

  -- Hard fails decline; uncertain results go to a person.
  if p_age is not null and p_age < 18 then v_reasons := array_append(v_reasons, 'underage'); end if;
  if p_id_status = 'Declined' then v_reasons := array_append(v_reasons, 'id_declined'); end if;
  if p_face_status = 'Declined' then v_reasons := array_append(v_reasons, 'face_mismatch'); end if;
  if cardinality(v_reasons) > 0 then
    v_status := 'declined';
  else
    if p_id_status is distinct from 'Approved' then v_reasons := array_append(v_reasons, 'id_needs_review'); end if;
    if p_face_status is distinct from 'Approved' then v_reasons := array_append(v_reasons, 'face_needs_review'); end if;
    if p_cnic_match is not true then v_reasons := array_append(v_reasons, 'cnic_mismatch'); end if;
    if p_name_match is not true then v_reasons := array_append(v_reasons, 'name_mismatch'); end if;
    if p_age is null then v_reasons := array_append(v_reasons, 'age_unknown'); end if;
    if cardinality(v_reasons) > 0 then v_status := 'in_review'; end if;
  end if;

  perform private.ensure_host(p_user);

  insert into public.host_applications (user_id, full_name, phone, cnic_last4, agency_code, agency_id, id_status, face_status,
    face_score, cnic_match, name_match, age, status, reasons, didit_id_request, didit_face_request)
  values (p_user, trim(p_full_name), p_phone, p_cnic_last4, upper(trim(p_agency_code)), v_agency, p_id_status, p_face_status,
    p_face_score, p_cnic_match, p_name_match, p_age, v_status, v_reasons, p_id_request, p_face_request)
  returning * into v_app;

  perform private.apply_host_decision(v_app);
  perform private.audit('host_application_' || v_status, 'user', p_user,
    jsonb_build_object('application_id', v_app.id, 'reasons', v_reasons), 'system');
  return jsonb_build_object('id', v_app.id, 'status', v_status, 'reasons', v_reasons);
end $$;

-- Owners/admins decide applications that need a person.
create or replace function public.review_host_application(p_id uuid, p_approve boolean, p_note text default null)
returns public.host_applications language plpgsql security definer set search_path = ''
as $$
declare v public.host_applications;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  select * into v from public.host_applications where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v.status <> 'in_review' then raise exception 'already_reviewed'; end if;
  -- Only the user's latest application can change their host status.
  if exists (select 1 from public.host_applications where user_id = v.user_id and created_at > v.created_at) then
    raise exception 'superseded';
  end if;

  update public.host_applications
    set status = case when p_approve then 'approved' else 'declined' end,
        reviewed_by = public.requesting_user_id(), review_note = left(p_note, 500), reviewed_at = now()
    where id = p_id returning * into v;

  perform private.apply_host_decision(v);
  perform private.audit('host_application_' || v.status, 'user', v.user_id,
    jsonb_build_object('application_id', v.id, 'note', p_note));
  return v;
end $$;

-- become_host() now shares ensure_host().
create or replace function public.become_host()
returns public.hosts language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v public.hosts;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  perform private.ensure_host(uid);
  select * into v from public.hosts where user_id = uid;
  return v;
end $$;

revoke execute on function public.internal_submit_host_application(text, text, text, text, text, text, text, int, boolean, boolean, int, text, text) from public, anon, authenticated;
grant execute on function public.internal_submit_host_application(text, text, text, text, text, text, text, int, boolean, boolean, int, text, text) to service_role;
grant execute on function public.review_host_application(uuid, boolean, text) to authenticated;

-- Account deletion also removes host applications (name, phone).
create or replace function public.internal_delete_account(p_user text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v public.profiles;
begin
  select * into v from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('deleted', false, 'reason', 'not_found'); end if;
  if v.deleted_at is not null then return jsonb_build_object('deleted', true, 'already', true); end if;

  -- Money owed to the host must be settled (or rejected) first.
  if exists (select 1 from public.withdrawals where host_id = p_user and status in ('requested', 'approved')) then
    raise exception 'withdrawal_pending';
  end if;

  -- Stop broadcasting and hosting.
  update public.streams set ended_at = now() where host_id = p_user and ended_at is null;
  update public.rooms set status = 'offline', viewer_count = 0, updated_at = now() where host_id = p_user and status = 'live';
  update public.hosts set status = 'suspended' where user_id = p_user;

  -- Personal data and social graph.
  delete from public.follows where follower_id = p_user or followee_id = p_user;
  delete from public.user_blocks where blocker_id = p_user or blocked_id = p_user;
  delete from public.direct_messages where sender_id = p_user or recipient_id = p_user;
  delete from public.notifications where user_id = p_user;
  delete from public.user_recommendations where user_id = p_user;
  delete from public.room_admins where user_id = p_user;
  delete from public.host_applications where user_id = p_user;
  update public.messages set body = '[deleted]', status = 'hidden' where sender_id = p_user;
  update public.support_tickets set subject = '[deleted]', body = '[deleted]', ai_reply = null where user_id = p_user;

  update public.profiles
    set username = null, display_name = 'Deleted user', avatar_url = null, bio = null, email = null,
        country = null, verified_at = null, status = 'banned', status_until = null, deleted_at = now()
    where id = p_user;

  perform private.audit('account_deleted', 'user', p_user, '{}', 'system');
  return jsonb_build_object('deleted', true);
end $$;

