-- Host identity verification (Didit): trust boundary, gating and idempotency.

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

insert into public.profiles (id, username) values ('hana', 'hana'), ('ivan', 'ivan');

select set_config('request.jwt.claims', '{"sub":"hana"}', false);
set role authenticated;
select public.become_host();
select tests.ok((select verification_status from public.hosts where user_id = 'hana') = 'unverified', 'new host is unverified');
-- Unverified hosts can't go live or withdraw.
select tests.fails($$select public.go_live('x', 'chat')$$, '%verification_required%', 'unverified host goes live');
select tests.fails($$select public.request_withdrawal(1000, '{"type":"bank"}')$$, '%verification_required%', 'unverified host withdraws');
-- Clients can't mark themselves verified.
select tests.fails($$update public.hosts set verification_status = 'approved' where user_id = 'hana'$$, '%permission denied%', 'client sets own status');
select tests.fails($$select public.internal_start_host_verification('hana', 'ses_x')$$, '%permission denied%', 'client starts session record');
select tests.fails($$select public.internal_apply_host_verification('ses_x', 'Approved', '{}')$$, '%permission denied%', 'client applies Approved');
select tests.fails($$insert into public.host_verifications (user_id, session_id, status) values ('hana', 'ses_fake', 'approved')$$, '%permission denied%', 'client inserts verification');
select tests.fails($$update public.profiles set verified_at = now() where id = 'hana'$$, '%permission denied%', 'client marks own profile verified');
reset role;
select tests.ok((select verified_at is null from public.profiles where id = 'hana'), 'new host is not a verified user');

-- Non-hosts can't start verification.
set role service_role;
select tests.fails($$select public.internal_start_host_verification('ivan', 'ses_ivan')$$, '%not_a_host%', 'non-host verification');

-- Session 1: in review, then declined.
select public.internal_start_host_verification('hana', 'ses_1');
select tests.ok((select verification_status from public.hosts where user_id = 'hana') = 'pending', 'pending after start');
select public.internal_apply_host_verification('ses_1', 'In Review', '{"document_type":"Identity Card"}');
select tests.ok((select verification_status from public.hosts where user_id = 'hana') = 'in_review', 'in review');
select public.internal_apply_host_verification('ses_1', 'Declined', '{}');
select tests.ok((select verification_status from public.hosts where user_id = 'hana') = 'declined', 'declined');
select tests.ok((select verified_at is null from public.profiles where id = 'hana'), 'declined: no verified badge');

-- Session 2 (retry): approved; a replayed webhook changes nothing.
select public.internal_start_host_verification('hana', 'ses_2');
select public.internal_apply_host_verification('ses_2', 'Approved', '{}');
select tests.ok(not (public.internal_apply_host_verification('ses_2', 'Approved', '{}') ->> 'changed')::boolean, 'replay is a no-op');
select tests.ok((select verification_status = 'approved' and verified_at is not null from public.hosts where user_id = 'hana'), 'approved');
select tests.ok((select count(*) from public.notifications where user_id = 'hana' and type = 'verification' and title like 'You%verified%') = 1, 'one approval notification');
select tests.ok((select verified_at is not null from public.profiles where id = 'hana'), 'approval marks the user verified (host badge)');
-- A late webhook for the old session doesn't override the newer approval.
select tests.ok(not (public.internal_apply_host_verification('ses_1', 'Approved', '{}') ->> 'applied_to_host')::boolean, 'stale session ignored');
select tests.fails($$select public.internal_start_host_verification('hana', 'ses_3')$$, '%already_verified%', 'no new session once approved');
select tests.fails($$select public.internal_apply_host_verification('ses_unknown', 'Approved', '{}')$$, '%unknown_session%', 'unknown session');
reset role;

-- Verified hosts can go live; users only see their own verification records.
update public.rooms set cover_url = 'https://cdn.test/covers/hana/c.jpg' where host_id = 'hana';
select set_config('request.jwt.claims', '{"sub":"hana"}', false);
set role authenticated;
select public.go_live('Verified!', 'chat');
select tests.ok((select count(*) from public.host_verifications) = 2, 'own records visible');
reset role;
select set_config('request.jwt.claims', '{"sub":"ivan"}', false);
set role authenticated;
select tests.ok((select count(*) from public.host_verifications) = 0, 'others records hidden');
reset role;

-- Owners can turn the requirement off.
update public.platform_settings set value = '{"required_to_go_live": false, "required_to_withdraw": true}' where key = 'host_verification';
select set_config('request.jwt.claims', '{"sub":"ivan"}', false);
set role authenticated;
select public.become_host();
reset role;
update public.rooms set cover_url = 'https://cdn.test/covers/ivan/c.jpg' where host_id = 'ivan';
select set_config('request.jwt.claims', '{"sub":"ivan"}', false);
set role authenticated;
select public.go_live('No KYC needed', 'chat');
reset role;
update public.platform_settings set value = '{"required_to_go_live": true, "required_to_withdraw": true}' where key = 'host_verification';

drop schema tests cascade;
