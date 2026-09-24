-- Verified users & host badge.
-- Passing host identity verification (Didit) marks the *user* as verified
-- (profiles.verified_at) and unlocks the Host badge. Only the database sets it:
-- a trigger mirrors hosts.verification_status, and clients have no write grant.

alter table public.profiles add column verified_at timestamptz;
grant select (verified_at) on public.profiles to authenticated;

create or replace function private.sync_profile_verified() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.verification_status is distinct from old.verification_status then
    if new.verification_status = 'approved' then
      update public.profiles set verified_at = coalesce(new.verified_at, now()) where id = new.user_id;
    elsif new.verification_status = 'declined' then
      update public.profiles set verified_at = null where id = new.user_id;
    end if;
  end if;
  return new;
end $$;

create trigger hosts_sync_profile_verified
  after update of verification_status on public.hosts
  for each row execute function private.sync_profile_verified();

-- Hosts already approved before this migration.
update public.profiles p set verified_at = h.verified_at
  from public.hosts h
  where h.user_id = p.id and h.verification_status = 'approved' and p.verified_at is null;

-- Same function as before; the approval notification now mentions the badge.
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
        when 'approved' then 'You''re verified — Host badge unlocked'
        when 'declined' then 'Verification unsuccessful'
        else 'Verification under review' end,
      case v_status
        when 'approved' then 'Your identity is confirmed and you''ve earned the Host badge. You can now go live and withdraw earnings.'
        when 'declined' then 'We couldn''t verify your identity. You can try again from the Go live tab.'
        else 'Our team is reviewing your documents. This usually takes less than a day.' end,
      jsonb_build_object('session_id', p_session_id));
  end if;
  perform private.audit('host_verification_' || v_status, 'user', v.user_id,
    jsonb_build_object('session_id', p_session_id, 'provider_status', p_provider_status), 'system');
  return jsonb_build_object('changed', true, 'status', v_status, 'applied_to_host', true);
end $$;
