-- In-app host applications (Didit ID + face match): trust boundary, decisions,
-- agency codes, admin review and privacy.

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'TEST FAILED: %', p_msg; end if;
end $$;
create function tests.fails(p_sql text, p_like text, p_msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED (no error): %', p_msg;
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  if sqlerrm not like p_like then raise exception 'TEST FAILED (wrong error "%"): %', sqlerrm, p_msg; end if;
end $$;
grant execute on all functions in schema tests to authenticated, service_role;

insert into public.profiles (id, username) values ('ha_ok', 'ha_ok'), ('ha_review', 'ha_review'), ('ha_bad', 'ha_bad'), ('ha_kid', 'ha_kid'), ('ha_admin', 'ha_admin');
update public.profiles set role = 'OWNER_ADMIN' where id = 'ha_admin';
insert into public.agencies (name, code) values ('Lahore Stars', '4821');

-- Clients can't submit results or write applications directly.
select set_config('request.jwt.claims', '{"sub":"ha_ok"}', false);
set role authenticated;
select tests.fails($$select public.internal_submit_host_application('ha_ok', 'Ayesha Khan', '+923001234567', '4567', '4821', 'Approved', 'Approved', 90, true, true, 25, 'r1', 'r2')$$, '%permission denied%', 'client submits result');
select tests.fails($$insert into public.host_applications (user_id, full_name, phone, cnic_last4, status) values ('ha_ok', 'Ayesha Khan', '+923001234567', '4567', 'approved')$$, '%permission denied%', 'client inserts application');
reset role;

set role service_role;
-- All checks pass → approved, host created, agency linked.
select tests.ok((public.internal_submit_host_application('ha_ok', 'Ayesha Khan', '+923001234567', '4567', ' 4821 ', 'Approved', 'Approved', 90, true, true, 25, 'r1', 'r2') ->> 'status') = 'approved', 'clean application approved');
-- Mismatched CNIC number → a person reviews it.
select tests.ok((public.internal_submit_host_application('ha_review', 'Bilal Ahmed', '+923111234567', '1111', '4821', 'Approved', 'Approved', 88, false, true, 30, 'r3', 'r4') ->> 'status') = 'in_review', 'cnic mismatch goes to review');
-- Face doesn't match → declined.
select tests.ok((public.internal_submit_host_application('ha_bad', 'Sara Ali', '+923211234567', '2222', '4821', 'Approved', 'Declined', 12, true, true, 22, 'r5', 'r6') ->> 'status') = 'declined', 'face mismatch declined');
-- Under 18 → declined.
select tests.ok((public.internal_submit_host_application('ha_kid', 'Young One', '+923331234567', '3333', '4821', 'Approved', 'Approved', 90, true, true, 16, 'r7', 'r8') ->> 'status') = 'declined', 'minor declined');
select tests.fails($$select public.internal_submit_host_application('ha_bad', 'Sara Ali', '+923211234567', '2222', '9999', 'Approved', 'Approved', 90, true, true, 22, 'r9', 'r10')$$, '%invalid_agency_code%', 'unknown agency code');
select tests.fails($$select public.internal_submit_host_application('ha_ok', 'Ayesha Khan', '+923001234567', '4567', '4821', 'Approved', 'Approved', 90, true, true, 25, 'r11', 'r12')$$, '%already_verified%', 'no re-application once approved');
select tests.fails($$select public.internal_submit_host_application('ha_bad', 'Sara Ali', '+923211234567', '2222', null, 'Approved', 'Approved', 90, true, true, 22, 'r15', 'r16')$$, '%agency_code_required%', 'agency code required');
select tests.fails($$select public.internal_submit_host_application('ha_bad', 'Sara Ali', '0321', '2222', '4821', 'Approved', 'Approved', 90, true, true, 22, 'r13', 'r14')$$, '%host_applications_phone_check%', 'phone format enforced');
reset role;

select tests.ok((select verification_status = 'approved' and agency_id = (select id from public.agencies where code = '4821') from public.hosts where user_id = 'ha_ok'), 'approved host verified and linked to agency');
select tests.ok((select verified_at is not null from public.profiles where id = 'ha_ok'), 'approved user gets Host badge');
select tests.ok((select verification_status from public.hosts where user_id = 'ha_review') = 'in_review', 'review host pending');
select tests.ok((select verification_status from public.hosts where user_id = 'ha_bad') = 'declined', 'declined host');

-- Users see only their own applications; they can't review.
select set_config('request.jwt.claims', '{"sub":"ha_review"}', false);
set role authenticated;
select tests.ok((select count(*) from public.host_applications) = 1, 'own application only');
select tests.fails($$select public.review_host_application((select id from public.host_applications limit 1), true)$$, '%forbidden%', 'user reviews own application');
reset role;

-- Admin approves the one in review.
select set_config('request.jwt.claims', '{"sub":"ha_admin"}', false);
set role authenticated;
select tests.ok((select count(*) from public.host_applications where status = 'in_review') = 1, 'admin sees review queue');
select public.review_host_application((select id from public.host_applications where user_id = 'ha_review'), true, 'Card photo checked by hand');
select tests.fails($$select public.review_host_application((select id from public.host_applications where user_id = 'ha_review'), false)$$, '%already_reviewed%', 'no double review');
reset role;
select tests.ok((select verification_status from public.hosts where user_id = 'ha_review') = 'approved', 'admin approval applied');
select tests.ok((select verified_at is not null from public.profiles where id = 'ha_review'), 'admin approval gives Host badge');

-- Account deletion removes applications.
set role service_role;
select public.internal_delete_account('ha_bad');
reset role;
select tests.ok((select count(*) from public.host_applications where user_id = 'ha_bad') = 0, 'deletion removes applications');

drop schema tests cascade;
