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
-- Sign-up country is recorded server-side at sign-up (see 60_signup_country.sql); it decides the region.
update public.profiles set signup_country = country;
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
-- Every user has their own ID: no duplicates, no taking someone else's.
select tests.ok((select count(*) = count(distinct user_number) from public.profiles), 'user IDs unique');
select tests.ok((select count(*) = count(distinct host_code) from public.hosts), 'host IDs unique');
-- Someone else's ID can't be copied onto an account, even by a direct write.
update public.profiles set user_number = (select user_number from public.profiles where id = 'bob') where id = 'alice';
select tests.ok((select a.user_number <> b.user_number from public.profiles a, public.profiles b where a.id = 'alice' and b.id = 'bob'), 'cannot take another user ID');
-- A new account asking for an existing ID gets its own fresh one.
insert into public.profiles (id, username, user_number) values ('dup_user', 'dup_user', (select user_number from public.profiles where id = 'bob'));
select tests.ok((select a.user_number <> b.user_number from public.profiles a, public.profiles b where a.id = 'dup_user' and b.id = 'bob'), 'new account gets its own ID');
-- Even with triggers bypassed, the database refuses a duplicate ID.
set session_replication_role = replica;
select tests.fails($$insert into public.profiles (id, username, user_number) values ('dup_user2', 'dup_user2', (select user_number from public.profiles where id = 'bob'))$$, '%profiles_user_number_key%', 'duplicate user ID rejected');
select tests.fails($$insert into public.hosts (user_id, host_code) values ('dup_user', (select host_code from public.hosts where user_id = 'bob'))$$, '%duplicate key%', 'duplicate host ID rejected');
set session_replication_role = origin;
delete from public.profiles where id = 'dup_user';


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
select tests.fails($$select public.assign_host_to_agency('carol', tests.agency('Agency A'))$$, '%forbidden%', 'agency staff cannot assign hosts (poach from B)');
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
select tests.fails($$select public.internal_fail_payment('cs_fake')$$, '%permission denied%', 'fail payment rpc');
select tests.fails($$select public.internal_expire_unstarted_payments('alice')$$, '%permission denied%', 'expire unstarted payments rpc');
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
-- An expired / failed checkout closes only a pending payment; a credited one stays paid with its coins.
select tests.ok(not (public.internal_fail_payment('cs_test_1') ->> 'changed')::boolean, 'expired event ignores paid payment');
select tests.ok((select status from public.payments where provider_ref = 'cs_test_1') = 'paid' and tests.balance('alice') = 350, 'paid payment and coins untouched');
select public.internal_attach_payment_ref((public.internal_create_payment('alice', 1)).id, 'cs_test_expired');
select tests.ok((public.internal_fail_payment('cs_test_expired') ->> 'changed')::boolean, 'expired checkout closes pending payment');
select tests.ok((select status from public.payments where provider_ref = 'cs_test_expired') = 'failed', 'pending payment marked failed');
select tests.ok(not (public.internal_credit_payment('cs_test_expired', 'pi_x', 10000, 'pkr') ->> 'credited')::boolean, 'failed payment never credits');
-- A retry (dropped connection, double tap) reuses the open checkout instead of starting a second one.
create temp table retry_ids as select (public.internal_create_payment('alice', 3)).id as first_id, (public.internal_create_payment('alice', 3)).id as second_id;
select tests.ok((select first_id = second_id from retry_ids), 'retry returns the same pending payment');
select tests.ok((select count(*) from public.payments where user_id = 'alice' and package_id = 3 and status = 'pending') = 1, 'only one pending payment per package');
select tests.ok((public.internal_create_payment('alice', 4)).id <> (select first_id from retry_ids), 'another package gets its own payment');
-- A paid package is never reused: buying it again is a new purchase.
select tests.ok((public.internal_create_payment('alice', 2)).id <> (select id from public.payments where provider_ref = 'cs_test_1'), 'paid payment not reused');
-- An old pending one (session expired) is not reused either.
update public.payments set created_at = now() - interval '31 minutes' where id = (select first_id from retry_ids);
select tests.ok((public.internal_create_payment('alice', 3)).id <> (select first_id from retry_ids), 'stale pending payment not reused');
-- Reconciliation: a payment whose checkout page was never created is closed after 2 hours;
-- one with a Stripe session, or a recent one, is left for Stripe to decide.
update public.payments set status = 'failed' where user_id = 'alice' and status = 'pending';
create temp table unstarted as select (public.internal_create_payment('alice', 3)).id as old_id;
update public.payments set created_at = now() - interval '3 hours' where id = (select old_id from unstarted);
select public.internal_create_payment('alice', 4);
select public.internal_attach_payment_ref((public.internal_create_payment('alice', 1)).id, 'cs_test_open');
update public.payments set created_at = now() - interval '3 hours' where provider_ref = 'cs_test_open';
select tests.ok(public.internal_expire_unstarted_payments('alice') = 1, 'stale unstarted payment closed');
select tests.ok((select status from public.payments where id = (select old_id from unstarted)) = 'failed', 'unstarted payment marked failed');
select tests.ok((select count(*) from public.payments where user_id = 'alice' and status = 'pending') = 2, 'recent and Stripe-backed payments untouched');
select tests.ok(public.internal_expire_unstarted_payments('alice') = 0 and tests.balance('alice') = 350, 'reconcile is idempotent and never moves coins');
drop table unstarted;
-- Leave no open checkouts behind for the tests below.
update public.payments set status = 'failed' where user_id = 'alice' and status = 'pending';
drop table retry_ids;
select tests.ok((select count(*) from public.coin_transactions where user_id = 'alice' and kind = 'purchase') = 1, 'one purchase ledger row');
-- Money path allocations sum to the amount paid.
select tests.ok((select sum(amount) from public.platform_ledger where ref_id = (select id::text from public.payments where provider_ref = 'cs_test_1')) = 50000, 'allocations sum to amount');
-- Tampered amount is rejected.
select public.internal_attach_payment_ref((public.internal_create_payment('alice', 1)).id, 'cs_test_bad');
select tests.ok(not (public.internal_credit_payment('cs_test_bad', 'pi_bad', 1, 'pkr') ->> 'credited')::boolean, 'amount mismatch rejected');
select tests.ok(tests.balance('alice') = 350, 'mismatch credits nothing');

-- 4b. Regional pricing: a buyer only gets their own region's packages. Region
-- comes from the frozen sign-up country, so editing profiles.country can't
-- unlock another market's (cheaper) prices.
select tests.fails($$select public.internal_create_payment('alice', (select id from public.coin_packages where region = 'IN' and name = 'Mega'))$$,
  '%invalid_package%', 'PK buyer cannot buy an IN package');
select tests.fails($$select public.internal_create_payment('carol', (select id from public.coin_packages where region = 'PK' and name = 'Mega'))$$,
  '%invalid_package%', 'IN buyer cannot buy a PK package');
select tests.ok((public.internal_create_payment('carol', (select id from public.coin_packages where region = 'IN' and name = 'Starter'))).currency = 'inr',
  'IN buyer pays in INR');
reset role;
select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
update public.profiles set country = 'IN' where id = 'alice';
select tests.ok((public.my_region()).code = 'PK', 'editing country does not change region');
select tests.ok(not exists (select 1 from public.coin_packages where region <> 'PK'), 'only own-region packages are listed');
select tests.fails($$update public.profiles set signup_country = 'IN' where id = 'alice'$$, '%permission denied%', 'sign-up country not client-writable');
update public.profiles set country = 'PK' where id = 'alice';
reset role;

---------------------------------------------------------------------------------------
-- 5. A duplicated gift request cannot double-charge
---------------------------------------------------------------------------------------
-- A cover picture is required to go live; hosts set it only from their own storage folder.
update public.platform_settings set value = value || '{"covers_base": "https://cdn.test/covers"}' where key = 'media';
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
select tests.fails($$select public.go_live('Bob live', 'music')$$, '%cover_required%', 'go live without a cover');
select tests.fails($$select public.set_room_cover('carol/pic.jpg')$$, '%invalid_cover%', 'cover from another user folder');
select tests.fails($$select public.set_room_cover('bob/../carol/pic.jpg')$$, '%invalid_cover%', 'cover path traversal');
select tests.fails($$select public.set_room_cover('bob/pic.exe')$$, '%invalid_cover%', 'cover wrong type');
select tests.fails($$update public.rooms set cover_url = 'https://evil.test/x.jpg' where host_id = 'bob'$$, '%permission denied%', 'client writes cover_url');
select tests.ok((public.set_room_cover('bob/cover-1.jpg')).cover_url = 'https://cdn.test/covers/bob/cover-1.jpg', 'host sets own cover');
select public.go_live('Bob live', 'music');
reset role;
select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
select tests.fails($$select public.set_room_cover('alice/a.jpg')$$, '%not_a_host%', 'non-host sets cover');
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
-- Room admins: max 5, host-only management, active only while live, followers only
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
select tests.fails($$select public.set_room_admin('m1', true)$$, '%must_follow_host%', 'non-follower cannot be made room admin');
reset role;
insert into public.follows (follower_id, followee_id)
  select u, 'bob' from unnest(array['alice', 'm1', 'm2', 'm3', 'm4', 'm5']) u on conflict do nothing;
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
select public.set_room_admin('alice', true);
select public.set_room_admin('alice', true); -- re-adding an existing admin is a no-op
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
select public.set_platform_setting('withdrawal', '{"pkr_per_coin": 0.5, "min_coins": 1000, "hold_days": 14}');
reset role;
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
-- A refunded/charged-back purchase whose coins were already gifted claws the host's share back.
reset role;
select tests.ok(exists (select 1 from public.earning_entries where host_id = 'bob' and kind = 'chargeback_clawback' and delta < 0),
  'refund of already-gifted coins clawed back the host share');
-- Each gift records the coins clawed from it, exactly the 20-coin shortfall, so a later
-- reversal can't take the same gift again.
select tests.ok((select sum(clawed_coins) from public.gifts where sender_id = 'alice') = 20, 'clawed coins recorded per gift');
select tests.ok(not exists (select 1 from public.gifts where clawed_coins > coins_total), 'never more than the gift');
-- Who charged back, and send keys, are private: clients can read the gift feed but not these.
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
select tests.fails($$select clawed_coins from public.gifts limit 1$$, '%permission denied%', 'clawed coins are private');
select tests.fails($$select idempotency_key from public.gifts limit 1$$, '%permission denied%', 'gift send keys are private');
select tests.ok((select count(*) from public.gifts where sender_id = 'alice') > 0, 'gift feed still readable');
select tests.fails($$select public.request_translation(1, 'xx')$$, '%invalid_language%', 'only app languages can be translated');
reset role;
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
-- New gift earnings are held for the dispute window before they can be withdrawn.
select tests.ok((select coalesce(sum(delta), 0) from public.earning_entries where host_id = 'bob' and kind = 'gift') > 0, 'some of them are fresh gift earnings');
select tests.fails($$select public.request_withdrawal((select balance from public.creator_earnings where host_id = 'bob'), '{"type":"easypaisa","account":"03001234567"}')$$, '%insufficient_earnings%', 'fresh gift earnings are held for the dispute window');
reset role;
select set_config('request.jwt.claims', '{"sub":"owner"}', false);
set role authenticated;
select public.set_platform_setting('withdrawal', '{"pkr_per_coin": 0.5, "min_coins": 1000, "hold_days": 0}');
reset role;
-- Withdrawals only where the host's region supports them (IN does not).
select set_config('request.jwt.claims', '{"sub":"carol"}', false);
set role authenticated;
select tests.fails($$select public.request_withdrawal(1000, '{"type":"easypaisa","account":"03001234567"}')$$, '%withdrawals_unavailable%', 'region without withdrawals');
reset role;
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
select tests.fails($$select public.request_withdrawal(999999, '{"type":"bank","account":"PK36SCBL0000001123456702"}')$$, '%insufficient_earnings%', 'overdraw earnings');
select tests.fails($$select public.request_withdrawal(10, '{"type":"bank","account":"PK36SCBL0000001123456702"}')$$, '%below_minimum%', 'below minimum');
select tests.fails($$select public.request_withdrawal(2000, '{"type":"crypto","account":"03001234567"}')$$, '%invalid_payout_method%', 'unknown payout type');
select tests.fails($$select public.request_withdrawal(2000, '{"type":"bank"}')$$, '%invalid_payout_method%', 'payout without account');
select tests.fails($$select public.request_withdrawal(2000, '{"account":"03001234567"}')$$, '%invalid_payout_method%', 'payout without a type');
select public.request_withdrawal(2000, '{"type":"easypaisa","account":"03001234567"}');
select tests.ok((select balance = 3000 and held = 2000 from public.creator_earnings where host_id = 'bob'), 'coins held');
select tests.ok((select amount_minor from public.withdrawals where host_id = 'bob') = 100000, '2000 coins * 0.5 PKR = 1000.00 PKR');
select tests.fails($$select public.review_withdrawal((select id from public.withdrawals where host_id = 'bob'), true)$$, '%forbidden%', 'host approves own withdrawal');
reset role;
select set_config('request.jwt.claims', '{"sub":"owner"}', false);
set role authenticated;
select public.review_withdrawal((select id from public.withdrawals where host_id = 'bob'), false, 'Verify account');
reset role;
select tests.ok((select balance = 5000 and held = 0 from public.creator_earnings where host_id = 'bob'), 'rejected withdrawal released');
-- An approved withdrawal whose payout failed can be rejected: the coins go back to the host.
select set_config('request.jwt.claims', '{"sub":"bob"}', false);
set role authenticated;
select public.request_withdrawal(2000, '{"type":"easypaisa","account":"03001234567"}');
reset role;
select set_config('request.jwt.claims', '{"sub":"owner"}', false);
set role authenticated;
select public.review_withdrawal((select id from public.withdrawals where host_id = 'bob' and status = 'requested'), true);
reset role;
select tests.ok((select balance = 3000 and held = 0 from public.creator_earnings where host_id = 'bob'), 'approved withdrawal leaves the balance');
select set_config('request.jwt.claims', '{"sub":"owner"}', false);
set role authenticated;
select public.review_withdrawal((select id from public.withdrawals where host_id = 'bob' and status = 'approved'), false, 'Payout failed');
select tests.fails($$select public.review_withdrawal((select id from public.withdrawals where host_id = 'bob' and status = 'rejected' order by updated_at desc limit 1), false)$$, '%not_found%', 'a rejected withdrawal cannot be rejected twice');
reset role;
select tests.ok((select balance = 5000 and held = 0 from public.creator_earnings where host_id = 'bob'), 'failed payout returned to the host');

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

---------------------------------------------------------------------------------------
-- Engagement events & media: no client writes to scores, events or processing state
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
select tests.fails($$select public.upsert_event(null, 'My event', null, 'gifting', null, now(), now() + interval '1 day', null, '[]', true)$$,
  '%forbidden%', 'users cannot create events');
select tests.fails($$insert into public.event_scores (event_id, user_id, role, score) select id, 'alice', 'gifter', 999999 from public.events limit 1$$,
  '%permission denied%', 'users cannot write event scores');
select tests.fails($$select public.internal_finalize_due_events()$$, '%permission denied%', 'users cannot finalize events');
select tests.fails($$select public.internal_media_ready(gen_random_uuid(), 'x/master.m3u8', null, '[]')$$, '%permission denied%', 'users cannot mark media processed');
select tests.fails($$select public.internal_register_live_recording('room_x', 'EG_x', 'alice/x.mp4')$$, '%permission denied%', 'users cannot register recordings');
reset role;
-- Signed-out callers can't reach admin RPCs at all (security advisor 0028).
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  -- check_request_ip() is the IP-block check the API runs before every request, signed in or not.
  where n.nspname = 'public' and p.proname not in ('my_region', 'check_request_ip') and has_function_privilege('anon', p.oid, 'execute')),
  'anon can execute no public function except my_region() and check_request_ip()');

---------------------------------------------------------------------------------------
-- Verified IDs pinned on Home: only the owner verifies and pins; everyone can read pins
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
select tests.fails($$select public.set_profile_verified('alice', true)$$, '%forbidden%', 'users cannot verify themselves');
select tests.fails($$select public.set_profile_pinned('alice', true)$$, '%forbidden%', 'users cannot pin themselves');
select tests.fails($$insert into public.pinned_profiles (user_id) values ('alice')$$, '%permission denied%', 'users cannot write pins');
reset role;
select set_config('request.jwt.claims', '{"sub":"owner"}', false);
set role authenticated;
select public.set_profile_verified('frank', false);
select tests.fails($$select public.set_profile_pinned('frank', true)$$, '%not_verified%', 'only verified accounts can be pinned');
select public.set_profile_verified('frank', true);
select public.set_profile_pinned('frank', true, 1);
reset role;
select tests.ok((select owner_verified_at is not null from public.profiles where id = 'frank'), 'owner verified the account');
select tests.ok((select verified_at is null from public.profiles where id = 'frank'), 'owner tick is not the Host (Didit) badge');
select tests.ok(exists (select 1 from public.pinned_profiles where user_id = 'frank'), 'frank is pinned');
select tests.ok(has_column_privilege('anon', 'public.pinned_profiles', 'user_id', 'select'), 'pins are public');
select set_config('request.jwt.claims', '{"sub":"owner"}', false);
set role authenticated;
select public.set_profile_verified('frank', false);
reset role;
select tests.ok(not exists (select 1 from public.pinned_profiles where user_id = 'frank'), 'removing verification unpins');

---------------------------------------------------------------------------------------
-- Blocking works both ways; a ban clears the owner tick and pin; disputes unfreeze
---------------------------------------------------------------------------------------
insert into public.follows (follower_id, followee_id) values ('carol', 'frank'), ('frank', 'carol') on conflict do nothing;
select set_config('request.jwt.claims', '{"sub":"carol"}', false);
set role authenticated;
select public.block_user('frank');
select tests.fails($$select public.send_direct_message('frank', 'hi')$$, '%blocked%', 'the blocker cannot message the blocked person either');
select tests.fails($$insert into public.follows (follower_id, followee_id) values ('carol', 'frank')$$, '%row-level security%', 'no following someone you blocked');
reset role;
select tests.ok(not exists (select 1 from public.follows where (follower_id = 'carol' and followee_id = 'frank') or (follower_id = 'frank' and followee_id = 'carol')), 'blocking removes follows both ways');

insert into public.profiles (id, username, owner_verified_at) values ('pin_ban', 'pin_ban', now());
insert into public.pinned_profiles (user_id) values ('pin_ban');
update public.profiles set status = 'banned' where id = 'pin_ban';
select tests.ok(not exists (select 1 from public.pinned_profiles where user_id = 'pin_ban')
  and (select owner_verified_at is null from public.profiles where id = 'pin_ban'), 'a ban clears the owner tick and Home pin');

select public.internal_attach_payment_ref((public.internal_create_payment('alice', 1)).id, 'cs_dispute_close');
select (public.internal_credit_payment('cs_dispute_close', 'pi_close', (select price_minor from public.coin_packages where id = 1), (select currency from public.coin_packages where id = 1)));
select public.internal_dispute_payment('pi_close', 'opened');
select tests.ok((select frozen from public.wallets where user_id = 'alice'), 'dispute freezes the wallet');
select public.internal_dispute_payment('pi_close', 'closed');
select tests.ok(not (select frozen from public.wallets where user_id = 'alice'), 'an inquiry closed in our favour unfreezes the wallet');

---------------------------------------------------------------------------------------
-- Profile frames: priced by the server, charged once, owned and worn only through RPCs
---------------------------------------------------------------------------------------
insert into public.profiles (id, username) values ('framer', 'framer');
select private.lock_wallet('framer');
select private.apply_coin_delta('framer', 1000, 'adjustment', 'test', 'framer', 'test-framer-coins');
select set_config('request.jwt.claims', '{"sub":"framer"}', false);
set role authenticated;
select tests.fails($$select public.equip_frame('rose_gold')$$, '%frame_not_owned%', 'cannot wear a frame you do not own');
select tests.fails($$insert into public.user_frames (user_id, frame_id) values ('framer', 'diamond')$$, '%permission denied%', 'no direct frame grants');
select tests.fails($$insert into public.frame_purchases (user_id, frame_id, coins, idempotency_key) values ('framer', 'diamond', 1, 'fake-purchase')$$, '%permission denied%', 'no fake purchases');
select tests.fails($$update public.profiles set active_frame_id = 'diamond' where id = 'framer'$$, '%permission denied%', 'no wearing a frame by direct update');
select tests.fails($$update public.frame_catalog set coin_price = 1 where id = 'diamond'$$, '%permission denied%', 'clients cannot change frame prices');
select tests.fails($$select public.buy_frame('diamond', 'frame-key-0001')$$, '%insufficient_coins%', 'cannot buy a frame you cannot afford');
select tests.fails($$select public.buy_frame('no_such_frame', 'frame-key-0009')$$, '%invalid_frame%', 'unknown frame');
select public.buy_frame('rose_gold', 'frame-key-0002');
select public.buy_frame('rose_gold', 'frame-key-0002');
select tests.ok(tests.balance('framer') = 700, 'frame charged once, at the catalog price');
select tests.ok((select count(*) from public.frame_purchases where user_id = 'framer') = 1, 'a retried purchase returns the first one');
select public.buy_frame('rose_gold', 'frame-key-0003');
select tests.ok(tests.balance('framer') = 400, 'buying a timed frame again charges again');
select tests.ok((select expires_at > now() + interval '59 days' from public.user_frames where user_id = 'framer' and frame_id = 'rose_gold'), 'buying again adds the time');
select public.equip_frame('rose_gold');
select tests.ok((select active_frame_id from public.profiles where id = 'framer') = 'rose_gold', 'a bought frame can be worn');
select public.equip_frame(null);
select tests.ok((select active_frame_id from public.profiles where id = 'framer') is null, 'a frame can be taken off');
reset role;
select tests.ok((select sum(amount) from public.platform_ledger where bucket = 'frame_sales'
  and ref_id in (select id::text from public.frame_purchases where user_id = 'framer')) = 600, 'frame coins booked to the platform ledger');
select tests.ok((select count(*) from public.coin_transactions where user_id = 'framer' and kind = 'frame_purchase') = 2, 'each purchase is in the coin ledger');
update public.wallets set frozen = true where user_id = 'framer';
select set_config('request.jwt.claims', '{"sub":"framer"}', false);
set role authenticated;
select tests.fails($$select public.buy_frame('emerald', 'frame-key-0004')$$, '%wallet_frozen%', 'a frozen wallet cannot buy frames');
reset role;
update public.wallets set frozen = false where user_id = 'framer';
update public.user_frames set expires_at = now() - interval '1 day' where user_id = 'framer';
select set_config('request.jwt.claims', '{"sub":"framer"}', false);
set role authenticated;
select tests.fails($$select public.equip_frame('rose_gold')$$, '%frame_not_owned%', 'an expired frame cannot be worn');
select tests.fails($$select public.buy_frame('royal_crown', 'frame-key-0005')$$, '%insufficient_coins%', 'permanent frame needs enough coins');
reset role;
select tests.ok(tests.balance('framer') = 400, 'a failed purchase charges nothing');

---------------------------------------------------------------------------------------
-- Gift tallies (hot-row fix): pending amounts are private and land exactly where it counts
---------------------------------------------------------------------------------------
insert into public.profiles (id, username) values ('tl_host', 'tl_host'), ('tl_rival', 'tl_rival'), ('tl_fan', 'tl_fan');
insert into public.hosts (user_id) values ('tl_host'), ('tl_rival');
insert into public.rooms (host_id, status, cover_url) values ('tl_host', 'live', 'x'), ('tl_rival', 'live', 'x');
insert into public.streams (room_id, host_id, title) select id, host_id, 'tally test' from public.rooms where host_id in ('tl_host', 'tl_rival');
update public.rooms r set current_stream_id = s.id from public.streams s where s.room_id = r.id and r.host_id in ('tl_host', 'tl_rival');
select private.lock_wallet('tl_fan');
select private.apply_coin_delta('tl_fan', 1000, 'adjustment', 'test', 'tl_fan', 'test-tl-fan-coins');
select set_config('request.jwt.claims', '{"sub":"tl_fan"}', false);
set role authenticated;
select tests.fails($$select * from private.gift_tallies$$, '%permission denied%', 'clients cannot read gift tallies');
select tests.fails($$insert into private.gift_tallies (kind, target, a) values ('earnings', 'tl_fan', 999999)$$, '%permission denied%', 'clients cannot add gift tallies');
select tests.fails($$select private.fold_tally('earnings', 'tl_host', true)$$, '%permission denied%', 'clients cannot fold tallies directly');
select public.send_gift((select id from public.rooms where host_id = 'tl_host'), 1, 10, 'tally-gift-0001');
reset role;
select tests.ok((select balance from public.creator_earnings where host_id = 'tl_host')
  = (select host_share from public.gifts where idempotency_key = 'tally-gift-0001'), 'an uncontended gift credits the host at once');
select tests.ok((select gift_coins from public.streams where host_id = 'tl_host') = (select coins_total from public.gifts where idempotency_key = 'tally-gift-0001'),
  'an uncontended gift updates the stream total at once');
select tests.ok(not exists (select 1 from private.gift_tallies where target = 'tl_host'), 'folded tallies are removed');

-- A tally another gift skipped (it was busy folding) is picked up by the host's own settle.
insert into private.gift_tallies (kind, target, a) values ('earnings', 'tl_host', 40);
select set_config('request.jwt.claims', '{"sub":"tl_host"}', false);
set role authenticated;
select public.settle_my_earnings();
reset role;
select tests.ok((select balance from public.creator_earnings where host_id = 'tl_host')
  = (select host_share from public.gifts where idempotency_key = 'tally-gift-0001') + 40, 'settle folds a host''s pending tallies exactly once');
select tests.ok((select lifetime from public.creator_earnings where host_id = 'tl_host')
  = (select balance from public.creator_earnings where host_id = 'tl_host'), 'lifetime earnings include folded tallies');

-- Ending a PK battle counts every pending tally before choosing the winner.
insert into public.pk_battles (room_a_id, room_b_id, status, score_a, score_b, started_at, ends_at)
  select a.id, b.id, 'live', 100, 0, now(), now() + interval '5 minutes'
  from public.rooms a, public.rooms b where a.host_id = 'tl_host' and b.host_id = 'tl_rival';
update public.rooms set current_battle_id = (select id from public.pk_battles where score_a = 100 and room_a_id = (select id from public.rooms where host_id = 'tl_host'))
  where host_id in ('tl_host', 'tl_rival');
insert into private.gift_tallies (kind, target, b) select 'pk', current_battle_id::text, 500 from public.rooms where host_id = 'tl_host';
select set_config('request.jwt.claims', '{"sub":"tl_host"}', false);
set role authenticated;
select public.end_pk_battle((select current_battle_id from public.rooms where host_id = 'tl_host'));
reset role;
select tests.ok((select score_b = 500 and winner_room_id = room_b_id from public.pk_battles
  where room_a_id = (select id from public.rooms where host_id = 'tl_host') and status = 'ended'), 'a pending PK tally counts and decides the winner');

-- Ending a stream counts its pending tallies in the final total.
insert into private.gift_tallies (kind, target, a, b) select 'stream', current_stream_id::text, 70, 7 from public.rooms where host_id = 'tl_host';
select set_config('request.jwt.claims', '{"sub":"tl_host"}', false);
set role authenticated;
select public.end_live();
reset role;
select tests.ok((select gift_coins from public.streams where host_id = 'tl_host')
  = (select coins_total from public.gifts where idempotency_key = 'tally-gift-0001') + 70, 'ending a stream folds its pending gift coins');
select tests.ok(not exists (select 1 from private.gift_tallies where kind in ('stream', 'pk')), 'ending a stream or battle leaves no tallies behind');
-- Leave no battle or live room behind for later test files.
delete from public.pk_battles where room_a_id = (select id from public.rooms where host_id = 'tl_host');
update public.rooms set status = 'offline', current_stream_id = null where host_id = 'tl_rival';

---------------------------------------------------------------------------------------
-- Rankings cache: private, shared for a short time, refreshed once it expires
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"tl_fan"}', false);
set role authenticated;
select tests.fails($$select * from private.rankings_cache$$, '%permission denied%', 'clients cannot read the rankings cache');
select tests.fails($$select private.compute_rankings('creator', 'week')$$, '%permission denied%', 'clients cannot call the uncached rankings');
select tests.fails($$select * from public.get_rankings('nonsense', 'week')$$, '%invalid_kind%', 'unknown ranking kind');
select count(*) from public.get_rankings('gifter', 'week');
reset role;
select tests.ok(exists (select 1 from private.rankings_cache where kind = 'gifter' and period = 'week'), 'a ranking is cached after the first call');
update private.rankings_cache set rows = '[{"rank":1,"subject_id":"cached_marker","label":"x","avatar_url":null,"score":1}]' where kind = 'gifter' and period = 'week';
select set_config('request.jwt.claims', '{"sub":"tl_fan"}', false);
set role authenticated;
select tests.ok((select subject_id from public.get_rankings('gifter', 'week') where rank = 1) = 'cached_marker', 'within 60 s the cached ranking is served');
reset role;
update private.rankings_cache set computed_at = now() - interval '2 minutes' where kind = 'gifter' and period = 'week';
select set_config('request.jwt.claims', '{"sub":"tl_fan"}', false);
set role authenticated;
select tests.ok((select subject_id from public.get_rankings('gifter', 'week') where rank = 1) <> 'cached_marker', 'an expired ranking is recomputed from the gifts');
reset role;

---------------------------------------------------------------------------------------
-- Viewer events: counts are the viewers in the live, the peak only goes up
---------------------------------------------------------------------------------------
insert into public.profiles (id, username) values ('ve_host', 've_host'), ('ve_fan', 've_fan');
insert into public.hosts (user_id) values ('ve_host');
insert into public.rooms (host_id, status, cover_url) values ('ve_host', 'live', 'x');
insert into public.streams (room_id, host_id, title) select id, host_id, 've' from public.rooms where host_id = 've_host';
update public.rooms r set current_stream_id = s.id from public.streams s where s.room_id = r.id and r.host_id = 've_host';
select public.internal_viewer_event((select livekit_room from public.rooms where host_id = 've_host'), 've_fan', true, 5);
select tests.ok((select viewer_count from public.rooms where host_id = 've_host') = 1
  and (select peak_viewers from public.streams where host_id = 've_host') = 1, 'a join sets the viewer count and peak');
select tests.ok(exists (select 1 from public.viewers v join public.streams s on s.id = v.stream_id where s.host_id = 've_host' and v.user_id = 've_fan' and v.left_at is null), 'a join records the viewer');
select public.internal_viewer_event((select livekit_room from public.rooms where host_id = 've_host'), 've_fan', false, 3);
select tests.ok((select viewer_count from public.rooms where host_id = 've_host') = 0
  and (select peak_viewers from public.streams where host_id = 've_host') = 1, 'a leave lowers the count but never the peak');
select tests.ok((select left_at is not null from public.viewers v join public.streams s on s.id = v.stream_id where s.host_id = 've_host' and v.user_id = 've_fan'), 'a leave records when the viewer left');
update public.rooms set status = 'offline' where host_id = 've_host';
select public.internal_viewer_event((select livekit_room from public.rooms where host_id = 've_host'), 've_fan', true, 40);
select tests.ok((select viewer_count from public.rooms where host_id = 've_host') = 0, 'events for a room that is not live are ignored');

---------------------------------------------------------------------------------------
-- Website APK: only the service role chooses which build zynalive.com/download offers
---------------------------------------------------------------------------------------
insert into public.platform_settings (key, value) values ('android_apk', '{"source": "https://expo.dev/artifacts/eas/test.apk"}') on conflict (key) do nothing;
select set_config('request.jwt.claims', '{"sub":"alice"}', false);
set role authenticated;
select tests.fails($$update public.platform_settings set value = '{"source": "https://evil.example/x.apk"}' where key = 'android_apk'$$, '%permission denied%', 'client cannot change the website APK');
select tests.fails($$insert into public.platform_settings (key, value) values ('android_apk_2', '{}')$$, '%permission denied%', 'client cannot add settings');
reset role;

---------------------------------------------------------------------------------------
-- 2026-10-19 bug fixes
---------------------------------------------------------------------------------------
-- my_region(): signed-in only
select tests.ok(not has_function_privilege('anon', 'public.my_region()', 'execute'), 'signed-out visitors cannot call my_region');
select tests.ok(has_function_privilege('authenticated', 'public.my_region()', 'execute'), 'signed-in users can call my_region');

-- Profile photos only through set_avatar(), from the caller's own folder
insert into public.profiles (id, username) values ('av_user', 'av_user'), ('av_other', 'av_other');
update public.platform_settings set value = value || '{"avatars_base": "https://cdn.test/avatars"}' where key = 'media';
select set_config('request.jwt.claims', '{"sub":"av_user"}', false);
set role authenticated;
select tests.fails($$update public.profiles set avatar_url = 'https://evil.example/x.png' where id = 'av_user'$$, '%permission denied%', 'clients cannot write avatar_url directly');
select tests.fails($$select public.set_avatar('av_other/pic.png')$$, '%invalid_avatar%', 'a picture from someone else''s folder is refused');
select tests.fails($$select public.set_avatar('av_user/../x.png')$$, '%invalid_avatar%', 'path tricks are refused');
select tests.ok((select avatar_url from public.set_avatar('av_user/me.png')) = 'https://cdn.test/avatars/av_user/me.png', 'own picture is set from the configured base');
select tests.ok((select avatar_url from public.set_avatar(null)) is null, 'the photo can be removed');
reset role;

-- DMs to strangers: 3 until they reply or follow back
insert into public.profiles (id, username) values ('dm_a', 'dm_a'), ('dm_b', 'dm_b');
select set_config('request.jwt.claims', '{"sub":"dm_a"}', false);
set role authenticated;
select public.send_direct_message('dm_b', 'hi 1');
select public.send_direct_message('dm_b', 'hi 2');
select public.send_direct_message('dm_b', 'hi 3');
select tests.fails($$select public.send_direct_message('dm_b', 'hi 4')$$, '%wait_for_reply%', 'a 4th unanswered message to a stranger waits for a reply');
reset role;
select set_config('request.jwt.claims', '{"sub":"dm_b"}', false);
set role authenticated;
select public.send_direct_message('dm_a', 'hello back');
reset role;
select set_config('request.jwt.claims', '{"sub":"dm_a"}', false);
set role authenticated;
select tests.ok((select body from public.send_direct_message('dm_b', 'hi 4')) = 'hi 4', 'after a reply the conversation is open');
reset role;

-- Late room_finished for an earlier live does not end the current one
insert into public.profiles (id, username) values ('lf_host', 'lf_host');
insert into public.hosts (user_id) values ('lf_host');
insert into public.rooms (host_id, status, cover_url) values ('lf_host', 'live', 'x');
insert into public.streams (room_id, host_id, title, started_at, host_connected_at)
  select id, host_id, 'lf', now(), now() from public.rooms where host_id = 'lf_host';
update public.rooms r set current_stream_id = s.id from public.streams s where s.room_id = r.id and r.host_id = 'lf_host';
select public.internal_end_stream_by_livekit_room((select livekit_room from public.rooms where host_id = 'lf_host'), now() - interval '10 minutes');
select tests.ok((select status from public.rooms where host_id = 'lf_host') = 'live', 'room_finished for a LiveKit room created before this live is ignored');
select public.internal_end_stream_by_livekit_room((select livekit_room from public.rooms where host_id = 'lf_host'), now());
select tests.ok((select status from public.rooms where host_id = 'lf_host') = 'offline', 'room_finished for the current LiveKit room ends the live');

-- A live whose host never connected is ended by the next join anywhere; connected lives stay
insert into public.profiles (id, username) values ('uc_host', 'uc_host'), ('ok_host', 'ok_host'), ('uc_fan', 'uc_fan');
insert into public.hosts (user_id) values ('uc_host'), ('ok_host');
insert into public.rooms (host_id, status, cover_url) values ('uc_host', 'live', 'x'), ('ok_host', 'live', 'x');
insert into public.streams (room_id, host_id, title, started_at, host_connected_at)
  select id, host_id, 'uc', now() - interval '20 minutes', case when host_id = 'ok_host' then now() - interval '20 minutes' end
  from public.rooms where host_id in ('uc_host', 'ok_host');
update public.rooms r set current_stream_id = s.id from public.streams s where s.room_id = r.id and r.host_id in ('uc_host', 'ok_host');
select public.internal_viewer_event((select livekit_room from public.rooms where host_id = 'ok_host'), 'uc_fan', true, 1);
select tests.ok((select status from public.rooms where host_id = 'uc_host') = 'offline', 'a live whose host never connected for 10 minutes is ended');
select tests.ok((select status from public.rooms where host_id = 'ok_host') = 'live', 'a connected live is not touched');

-- A guest who left inside the seat grace and stayed away loses the seat on the next event
insert into public.profiles (id, username) values ('st_guest', 'st_guest'), ('st_fan', 'st_fan');
insert into public.viewers (stream_id, user_id, left_at)
  select current_stream_id, 'st_guest', now() - interval '30 seconds' from public.rooms where host_id = 'ok_host';
insert into public.room_seats (room_id, seat, user_id, created_at)
  select id, 1, 'st_guest', now() - interval '40 seconds' from public.rooms where host_id = 'ok_host';
select public.internal_viewer_event((select livekit_room from public.rooms where host_id = 'ok_host'), 'st_fan', true, 2);
select tests.ok(not exists (select 1 from public.room_seats where user_id = 'st_guest'), 'a seat left behind during the grace is freed');

---------------------------------------------------------------------------------------
-- 2026-10-19 app analysis fixes
---------------------------------------------------------------------------------------
-- Every table clients can reach has Row Level Security (catches a future table without it).
select tests.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
), 'every public table has row level security');

-- Fallback rate limit: counts per key inside the window; only the service role may call it.
select tests.ok(not has_function_privilege('authenticated', 'public.internal_rate_limit(text, int, int)', 'execute'), 'clients cannot call the rate limiter');
select tests.ok(public.internal_rate_limit('t:rl', 2, 60) and public.internal_rate_limit('t:rl', 2, 60), 'requests within the limit pass');
select tests.ok(not public.internal_rate_limit('t:rl', 2, 60), 'the request over the limit is refused');
select tests.ok(public.internal_rate_limit('t:other', 2, 60), 'other users and actions have their own count');
update private.rate_limits set window_start = now() - interval '2 minutes' where key = 't:rl';
select tests.ok(public.internal_rate_limit('t:rl', 2, 60), 'a new window starts the count again');

-- A new live sweeps lives whose host never connected (no join needed).
insert into public.profiles (id, username) values ('sw_old', 'sw_old'), ('sw_new', 'sw_new');
insert into public.hosts (user_id) values ('sw_old'), ('sw_new');
insert into public.rooms (host_id, status, cover_url) values ('sw_old', 'live', 'x');
insert into public.streams (room_id, host_id, title, started_at)
  select id, host_id, 'sw', now() - interval '20 minutes' from public.rooms where host_id = 'sw_old';
update public.rooms r set current_stream_id = s.id from public.streams s where s.room_id = r.id and r.host_id = 'sw_old';
insert into public.rooms (host_id, status, cover_url) values ('sw_new', 'live', 'x');
insert into public.streams (room_id, host_id, title) select id, host_id, 'sw' from public.rooms where host_id = 'sw_new';
select tests.ok((select status from public.rooms where host_id = 'sw_old') = 'offline', 'a new live ends a dead one whose host never connected');

-- Viewer count comes from who is in the live, not LiveKit's estimate (host reconnecting).
insert into public.profiles (id, username) values ('vc_fan1', 'vc_fan1'), ('vc_fan2', 'vc_fan2');
select public.internal_viewer_event((select livekit_room from public.rooms where host_id = 'ok_host'), 'vc_fan1', true, 0);
select public.internal_viewer_event((select livekit_room from public.rooms where host_id = 'ok_host'), 'vc_fan2', true, 0);
select public.internal_viewer_event((select livekit_room from public.rooms where host_id = 'ok_host'), 'vc_fan1', false, 99);
select tests.ok((select viewer_count from public.rooms where host_id = 'ok_host')
  = (select count(*) from public.viewers v join public.rooms r on r.current_stream_id = v.stream_id where r.host_id = 'ok_host' and v.left_at is null), 'viewer count matches the viewers in the live');

---------------------------------------------------------------------------------------
-- 2026-10-19 security audit fixes
---------------------------------------------------------------------------------------
-- No internal_* function is callable by clients (blanket check against regressions).
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'internal\_%'
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
), 'clients cannot execute any internal_* function');

-- Tokens issued by Supabase Auth itself (not Clerk) are not a signed-in user.
select set_config('request.jwt.claims', '{"sub":"alice","iss":"https://ref.supabase.co/auth/v1"}', false);
select tests.ok(public.requesting_user_id() is null, 'a Supabase Auth token maps to no user');
select set_config('request.jwt.claims', '{"sub":"alice","iss":"https://clerk.zynalive.com"}', false);
select tests.ok(public.requesting_user_id() = 'alice', 'a Clerk token maps to its user');

-- A banned owner loses admin rights; an owner cannot action a super admin.
insert into public.profiles (id, username, role) values ('sec_owner', 'sec_owner', 'OWNER_ADMIN'), ('sec_root', 'sec_root', 'SUPER_ADMIN'), ('sec_user', 'sec_user', 'USER');
select set_config('request.jwt.claims', '{"sub":"sec_owner"}', false);
set role authenticated;
select tests.ok(public.is_platform_admin(), 'an active owner is an admin');
select tests.fails($$select public.apply_moderation_action('sec_root', 'temp_ban', 'x', 24)$$, '%protected_account%', 'an owner cannot ban the super admin');
reset role;
update public.profiles set status = 'banned' where id = 'sec_owner';
select set_config('request.jwt.claims', '{"sub":"sec_owner"}', false);
set role authenticated;
select tests.ok(not public.is_platform_admin(), 'a banned owner is not an admin');
select tests.fails($$select public.apply_moderation_action('sec_user', 'warning', 'x')$$, '%forbidden%', 'a banned owner cannot moderate');
reset role;

-- Uploads need the host ID check.
insert into public.profiles (id, username) values ('sec_host', 'sec_host');
insert into public.hosts (user_id) values ('sec_host');
update public.platform_settings set value = value || '{"uploads_enabled": true}' where key = 'media';
select set_config('request.jwt.claims', '{"sub":"sec_host"}', false);
set role authenticated;
select tests.fails($$select public.create_media_upload('Clip', 'mp4')$$, '%verification_required%', 'an unverified host cannot publish videos');
reset role;

-- Support tickets: 5 a day.
select set_config('request.jwt.claims', '{"sub":"sec_user"}', false);
set role authenticated;
select public.create_support_ticket('Help me', 'Something broke') from generate_series(1, 5);
select tests.fails($$select public.create_support_ticket('Help me', 'Something broke')$$, '%slow_down%', 'a 6th support ticket in a day is refused');
reset role;

-- Agency staff no longer read reports or withdrawals through RLS.
select tests.ok(not exists (select 1 from pg_policies where tablename in ('reports', 'withdrawals') and qual like '%is_agency_admin_of_user%'),
  'reports and withdrawals are not visible to agency staff');

-- Hidden chat can't be read through a translation.
insert into public.rooms (host_id, status, cover_url) values ('sec_host', 'offline', 'x');
insert into public.messages (room_id, sender_id, body) select id, 'sec_host', 'hello' from public.rooms where host_id = 'sec_host';
insert into public.message_translations (message_id, language, body) select id, 'ur', 'salaam' from public.messages where sender_id = 'sec_host';
select set_config('request.jwt.claims', '{"sub":"sec_user"}', false);
set role authenticated;
select tests.ok((select count(*) from public.message_translations t join public.messages m on m.id = t.message_id where m.sender_id = 'sec_host') = 1, 'a visible message''s translation is readable');
reset role;
update public.messages set status = 'hidden' where sender_id = 'sec_host';
set role authenticated;
select tests.ok((select count(*) from public.message_translations where body = 'salaam') = 0, 'a hidden message''s translation is not readable');
reset role;

-- AI coaching is private to the host.
insert into public.streams (room_id, host_id, title) select id, host_id, 'c' from public.rooms where host_id = 'sec_host';
insert into public.stream_coaching (stream_id, host_id, summary) select id, host_id, '{"headline":"x"}' from public.streams where host_id = 'sec_host';
select set_config('request.jwt.claims', '{"sub":"sec_user"}', false);
set role authenticated;
select tests.ok((select count(*) from public.stream_coaching) = 0, 'others cannot read a host''s coaching');
reset role;
select set_config('request.jwt.claims', '{"sub":"sec_host"}', false);
set role authenticated;
select tests.ok((select count(*) from public.stream_coaching) = 1, 'the host reads their own coaching');
reset role;

-- 2026-10-26 IP blocks
-- Requests from a blocked address or range are refused; others pass; only admins edit the list.
insert into private.blocked_ips (ip, reason) values ('162.128.44.156', 'test'), ('10.9.0.0/16', 'test range');
select tests.ok(has_function_privilege('anon', 'public.check_request_ip()', 'execute'), 'the IP check runs for signed-out requests too');
select set_config('request.headers', '{"cf-connecting-ip":"162.128.44.156"}', false);
set role authenticated;
select tests.fails($$select public.check_request_ip()$$, '%blocked%', 'a blocked IP is refused');
select set_config('request.headers', '{"x-forwarded-for":"10.9.4.2, 172.16.0.1"}', false);
select tests.fails($$select public.check_request_ip()$$, '%blocked%', 'an IP inside a blocked range is refused');
select set_config('request.headers', '{"cf-connecting-ip":"162.128.44.157"}', false);
select public.check_request_ip();
select set_config('request.headers', '{"cf-connecting-ip":"not-an-ip"}', false);
select public.check_request_ip();
select set_config('request.headers', '', false);
select public.check_request_ip();
select tests.fails($$select count(*) from private.blocked_ips$$, '%permission denied%', 'clients cannot read the block list');
reset role;
insert into public.profiles (id, username, role) values ('ipb_owner', 'ipb_owner', 'OWNER_ADMIN'), ('ipb_user', 'ipb_user', 'USER');
select set_config('request.jwt.claims', '{"sub":"ipb_user"}', false);
set role authenticated;
select tests.fails($$select public.block_ip('1.2.3.4')$$, '%forbidden%', 'a normal user cannot block IPs');
reset role;
select set_config('request.jwt.claims', '{"sub":"ipb_owner"}', false);
set role authenticated;
select public.block_ip('1.2.3.4', 'spam', 'ipb_user');
select tests.fails($$select public.block_ip('nope')$$, '%invalid_ip%', 'a bad IP is rejected');
reset role;
select tests.ok(exists (select 1 from private.blocked_ips where ip = '1.2.3.4' and created_by = 'ipb_owner'), 'an admin blocks an IP');
select set_config('request.jwt.claims', '{"sub":"ipb_owner"}', false);
set role authenticated;
select public.unblock_ip('1.2.3.4');
reset role;
select tests.ok(not exists (select 1 from private.blocked_ips where ip = '1.2.3.4'), 'an admin unblocks an IP');
select set_config('request.headers', '', false);

-- 2026-10-27 Privacy & notification settings
insert into public.profiles (id, username) values ('pv_a', 'pv_a'), ('pv_b', 'pv_b'), ('pv_c', 'pv_c');
insert into public.follows (follower_id, followee_id) values ('pv_b', 'pv_c');  -- pv_b follows pv_c
-- "No one": nobody can start or continue a conversation.
update public.profiles set who_can_message = 'nobody' where id = 'pv_b';
select set_config('request.jwt.claims', '{"sub":"pv_a"}', false);
set role authenticated;
select tests.fails($$select public.send_direct_message('pv_b', 'hi')$$, '%messages_off%', 'no one can message someone who chose "No one"');
reset role;
-- "People you follow": only people the recipient follows.
update public.profiles set who_can_message = 'followers' where id = 'pv_b';
select set_config('request.jwt.claims', '{"sub":"pv_a"}', false);
set role authenticated;
select tests.fails($$select public.send_direct_message('pv_b', 'hi')$$, '%messages_followers_only%', 'a stranger cannot message a "People you follow" account');
reset role;
select set_config('request.jwt.claims', '{"sub":"pv_c"}', false);
set role authenticated;
select tests.ok((select body from public.send_direct_message('pv_b', 'hello')) = 'hello', 'someone they follow can message them');
-- People change only their own privacy settings.
update public.profiles set who_can_message = 'nobody', hide_from_nearby = true where id = 'pv_c';
update public.profiles set who_can_message = 'nobody' where id = 'pv_a';
reset role;
select tests.ok((select who_can_message = 'nobody' and hide_from_nearby from public.profiles where id = 'pv_c'), 'a person sets their own privacy');
select tests.ok((select who_can_message = 'everyone' from public.profiles where id = 'pv_a'), 'nobody can change someone else''s privacy');
-- Muted notification groups are skipped; account notices can't be muted.
select set_config('request.jwt.claims', '{"sub":"pv_a"}', false);
set role authenticated;
select public.set_notification_muted('pk_battles', true);
select tests.fails($$select public.set_notification_muted('withdrawal', true)$$, '%not_mutable%', 'account and payment notices cannot be muted');
select tests.fails($$insert into public.notification_settings (user_id, muted) values ('pv_a', '{}')$$, '%permission denied%', 'settings change only through the function');
reset role;
select private.notify('pv_a', 'pk_battle_invite', 'PK', 'x');
select private.notify('pv_a', 'withdrawal', 'Paid', 'x');
select tests.ok((select count(*) from public.notifications where user_id = 'pv_a' and type = 'pk_battle_invite') = 0, 'a muted group is not delivered');
select tests.ok((select count(*) from public.notifications where user_id = 'pv_a' and type = 'withdrawal') = 1, 'account notices still arrive');
select set_config('request.jwt.claims', '{"sub":"pv_a"}', false);
set role authenticated;
select public.set_notification_muted('pk_battles', false);
reset role;
select private.notify('pv_a', 'pk_battle_invite', 'PK', 'x');
select tests.ok((select count(*) from public.notifications where user_id = 'pv_a' and type = 'pk_battle_invite') = 1, 'unmuting brings it back');
select set_config('request.headers', '', false);

-- PK invites "only from people I follow"; display privacy switches are the owner's own to change.
insert into public.profiles (id, username) values ('pv_h1', 'pv_h1'), ('pv_h2', 'pv_h2');
insert into public.hosts (user_id) values ('pv_h1'), ('pv_h2');
insert into public.rooms (host_id, status, cover_url) values ('pv_h1', 'live', 'x'), ('pv_h2', 'live', 'x');
update public.profiles set pk_invites_followers_only = true where id = 'pv_h2';
select set_config('request.jwt.claims', '{"sub":"pv_h1"}', false);
set role authenticated;
select tests.fails($$select public.invite_pk_battle((select id from public.rooms where host_id = 'pv_h2'))$$, '%pk_invites_followers_only%', 'a stranger cannot send a PK invite to a followers-only host');
reset role;
insert into public.follows (follower_id, followee_id) values ('pv_h2', 'pv_h1');
select set_config('request.jwt.claims', '{"sub":"pv_h1"}', false);
set role authenticated;
select tests.ok((select status from public.invite_pk_battle((select id from public.rooms where host_id = 'pv_h2'))) = 'invited', 'a host they follow can invite them');
update public.profiles set hide_location = true, message_requests = false where id = 'pv_h1';
reset role;
select tests.ok((select hide_location and not message_requests from public.profiles where id = 'pv_h1'), 'a person sets their own display privacy');
-- Leave no battle behind (later test files expect a clean pk_battles table).
update public.rooms set current_battle_id = null where host_id in ('pv_h1', 'pv_h2');
delete from public.pk_battles where room_a_id in (select id from public.rooms where host_id in ('pv_h1', 'pv_h2'));
select set_config('request.headers', '', false);

-- Birthday: set once; under-18s are restricted everywhere and can't buy diamonds.
insert into public.profiles (id, username) values ('ag_adult', 'ag_adult'), ('ag_minor', 'ag_minor');
select set_config('request.jwt.claims', '{"sub":"ag_adult"}', false);
set role authenticated;
select tests.fails($$select public.set_birth_date((current_date + 1))$$, '%invalid_birth_date%', 'a future birth date is refused');
select tests.ok(public.set_birth_date(date '1990-05-01') = 'adult', 'an adult is marked adult');
select tests.fails($$select public.set_birth_date(date '1980-01-01')$$, '%birth_date_already_set%', 'the birth date can be given only once');
select tests.fails($$update public.profiles set age_check = 'adult' where id = 'ag_adult'$$, '%permission denied%', 'nobody can set their own age result');
select tests.fails($$select * from private.birthdates$$, '%permission denied%', 'birth dates are private');
reset role;
select set_config('request.jwt.claims', '{"sub":"ag_minor"}', false);
set role authenticated;
select tests.ok(public.set_birth_date((current_date - interval '15 years')::date) = 'minor', 'a 15-year-old is marked minor');
select tests.fails($$select public.send_direct_message('ag_adult', 'hi')$$, '%account_restricted%', 'a minor cannot use messages');
reset role;
select tests.ok(public.user_status('ag_minor') = 'restricted' and public.user_status('ag_adult') = 'active', 'only the minor is restricted');
select tests.fails($$select public.internal_create_payment('ag_minor', (select id from public.coin_packages where active and region = private.user_region('ag_minor') limit 1))$$, '%under_18%', 'a minor cannot buy diamonds');

-- Interests: own profile only, known topics only.
select set_config('request.jwt.claims', '{"sub":"ag_adult"}', false);
set role authenticated;
update public.profiles set interests = '{music,gaming}' where id = 'ag_adult';
select tests.fails($$update public.profiles set interests = '{hacking}' where id = 'ag_adult'$$, '%check%', 'unknown interests are refused');
update public.profiles set interests = '{chat}' where id = 'ag_minor';
reset role;
select tests.ok((select interests = '{music,gaming}' from public.profiles where id = 'ag_adult'), 'a person sets their own interests');
select tests.ok((select interests = '{}' from public.profiles where id = 'ag_minor'), 'nobody sets someone else''s interests');

-- Fan club: join only yourself, only a host you follow; leave only yourself.
insert into public.profiles (id, username) values ('fc_host', 'fc_host'), ('fc_fan', 'fc_fan'), ('fc_other', 'fc_other');
insert into public.hosts (user_id) values ('fc_host');
select set_config('request.jwt.claims', '{"sub":"fc_fan"}', false);
set role authenticated;
select tests.fails($$insert into public.fan_club_members (host_id, user_id) values ('fc_host', 'fc_fan')$$, '%row-level security%', 'you must follow a host to join their fan club');
insert into public.follows (follower_id, followee_id) values ('fc_fan', 'fc_host');
insert into public.fan_club_members (host_id, user_id) values ('fc_host', 'fc_fan');
select tests.fails($$insert into public.fan_club_members (host_id, user_id) values ('fc_host', 'fc_other')$$, '%row-level security%', 'nobody can add someone else to a fan club');
select tests.fails($$insert into public.fan_club_members (host_id, user_id) values ('fc_other', 'fc_fan')$$, '%row-level security%', 'only hosts have fan clubs');
reset role;
insert into public.follows (follower_id, followee_id) values ('fc_other', 'fc_host');
insert into public.fan_club_members (host_id, user_id) values ('fc_host', 'fc_other');
select set_config('request.jwt.claims', '{"sub":"fc_fan"}', false);
set role authenticated;
delete from public.fan_club_members where user_id = 'fc_other';
reset role;
select tests.ok((select count(*) from public.fan_club_members where host_id = 'fc_host') = 2, 'nobody can remove someone else from a fan club');

-- Chat list options are private to their owner.
select set_config('request.jwt.claims', '{"sub":"fc_fan"}', false);
set role authenticated;
insert into public.dm_thread_prefs (user_id, other_id, pinned) values ('fc_fan', 'fc_host', true);
select tests.fails($$insert into public.dm_thread_prefs (user_id, other_id, muted) values ('fc_other', 'fc_host', true)$$, '%row-level security%', 'nobody can change someone else''s chat options');
reset role;
insert into public.dm_thread_prefs (user_id, other_id, muted) values ('fc_other', 'fc_fan', true);
select set_config('request.jwt.claims', '{"sub":"fc_fan"}', false);
set role authenticated;
select tests.ok((select count(*) from public.dm_thread_prefs) = 1, 'people see only their own chat options');
reset role;
select set_config('request.jwt.claims', '', false);

drop schema tests cascade;
