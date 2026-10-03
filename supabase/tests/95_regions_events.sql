-- Regional variants + engagement events: region resolution, regional catalog,
-- admin-only event lifecycle, trigger-kept scores, leaderboards, finalization.
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;
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
create function tests.event(p_title text) returns uuid language sql security definer
as $$ select id from public.events where title = p_title $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

insert into public.profiles (id, username, display_name, signup_country) values
  ('ev_pk_host', 'ev_pk_host', 'PK Host', 'PK'), ('ev_in_host', 'ev_in_host', 'IN Host', 'IN'),
  ('ev_fan', 'ev_fan', 'Fan', 'PK'), ('ev_fan2', 'ev_fan2', 'Fan 2', 'GB'),
  ('ev_id_user', 'ev_id_user', 'Jakarta', 'ID'), ('ev_new', 'ev_new', 'No country', null),
  ('ev_admin', 'ev_admin', 'Admin', 'PK');
update public.profiles set role = 'OWNER_ADMIN' where id = 'ev_admin';
insert into public.hosts (user_id) values ('ev_pk_host'), ('ev_in_host');
insert into public.rooms (host_id, status, cover_url) values
  ('ev_pk_host', 'live', 'https://cdn.test/a.jpg'), ('ev_in_host', 'live', 'https://cdn.test/b.jpg');
insert into public.wallets (user_id, coin_balance) values ('ev_fan', 100000), ('ev_fan2', 100000);

---------------------------------------------------------------------------------------
-- Regions
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"ev_in_host"}', false);
set role authenticated;
select tests.ok((public.my_region()).code = 'IN', 'IN sign-up → India');
select tests.ok((public.my_region()).currency = 'inr', 'India prices in INR');
select tests.ok((select bool_and(currency = 'inr') from public.coin_packages), 'IN user sees INR packages only');
reset role;
select set_config('request.jwt.claims', '{"sub":"ev_fan2"}', false);
set role authenticated;
select tests.ok((public.my_region()).code = 'GLOBAL', 'UK → Global');
reset role;
select set_config('request.jwt.claims', '{"sub":"ev_id_user"}', false);
set role authenticated;
select tests.ok((public.my_region()).code = 'GLOBAL', 'inactive market (Indonesia) falls back to Global');
reset role;
select set_config('request.jwt.claims', '{"sub":"ev_new"}', false);
set role authenticated;
select tests.ok((public.my_region()).code = 'GLOBAL', 'unknown country → Global');
reset role;
-- Activating a market moves its users there.
update public.regions set active = true where code = 'ID';
select set_config('request.jwt.claims', '{"sub":"ev_id_user"}', false);
set role authenticated;
select tests.ok((public.my_region()).code = 'ID', 'activated market picks up its users');
reset role;
update public.regions set active = false where code = 'ID';

-- Regional gift catalog (presentation only).
update public.gift_catalog set regions = '{IN}' where name = 'Palace';
select set_config('request.jwt.claims', '{"sub":"ev_fan"}', false);
set role authenticated;
select tests.ok(not exists (select 1 from public.gift_catalog where name = 'Palace'), 'IN-only gift hidden in PK');
select tests.fails($$update public.regions set active = true$$, '%permission denied%', 'regions not client-writable');
reset role;
select set_config('request.jwt.claims', '{"sub":"ev_in_host"}', false);
set role authenticated;
select tests.ok(exists (select 1 from public.gift_catalog where name = 'Palace'), 'IN-only gift shown in IN');
reset role;
update public.gift_catalog set regions = null where name = 'Palace';

---------------------------------------------------------------------------------------
-- Event lifecycle (admin only)
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"ev_fan"}', false);
set role authenticated;
select tests.fails($$select public.upsert_event(null, 'Hacked', null, 'gifting', null, now(), now() + interval '1 day', null, '[]', true)$$, '%forbidden%', 'non-admin cannot create');
reset role;

select set_config('request.jwt.claims', '{"sub":"ev_admin"}', false);
set role authenticated;
select tests.fails($$select public.upsert_event(null, 'Bad', null, 'gifting', 'XX', now(), now() + interval '1 day', null, '[]', true)$$, '%invalid_region%', 'region checked');
select tests.fails($$select public.upsert_event(null, 'Bad', null, 'gifting', null, now(), now() - interval '1 day', null, '[]', true)$$, '%invalid_schedule%', 'end after start');
select tests.fails($$select public.upsert_event(null, 'Bad', null, 'gifting', null, now(), now() + interval '1 day', null, '[{"role": "host", "rank_from": 3, "rank_to": 1, "reward": "x"}]', true)$$, '%invalid_rewards%', 'rewards validated');
select tests.fails($$select public.upsert_event(null, 'Bad', null, 'gifting', null, now(), now() + interval '1 day', '{9999}', '[]', true)$$, '%invalid_gift%', 'gift ids validated');
-- PK-only gifting race on Hearts (id 3), plus a global battle league and a draft.
select public.upsert_event(null, 'Eid Gifting Race', 'Send Hearts!', 'gifting', 'PK', now() - interval '1 minute', now() + interval '3 days', '{3}',
  '[{"role": "host", "rank_from": 1, "rank_to": 1, "reward": "Home banner for a week"}, {"role": "gifter", "rank_from": 1, "rank_to": 3, "reward": "Eid badge"}]', true);
select public.upsert_event(null, 'Battle League', null, 'pk_battle', null, now() - interval '1 minute', now() + interval '7 days', null, '[]', true);
select public.upsert_event(null, 'Secret draft', null, 'gifting', null, now() + interval '1 day', now() + interval '2 days', null, '[]', false);
reset role;
select tests.ok(exists (select 1 from public.audit_logs where action = 'event_saved' and actor_id = 'ev_admin'), 'event changes audited');
-- Running events are locked.
select set_config('request.jwt.claims', '{"sub":"ev_admin"}', false);
set role authenticated;
select tests.fails($$select public.upsert_event(tests.event('Eid Gifting Race'), 'Renamed', null, 'gifting', 'PK', now(), now() + interval '1 day', null, '[]', true)$$,
  '%event_locked%', 'cannot edit a running event');
reset role;

select set_config('request.jwt.claims', '{"sub":"ev_fan"}', false);
set role authenticated;
select tests.ok(not exists (select 1 from public.events where title = 'Secret draft'), 'drafts hidden from users');
select tests.ok(exists (select 1 from public.events where title = 'Eid Gifting Race'), 'published events visible');
reset role;

---------------------------------------------------------------------------------------
-- Scores come only from real gifts / battles
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"ev_fan"}', false);
set role authenticated;
select public.send_gift((select id from public.rooms where host_id = 'ev_pk_host'), 3, 5, 'ev-gift-00001'); -- 5 Hearts = 50 coins, qualifies
select public.send_gift((select id from public.rooms where host_id = 'ev_pk_host'), 1, 7, 'ev-gift-00002'); -- Roses: not a qualifying gift
select public.send_gift((select id from public.rooms where host_id = 'ev_in_host'), 3, 9, 'ev-gift-00003'); -- IN host: outside the PK event
select public.send_gift((select id from public.rooms where host_id = 'ev_pk_host'), 3, 5, 'ev-gift-00001'); -- retry: charged once, counted once
reset role;
select set_config('request.jwt.claims', '{"sub":"ev_fan2"}', false);
set role authenticated;
select public.send_gift((select id from public.rooms where host_id = 'ev_pk_host'), 3, 10, 'ev-gift-00004'); -- 100 coins
reset role;

select tests.ok((select score from public.event_scores where event_id = tests.event('Eid Gifting Race') and role = 'host' and user_id = 'ev_pk_host') = 150,
  'host score = qualifying coins received');
select tests.ok((select score from public.event_scores where event_id = tests.event('Eid Gifting Race') and role = 'gifter' and user_id = 'ev_fan') = 50,
  'gifter score = qualifying coins sent, retry not double counted');
select tests.ok(not exists (select 1 from public.event_scores where event_id = tests.event('Eid Gifting Race') and user_id = 'ev_in_host'),
  'other-region host not in a regional event');

select set_config('request.jwt.claims', '{"sub":"ev_fan"}', false);
set role authenticated;
select tests.ok((select array_agg(user_id order by rank) from public.event_leaderboard(tests.event('Eid Gifting Race'), 'gifter')) = '{ev_fan2,ev_fan}', 'gifter ranking');
select tests.ok((select reward from public.event_leaderboard(tests.event('Eid Gifting Race'), 'host') where rank = 1) = 'Home banner for a week', 'reward shown for rank');
select tests.ok(not exists (select 1 from public.event_leaderboard(tests.event('Secret draft'), 'host')), 'draft leaderboard hidden');
select tests.fails($$update public.event_scores set score = 999999$$, '%permission denied%', 'scores not client-writable');
reset role;

-- Battle league: win = 3, tie = 1.
insert into public.pk_battles (room_a_id, room_b_id, status, started_at, ends_at)
  values ((select id from public.rooms where host_id = 'ev_pk_host'), (select id from public.rooms where host_id = 'ev_in_host'), 'live', now(), now() + interval '3 minutes');
update public.pk_battles set score_a = 10, score_b = 5 where status = 'live';
update public.pk_battles set status = 'ended', ended_at = now(), winner_room_id = room_a_id where status = 'live';
insert into public.pk_battles (room_a_id, room_b_id, status, started_at, ends_at)
  values ((select id from public.rooms where host_id = 'ev_pk_host'), (select id from public.rooms where host_id = 'ev_in_host'), 'live', now(), now() + interval '3 minutes');
update public.pk_battles set status = 'ended', ended_at = now() where status = 'live';
select tests.ok((select score from public.event_scores where event_id = tests.event('Battle League') and user_id = 'ev_pk_host') = 4, 'winner 3 + tie 1');
select tests.ok((select score from public.event_scores where event_id = tests.event('Battle League') and user_id = 'ev_in_host') = 1, 'loser 0 + tie 1');

---------------------------------------------------------------------------------------
-- Finalization: only after the end, snapshot + reward notifications
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"ev_admin"}', false);
set role authenticated;
select tests.fails($$select public.finalize_event(tests.event('Eid Gifting Race'))$$, '%event_not_ended%', 'cannot finalize early');
reset role;
update public.events set starts_at = now() - interval '2 days', ends_at = now() - interval '1 second' where title = 'Eid Gifting Race';
set role service_role;
select tests.ok(public.internal_finalize_due_events() = 1, 'worker finalizes due events');
select tests.ok(public.internal_finalize_due_events() = 0, 'finalization is one-time');
reset role;
select tests.ok((select status from public.events where title = 'Eid Gifting Race') = 'finalized', 'event finalized');
select tests.ok((select user_id from public.event_results where event_id = tests.event('Eid Gifting Race') and role = 'host' and rank = 1) = 'ev_pk_host', 'host winner recorded');
select tests.ok((select count(*) from public.event_results where event_id = tests.event('Eid Gifting Race') and role = 'gifter' and reward = 'Eid badge') = 2, 'gifter top 3 rewarded');
select tests.ok(exists (select 1 from public.notifications where user_id = 'ev_pk_host' and type = 'event_reward'), 'winners notified');

-- Finalized events stop scoring.
select set_config('request.jwt.claims', '{"sub":"ev_fan"}', false);
set role authenticated;
select public.send_gift((select id from public.rooms where host_id = 'ev_pk_host'), 3, 1, 'ev-gift-00005');
reset role;
select tests.ok((select score from public.event_scores where event_id = tests.event('Eid Gifting Race') and role = 'host' and user_id = 'ev_pk_host') = 150, 'no scoring after the end');

select set_config('request.jwt.claims', '{"sub":"ev_admin"}', false);
set role authenticated;
select public.cancel_event(tests.event('Secret draft'));
select tests.fails($$select public.cancel_event(tests.event('Eid Gifting Race'))$$, '%not_found%', 'finalized event cannot be cancelled');
reset role;

drop schema tests cascade;
