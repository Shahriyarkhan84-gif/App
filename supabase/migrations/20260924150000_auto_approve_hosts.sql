-- Hosts are approved automatically as soon as Didit verifies them: ID approved,
-- face match approved and 18+. A typed CNIC number or name that differs from
-- the card no longer holds the application — Didit has already verified the
-- card itself and matched the face to it — it is kept only as a note (reasons)
-- for the owner. Only results Didit hasn't finished (In Review / missing) or an
-- unreadable age still go to a person.

create or replace function public.internal_submit_host_application(
  p_user text, p_full_name text, p_phone text, p_cnic_last4 text, p_agency_code text,
  p_id_status text, p_face_status text, p_face_score int, p_cnic_match boolean, p_name_match boolean,
  p_age int, p_id_request text, p_face_request text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_agency uuid;
  v_status text;
  v_reasons text[] := '{}';
  v_app public.host_applications;
begin
  if public.user_status(p_user) <> 'active' then raise exception 'account_restricted'; end if;
  if exists (select 1 from public.hosts where user_id = p_user and verification_status = 'approved') then
    raise exception 'already_verified';
  end if;

  if nullif(trim(p_agency_code), '') is null then raise exception 'agency_code_required'; end if;
  select id into v_agency from public.agencies where code = trim(p_agency_code) and status = 'active';
  if v_agency is null then raise exception 'invalid_agency_code'; end if;

  if (p_age is not null and p_age < 18) or p_id_status = 'Declined' or p_face_status = 'Declined' then
    -- Hard fails.
    v_status := 'declined';
    if p_age is not null and p_age < 18 then v_reasons := array_append(v_reasons, 'underage'); end if;
    if p_id_status = 'Declined' then v_reasons := array_append(v_reasons, 'id_declined'); end if;
    if p_face_status = 'Declined' then v_reasons := array_append(v_reasons, 'face_mismatch'); end if;
  elsif p_id_status = 'Approved' and p_face_status = 'Approved' and p_age is not null then
    -- Verified by Didit → approved automatically.
    v_status := 'approved';
  else
    -- Didit hasn't reached a decision (or the age couldn't be read): a person decides.
    v_status := 'in_review';
    if p_id_status is distinct from 'Approved' then v_reasons := array_append(v_reasons, 'id_needs_review'); end if;
    if p_face_status is distinct from 'Approved' then v_reasons := array_append(v_reasons, 'face_needs_review'); end if;
    if p_age is null then v_reasons := array_append(v_reasons, 'age_unknown'); end if;
  end if;
  -- Notes only; never block approval.
  if p_cnic_match is not true then v_reasons := array_append(v_reasons, 'cnic_mismatch'); end if;
  if p_name_match is not true then v_reasons := array_append(v_reasons, 'name_mismatch'); end if;

  perform private.ensure_host(p_user);

  insert into public.host_applications (user_id, full_name, phone, cnic_last4, agency_code, agency_id, id_status, face_status,
    face_score, cnic_match, name_match, age, status, reasons, didit_id_request, didit_face_request)
  values (p_user, trim(p_full_name), p_phone, p_cnic_last4, trim(p_agency_code), v_agency, p_id_status, p_face_status,
    p_face_score, p_cnic_match, p_name_match, p_age, v_status, v_reasons, p_id_request, p_face_request)
  returning * into v_app;

  perform private.apply_host_decision(v_app);
  perform private.audit('host_application_' || v_status, 'user', p_user,
    jsonb_build_object('application_id', v_app.id, 'reasons', v_reasons), 'system');
  return jsonb_build_object('id', v_app.id, 'status', v_status, 'reasons', v_reasons);
end $$;

revoke execute on function public.internal_submit_host_application(text, text, text, text, text, text, text, int, boolean, boolean, int, text, text) from public, anon, authenticated;
grant execute on function public.internal_submit_host_application(text, text, text, text, text, text, text, int, boolean, boolean, int, text, text) to service_role;
