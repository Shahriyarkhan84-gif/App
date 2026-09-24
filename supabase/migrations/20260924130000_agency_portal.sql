-- Agency codes become 4 random digits (1000–9999) that hosts type in the
-- verification form, and agencies get a portal: one security-definer read
-- (agency_portal) plus code rotation for agency admins. The owner creates
-- agencies from the command center by the manager's 8-digit user ID.

-- Random unused 4-digit code. 9,000 codes; raises when they run out.
create or replace function private.new_agency_code() returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare v text;
begin
  for i in 1..200 loop
    v := (1000 + floor(random() * 9000))::int::text;
    if not exists (select 1 from public.agencies where code = v) then return v; end if;
  end loop;
  raise exception 'agency_codes_exhausted';
end $$;

-- Reissue any old AG-XXXXXX codes, then enforce the new format.
do $$
declare r record;
begin
  for r in select id from public.agencies where code !~ '^[1-9][0-9]{3}$' loop
    update public.agencies set code = private.new_agency_code() where id = r.id;
  end loop;
end $$;
alter table public.agencies alter column code set default private.new_agency_code();
alter table public.agencies add constraint agencies_code_format check (code ~ '^[1-9][0-9]{3}$');

-- Owner creates an agency for a manager identified by their 8-digit user ID.
create or replace function public.create_agency_by_user_number(p_name text, p_user_number int)
returns public.agencies language plpgsql security definer set search_path = ''
as $$
declare v_user text;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  select id into v_user from public.profiles where user_number = p_user_number and deleted_at is null;
  if v_user is null then raise exception 'user_not_found'; end if;
  if exists (select 1 from public.agency_members where user_id = v_user) then raise exception 'already_in_agency'; end if;
  return public.create_agency(trim(p_name), v_user);
end $$;

-- Agency admins/managers (or the owner) issue a new code, e.g. if it leaked.
-- Hosts already linked stay linked; only new applications need the new code.
create or replace function public.regenerate_agency_code(p_agency uuid)
returns public.agencies language plpgsql security definer set search_path = ''
as $$
declare v public.agencies;
begin
  if p_agency is null or not (public.is_platform_admin() or p_agency in (select public.admin_agency_ids())) then
    raise exception 'forbidden';
  end if;
  update public.agencies set code = private.new_agency_code() where id = p_agency returning * into v;
  if not found then raise exception 'not_found'; end if;
  perform private.audit('agency_code_regenerated', 'agency', p_agency::text, '{}');
  return v;
end $$;

-- Everything the agency portal shows, for one agency the caller belongs to.
-- Agents see hosts and applications; money totals and applicant phone numbers
-- are for admins/managers only. No CNIC data leaves host_applications here.
create or replace function public.agency_portal(p_agency uuid default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v_agency public.agencies;
  v_role text;
  v_is_admin boolean;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  select a.* into v_agency from public.agencies a
    where a.id in (select public.member_agency_ids())
      and (p_agency is null or a.id = p_agency)
    order by a.created_at limit 1;
  if v_agency.id is null then raise exception 'not_agency_member'; end if;

  select case when v_agency.manager_id = uid then 'admin' else m.member_role end into v_role
    from (select 1) x left join public.agency_members m on m.agency_id = v_agency.id and m.user_id = uid;
  v_is_admin := v_role in ('admin', 'manager');

  return jsonb_build_object(
    'agency', jsonb_build_object('id', v_agency.id, 'name', v_agency.name, 'code', v_agency.code, 'status', v_agency.status),
    'role', v_role,
    'stats', jsonb_build_object(
      'hosts', (select count(*) from public.hosts where agency_id = v_agency.id),
      'verified', (select count(*) from public.hosts where agency_id = v_agency.id and verification_status = 'approved'),
      'live_now', (select count(*) from public.rooms r join public.hosts h on h.user_id = r.host_id
                    where h.agency_id = v_agency.id and r.status = 'live'),
      'in_review', (select count(*) from public.host_applications where agency_id = v_agency.id and status = 'in_review'),
      'earnings_lifetime', case when v_is_admin then (select coalesce(sum(e.lifetime), 0) from public.creator_earnings e
                    join public.hosts h on h.user_id = e.host_id where h.agency_id = v_agency.id) end
    ),
    'hosts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', p.id, 'display_name', p.display_name, 'username', p.username, 'avatar_url', p.avatar_url,
        'user_number', p.user_number, 'verification_status', h.verification_status, 'status', h.status,
        'live', r.status = 'live',
        'earnings_lifetime', case when v_is_admin then e.lifetime end
      ) order by (r.status = 'live') desc, p.display_name)
      from public.hosts h
      join public.profiles p on p.id = h.user_id and p.deleted_at is null
      left join public.rooms r on r.host_id = h.user_id
      left join public.creator_earnings e on e.host_id = h.user_id
      where h.agency_id = v_agency.id), '[]'::jsonb),
    'applications', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select a.created_at, jsonb_build_object(
          'id', a.id, 'full_name', a.full_name, 'user_number', p.user_number, 'status', a.status,
          'reasons', a.reasons, 'created_at', a.created_at,
          'phone', case when v_is_admin then a.phone end
        ) as j
        from public.host_applications a join public.profiles p on p.id = a.user_id
        where a.agency_id = v_agency.id
        order by a.created_at desc limit 50) x), '[]'::jsonb)
  );
end $$;

revoke execute on function private.new_agency_code() from public;
revoke execute on function public.create_agency_by_user_number(text, int) from public, anon;
revoke execute on function public.regenerate_agency_code(uuid) from public, anon;
revoke execute on function public.agency_portal(uuid) from public, anon;
grant execute on function public.create_agency_by_user_number(text, int) to authenticated;
grant execute on function public.regenerate_agency_code(uuid) to authenticated;
grant execute on function public.agency_portal(uuid) to authenticated;
