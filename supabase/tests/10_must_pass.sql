-- Must-pass security & financial tests (architecture §06) plus economy,
-- moderation and AI trust-boundary coverage. Any failure aborts the run.

-- Test helpers ------------------------------------------------------------------
create schema tests;
grant usage on schema tests to authenticated, service_role;

create function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'TEST FAILED: %', p_msg; end if;
end $$;

-- Runs SQL as the current role and requires it to fail with a matching message.
create function tests.fails(p_sql text, p_like text, p_msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED (no error): %', p_msg;
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  if sqlerrm not like p_like then
    raise exception 'TEST FAILED (wrong error "%"): %', sqlerrm, p_msg;
  end if;
end $$;
grant execute on all functions in schema tests to authenticated, service_role;

-- Looks up ids bypassing RLS, so tests can target rows the caller can't see.
create function tests.agency(p_name text) returns uuid language sql security definer
as $$ select id from public.agencies where name = p_name $$;
grant execute on function tests.agency(text) to authenticated, service_role;

create function tests.balance(p_user text) returns bigint language sql security definer
as $$ select coin_balance from public.wallets where user_id = p_user $$;
grant execute on function tests.balance(text) to authenticated, service_role;

-- Fixtures (as postgres) -----------------------------------------------------------
insert into public.profiles (id, username, display_name, country) values
  ('alice', 'alice', 'Alice', 'PK'), ('bob', 'bob', 'Bob', 'PK'), ('carol', 'carol', 'Carol', 'IN'),
  ('dave', 'dave', 'Dave', 'PK'), ('erin', 'erin', 'Erin', 'IN'), ('agent_a', 'agent_a', 'Agent A', 'PK'),
  ('frank', 'frank', 'Frank', 'BD'), ('owner', 'owner', 'Owner', 'PK'), ('root', 'root', 'Root', 'PK'),
  ('m1', 'mod_one', 'M1', 'PK'), ('m2', 'mod_two', 'M2', 'PK'), ('m3', 'mod_three', 'M3', 'PK'),
  ('m4', 'mod_four', 'M4', 'PK'), ('m5', 'mod_five', 'M5', 'PK');
update public.profiles set role = 'OWNER_ADMIN' where id = 'owner';
update public.profiles set role = 'SUPER_ADMIN' where id = 'root';

-- Hosts become hosts through the RPC.
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
select public.become_host();
reset role;
select set_config('request.jwt.claims', '{"sub":"carol"}', false);
set role authenticated;
select public.become_host();
reset role;

-- Identity verification is covered in 20_host_verification.sql; approve these hosts.
update public.hosts set verification_status = 'approved', verified_at = now() where user_id in ('bob', 'carol');

-- Owner creates two agencies; dave runs A (with an agent), erin runs B.
select set_config('request.jwt.claims', '{"sub":"owner"}', false);
set role authenticated;
select public.create_agency('Agency A', 'dave');
select public.create_agency('Agency B', 'erin');
select public.add_agency_member((select id from public.agencies where name = 'Agency A'), 'agent_a', 'agent');
select public.assign_host_to_agency('bob', (select id from public.agencies where name = 'Agency A'));
select public.assign_host_to_agency('carol', (select id from public.agencies where name = 'Agency B'));
reset role;
update public.creator_earnings set balance = 5000, lifetime = 5000 where host_id in ('bob', 'carol');

---------------------------------------------------------------------------------------
-- 1. A user cannot self-promote to admin
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
select tests.fails($$update public.profiles set role = 'SUPER_ADMIN' where id = 'alice'$$, '%permission denied%', 'direct role update');
select tests.fails($$update public.profiles set status = 'active', status_until = null where id = 'alice'$$, '%permission denied%', 'direct status update');
select tests.fails($$select public.set_user_role('alice', 'SUPER_ADMIN')$$, '%forbidden%', 'set_user_role as USER');
select tests.fails($$insert into public.agency_members values ((select id from public.agencies limit 1), 'alice', 'admin')$$, '%permission denied%', 'self-join agency');
select tests.fails($$select public.create_agency('Mine', 'alice')$$, '%forbidden%', 'create agency as USER');
select tests.fails($$select public.set_platform_setting('gift_split', '{"host_pct":100,"stream_pct":0,"owner_pct":0}')$$, '%forbidden%', 'change settings');
-- Allowed: editing own public fields.
update public.profiles set display_name = 'Alice K' where id = 'alice';
update public.profiles set display_name = 'hacked' where id = 'bob'; -- RLS: silently affects 0 rows
reset role;
select tests.ok((select role from public.profiles where id = 'alice') = 'USER', 'alice still USER');
select tests.ok((select display_name from public.profiles where id = 'bob') = 'Bob', 'cannot edit other profile');

-- 1b. Every profile gets a unique, permanent 8-digit user ID.
select tests.ok((select bool_and(user_number between 10000000 and 99999999) from public.profiles), 'user IDs are 8 digits');
select tests.ok((select count(distinct user_number) = count(*) from public.profiles), 'user IDs are unique');
create temp table alice_number as select user_number from public.profiles where id = 'alice';
grant select on alice_number to authenticated;
set role authenticated;
select tests.fails($$update public.profiles set user_number = 12345678 where id = 'alice'$$, '%permission denied%', 'client cannot change own user ID');
select tests.ok((select user_number from public.profiles where id = 'bob') is not null, 'user ID is readable');
reset role;
-- Even privileged writers (webhooks, admins) cannot choose or change it.
insert into public.profiles (id, user_number) values ('newbie', 12345678);
select tests.ok((select user_number from public.profiles where id = 'newbie') <> 12345678, 'insert ignores supplied user ID');
update public.profiles set user_number = 12345678 where id = 'alice';
select tests.ok((select user_number from public.profiles where id = 'alice') = (select user_number from alice_number), 'user ID never changes');
delete from public.profiles where id = 'newbie';
-- Host ID is the same number as the user ID, and can't be changed.
select tests.ok((select bool_and(h.host_code = p.user_number::text) from public.hosts h join public.profiles p on p.id = h.user_id), 'host ID equals user ID');
update public.hosts set host_code = '12345678' where user_id = 'bob';
select tests.ok((select host_code = (select user_number::text from public.profiles where id = 'bob') from public.hosts where user_id = 'bob'), 'host ID never changes');

-- OWNER_ADMIN cannot grant roles either; only SUPER_ADMIN, and never to themselves.
select set_config('request.jwt.claims', '{"sub":"owner"}', false);
set role authenticated;
select tests.fails($$select public.set_user_role('alice', 'OWNER_ADMIN')$$, '%forbidden%', 'owner cannot set roles');
reset role;
select set_config('request.jwt.claims', '{"sub":"root"}', false);
set role authenticated;
select tests.fails($$select public.set_user_role('root', 'USER')$$, '%cannot_change_own_role%', 'super admin own role');
reset role;

---------------------------------------------------------------------------------------
-- 2. An agency cannot reach another agency's data
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"dave"}', false);
set role authenticated;
select tests.ok((select count(*) from public.creator_earnings where host_id = 'bob') = 1, 'agency A admin sees own host earnings');
select tests.ok((select count(*) from public.creator_earnings where host_id = 'carol') = 0, 'agency A admin cannot see agency B earnings');
select tests.ok((select count(*) from public.agencies) = 1, 'agency A admin sees only own agency');
select tests.ok((select count(*) from public.agency_members where agency_id = tests.agency('Agency B')) = 0, 'no B members visible');
select tests.fails($$select public.assign_host_to_agency('carol', tests.agency('Agency A'))$$, '%not_found_or_already_assigned%', 'poach host from B');
select tests.fails($$select public.add_agency_member(tests.agency('Agency B'), 'alice', 'agent')$$, '%forbidden%', 'add member to other agency');
select tests.fails($$select public.add_agency_member(null, 'alice', 'agent')$$, '%forbidden%', 'null agency');
select tests.fails($$select public.assign_host_to_agency('alice', tests.agency('Agency B'))$$, '%forbidden%', 'recruit into other agency');
select tests.fails($$update public.creator_earnings set balance = 0 where host_id = 'carol'$$, '%permission denied%', 'write other agency earnings');
reset role;
select tests.ok((select balance from public.creator_earnings where host_id = 'carol') = 5000, 'B earnings untouched');

-- Agents (not admins) cannot see financials, even for their own agency.
select set_config('request.jwt.claims', '{"sub":"agent_a"}', false);
set role authenticated;
select tests.ok((select count(*) from public.creator_earnings) = 0, 'agent sees no earnings');
select tests.ok((select count(*) from public.agencies) = 1, 'agent sees own agency record');
reset role;

---------------------------------------------------------------------------------------
-- 3. A client cannot fabricate a successful payment
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
select public.ensure_profile();
select tests.fails($$insert into public.payments (user_id, coins, amount_minor, currency, status) values ('alice', 999999, 1, 'pkr', 'paid')$$, '%permission denied%', 'insert paid payment');
select tests.fails($$update public.wallets set coin_balance = 999999 where user_id = 'alice'$$, '%permission denied%', 'edit wallet');
select tests.fails($$insert into public.coin_transactions (user_id, delta, balance_after, kind, idempotency_key) values ('alice', 999999, 999999, 'purchase', 'x')$$, '%permission denied%', 'insert ledger row');
select tests.fails($$select public.internal_create_payment('alice', 1)$$, '%permission denied%', 'create payment rpc');
select tests.fails($$select public.internal_credit_payment('cs_fake', 'pi_fake', 10000, 'pkr')$$, '%permission denied%', 'credit rpc');
select tests.ok(tests.balance('alice') = 0, 'alice balance still 0');
reset role;

---------------------------------------------------------------------------------------
-- 4. A duplicated webhook cannot duplicate coins
---------------------------------------------------------------------------------------
set role service_role;
select public.internal_attach_payment_ref((public.internal_create_payment('alice', 2)).id, 'cs_test_1');
select tests.ok((public.internal_credit_payment('cs_test_1', 'pi_1', 50000, 'pkr') ->> 'credited')::boolean, 'first webhook credits');
select tests.ok(not (public.internal_credit_payment('cs_test_1', 'pi_1', 50000, 'pkr') ->> 'credited')::boolean, 'replayed webhook ignored');
select tests.ok(tests.balance('alice') = 350, 'credited exactly once');
select tests.ok((select count(*) from public.coin_transactions where user_id = 'alice' and kind = 'purchase') = 1, 'one purchase ledger row');
-- Money path allocations sum to the amount paid.
select tests.ok((select sum(amount) from public.platform_ledger where ref_id = (select id::text from public.payments where provider_ref = 'cs_test_1')) = 50000, 'allocations sum to amount');
-- Tampered amount is rejected.
select public.internal_attach_payment_ref((public.internal_create_payment('alice', 1)).id, 'cs_test_bad');
select tests.ok(not (public.internal_credit_payment('cs_test_bad', 'pi_bad', 1, 'pkr') ->> 'credited')::boolean, 'amount mismatch rejected');
select tests.ok(tests.balance('alice') = 350, 'mismatch credits nothing');
reset role;

---------------------------------------------------------------------------------------
-- 5. A duplicated gift request cannot double-charge
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
select public.go_live('Bob live', 'music');
reset role;

select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
-- Heart (id 3) = 10 coins x 2
select public.send_gift((select id from public.rooms where host_id = 'bob'), 3, 2, 'gift-key-0001');
select public.send_gift((select id from public.rooms where host_id = 'bob'), 3, 2, 'gift-key-0001');
select tests.ok(tests.balance('alice') = 330, 'duplicate gift charged once');
select tests.ok((select count(*) from public.gifts where sender_id = 'alice') = 1, 'one gift row');
select tests.fails($$select public.send_gift((select id from public.rooms where host_id = 'bob'), 8, 1, 'gift-key-0002')$$, '%insufficient_coins%', 'cannot overspend');
select tests.fails($$select public.send_gift((select id from public.rooms where host_id = 'carol'), 3, 1, 'gift-key-0003')$$, '%room_not_live%', 'gift to offline room');
select tests.fails($$select public.send_gift((select id from public.rooms where host_id = 'bob'), 3, 0, 'gift-key-0004')$$, '%invalid_quantity%', 'zero quantity');
select tests.fails($$select public.send_gift((select id from public.rooms where host_id = 'bob'), 3, -5, 'gift-key-0005')$$, '%invalid_quantity%', 'negative quantity');
reset role;
select tests.ok((select host_share from public.gifts where idempotency_key = 'gift-key-0001') = 18, 'host gets 90%');
select tests.ok((select owner_share + stream_share from public.gifts where idempotency_key = 'gift-key-0001') = 2, 'owner+stream 10%');
select tests.ok((select balance from public.creator_earnings where host_id = 'bob') = 5018, 'host earnings credited');

-- Hosts cannot gift themselves.
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
select tests.fails($$select public.send_gift((select id from public.rooms where host_id = 'bob'), 1, 1, 'gift-self-01')$$, '%cannot_gift_self%', 'host gifts own room');
reset role;

---------------------------------------------------------------------------------------
-- Room admins: max 5, host-only management, active only while live
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
select public.set_room_admin('alice', true);
select public.set_room_admin('m1', true); select public.set_room_admin('m2', true);
select public.set_room_admin('m3', true); select public.set_room_admin('m4', true);
select tests.fails($$select public.set_room_admin('m5', true)$$, '%room_admin_limit%', 'sixth room admin');
reset role;

select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
select public.room_moderate((select id from public.rooms where host_id = 'bob'), 'frank', 'mute', 10);
select tests.fails($$select public.room_moderate((select id from public.rooms where host_id = 'bob'), 'bob', 'kick')$$, '%cannot_moderate_host%', 'admin vs host');
select tests.fails($$select public.room_moderate((select id from public.rooms where host_id = 'bob'), 'm1', 'kick')$$, '%cannot_moderate_admin%', 'admin vs admin');
select tests.fails($$select public.set_room_admin('frank', true)$$, '%not_a_host%', 'non-host adds admin');
reset role;

-- Chat: muted user blocked; anti-spam; word filter.
select set_config('request.jwt.claims', '{"sub":"frank"}', false);
set role authenticated;
select tests.fails($$select public.send_chat_message((select id from public.rooms where host_id = 'bob'), 'hello')$$, '%muted_in_room%', 'muted chat');
reset role;
select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
select tests.fails($$insert into public.messages (room_id, sender_id, body) values ((select id from public.rooms where host_id = 'bob'), 'alice', 'x')$$, '%permission denied%', 'direct chat insert');
select tests.ok((public.send_chat_message((select id from public.rooms where host_id = 'bob'), 'you idiot')).body = 'you *****', 'word masked');
select tests.fails($$select public.send_chat_message((select id from public.rooms where host_id = 'bob'), 'visit spam-link.example now')$$, '%message_blocked%', 'blocked term');
select public.send_chat_message((select id from public.rooms where host_id = 'bob'), 'm2');
select public.send_chat_message((select id from public.rooms where host_id = 'bob'), 'm3');
select public.send_chat_message((select id from public.rooms where host_id = 'bob'), 'm4');
select public.send_chat_message((select id from public.rooms where host_id = 'bob'), 'm5');
select tests.fails($$select public.send_chat_message((select id from public.rooms where host_id = 'bob'), 'm6')$$, '%slow_down%', 'rate limit');
reset role;
select tests.ok((select count(*) from public.ai_jobs where kind = 'moderate_message') = 5, 'chat enqueued for AI moderation');

-- Room admins lose powers once the host is offline.
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
select public.end_live();
reset role;
select tests.ok((select count(*) from public.ai_jobs where kind = 'creator_assist') = 1, 'stream end enqueues creator assist');
select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
select tests.fails($$select public.room_moderate((select id from public.rooms where host_id = 'bob'), 'frank', 'unmute')$$, '%forbidden%', 'room admin inactive while offline');
reset role;

---------------------------------------------------------------------------------------
-- Chargebacks: freeze during dispute, lost -> reverse + flag
---------------------------------------------------------------------------------------
set role service_role;
select public.internal_dispute_payment('pi_1', 'opened');
reset role;
select tests.ok((select frozen from public.wallets where user_id = 'alice'), 'wallet frozen during dispute');
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
select public.go_live('Again', 'chat');
reset role;
select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
select tests.fails($$select public.send_gift((select id from public.rooms where host_id = 'bob'), 1, 1, 'gift-frozen-1')$$, '%wallet_frozen%', 'frozen wallet cannot gift');
reset role;
set role service_role;
select public.internal_dispute_payment('pi_1', 'lost');
select tests.ok(not (public.internal_dispute_payment('pi_1', 'lost') ->> 'changed')::boolean, 'dispute lost is idempotent');
reset role;
-- 350 bought, 20 spent: 330 reversed, 20 shortfall absorbed by platform + account flagged.
select tests.ok(tests.balance('alice') = 0, 'coins reversed');
select tests.ok(exists (select 1 from public.moderation_actions where target_user_id = 'alice' and action = 'account_review'), 'account flagged');
select tests.ok(exists (select 1 from public.platform_ledger where bucket = 'chargeback_loss' and amount = -50000), 'platform debited');

---------------------------------------------------------------------------------------
-- Withdrawals: disabled until the coin->PKR rate is set; holds and releases
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
select tests.fails($$select public.request_withdrawal(1000, '{"type":"bank"}')$$, '%withdrawals_not_configured%', 'rate not set');
reset role;
select set_config('request.jwt.claims', '{"sub":"owner"}', false);
set role authenticated;
select public.set_platform_setting('withdrawal', '{"pkr_per_coin": 0.5, "min_coins": 1000}');
reset role;
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
select tests.fails($$select public.request_withdrawal(999999, '{"type":"bank"}')$$, '%insufficient_earnings%', 'overdraw earnings');
select tests.fails($$select public.request_withdrawal(10, '{"type":"bank"}')$$, '%below_minimum%', 'below minimum');
select public.request_withdrawal(2000, '{"type":"easypaisa","account":"0300"}');
select tests.ok((select balance = 3018 and held = 2000 from public.creator_earnings where host_id = 'bob'), 'coins held');
select tests.ok((select amount_minor from public.withdrawals where host_id = 'bob') = 100000, '2000 coins * 0.5 PKR = 1000.00 PKR');
select tests.fails($$select public.review_withdrawal((select id from public.withdrawals where host_id = 'bob'), true)$$, '%forbidden%', 'host approves own withdrawal');
reset role;
select set_config('request.jwt.claims', '{"sub":"owner"}', false);
set role authenticated;
select public.review_withdrawal((select id from public.withdrawals where host_id = 'bob'), false, 'Verify account');
reset role;
select tests.ok((select balance = 5018 and held = 0 from public.creator_earnings where host_id = 'bob'), 'rejected withdrawal released');

---------------------------------------------------------------------------------------
-- AI trust boundary: proposals need owner approval
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
select tests.fails($$select public.internal_ai_moderation('frank', 'warning', 'x')$$, '%permission denied%', 'client calls AI internals');
select tests.ok((select count(*) from public.ai_jobs) = 0, 'ai_jobs hidden from users');
reset role;
select set_config('request.jwt.claims', '{}', false);
set role service_role;
select public.internal_ai_moderation('frank', 'warning', 'Spam in chat');
select tests.fails($$select public.internal_ai_moderation('frank', 'temp_ban', 'x')$$, '%ai_action_requires_approval%', 'AI cannot ban directly');
insert into public.ai_actions (agent, action_type, target_user_id, rationale, params)
  values ('fraud', 'temp_ban', 'frank', 'Self-gifting ring', '{"hours": 24}');
select tests.fails($$select public.internal_execute_ai_action((select max(id) from public.ai_actions))$$, '%not_approved%', 'unapproved AI action');
reset role;
select set_config('request.jwt.claims', '{"sub":"owner"}', false);
set role authenticated;
select public.review_ai_action((select max(id) from public.ai_actions), true);
reset role;
set role service_role;
select public.internal_execute_ai_action((select max(id) from public.ai_actions));
reset role;
select tests.ok(public.user_status('frank') = 'banned', 'approved AI ban executed');
select tests.ok((select count(*) from public.audit_logs where action = 'moderation_temp_ban' and actor_kind = 'ai') = 1, 'AI action audited');

-- Rankings callable and correct.
select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
select tests.ok((select subject_id from public.get_rankings('creator', 'week') where rank = 1) = 'bob', 'creator ranking');
reset role;

-- Agency codes are 4 digits; the portal shows only the caller's agency; money only to admins.
select tests.ok((select bool_and(code ~ '^[1-9][0-9]{3}$') from public.agencies), 'agency codes are 4 digits');
select tests.ok((select count(distinct code) = count(*) from public.agencies), 'agency codes unique');
select set_config('request.jwt.claims', '{"sub":"dave"}', false);
set role authenticated;
select tests.ok((public.agency_portal() -> 'agency' ->> 'name') = 'Agency A', 'agency admin opens own portal');
select tests.ok((public.agency_portal() -> 'stats' ->> 'earnings_lifetime')::bigint = (select lifetime from public.creator_earnings where host_id = 'bob'), 'agency admin sees host earnings');
select tests.ok(jsonb_array_length(public.agency_portal() -> 'hosts') = 1, 'portal lists only own hosts');
select tests.fails($$select public.agency_portal(tests.agency('Agency B'))$$, '%not_agency_member%', 'agency admin opens another agency portal');
select tests.fails($$select public.create_agency_by_user_number('Mine', 12345678)$$, '%forbidden%', 'agency admin creates agency');
reset role;
select set_config('request.jwt.claims', '{"sub":"agent_a"}', false);
set role authenticated;
select tests.ok(public.agency_portal() -> 'stats' -> 'earnings_lifetime' = 'null'::jsonb, 'agent does not see money');
reset role;
select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
select tests.fails($$select public.agency_portal()$$, '%not_agency_member%', 'non-member opens portal');
reset role;
select set_config('request.jwt.claims', '{"sub":"owner"}', false);
set role authenticated;
select tests.ok((public.create_agency_by_user_number('Karachi Crew', (select user_number from public.profiles where id = 'frank')::int)).code ~ '^[1-9][0-9]{3}$', 'owner creates agency by user ID');
select tests.fails($$select public.create_agency_by_user_number('Again', (select user_number from public.profiles where id = 'frank')::int)$$, '%already_in_agency%', 'manager already in an agency');
select tests.fails($$select public.create_agency_by_user_number('Ghost', 1)$$, '%user_not_found%', 'unknown user ID');
reset role;
select tests.ok((select role from public.profiles where id = 'frank') = 'AGENCY_ADMIN', 'new agency manager becomes agency admin');
-- Agency codes are permanent (no one can change them) and each owner has one agency.
select tests.fails($$update public.agencies set code = '1234' where name = 'Agency A'$$, '%agency_code_permanent%', 'agency code cannot change');
select tests.ok(not exists (select 1 from pg_proc where proname = 'regenerate_agency_code'), 'no code rotation RPC');
select set_config('request.jwt.claims', '{"sub":"owner"}', false);
set role authenticated;
select tests.fails($$select public.create_agency('Second agency', 'dave')$$, '%agencies_one_per_owner%', 'one agency per owner');
reset role;

drop schema tests cascade;
