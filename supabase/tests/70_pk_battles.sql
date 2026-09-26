-- PK battles: invite/accept/decline authorization, live-score tallying via the
-- gifts trigger, and end-of-battle winner resolution.
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
grant execute on all functions in schema tests to anon, authenticated, service_role;

insert into public.profiles (id, username, display_name) values
  ('pk_host_a', 'pk_host_a', 'Host A'), ('pk_host_b', 'pk_host_b', 'Host B'),
  ('pk_host_c', 'pk_host_c', 'Host C'), ('pk_viewer', 'pk_viewer', 'Viewer');
insert into public.hosts (user_id) values ('pk_host_a'), ('pk_host_b'), ('pk_host_c');
-- a and b are live; c is a host but offline.
insert into public.rooms (host_id, status, cover_url) values
  ('pk_host_a', 'live', 'https://cdn.test/a.jpg'), ('pk_host_b', 'live', 'https://cdn.test/b.jpg'), ('pk_host_c', 'offline', null);
insert into public.wallets (user_id, coin_balance) values ('pk_viewer', 100000);

---------------------------------------------------------------------------------------
-- Only a live host can invite, and only to another live, un-battling room
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"pk_viewer"}', false);
set role authenticated;
select tests.fails($$select public.invite_pk_battle((select id from public.rooms where host_id = 'pk_host_b'))$$, '%not_live%', 'non-host cannot invite');
reset role;

select set_config('request.jwt.claims', '{"sub":"pk_host_c"}', false);
set role authenticated;
select tests.fails($$select public.invite_pk_battle((select id from public.rooms where host_id = 'pk_host_b'))$$, '%not_live%', 'offline host cannot invite');
reset role;

select set_config('request.jwt.claims', '{"sub":"pk_host_a"}', false);
set role authenticated;
select tests.fails($$select public.invite_pk_battle((select id from public.rooms where host_id = 'pk_host_a'))$$, '%cannot_battle_self%', 'cannot battle own room');
select tests.fails($$select public.invite_pk_battle((select id from public.rooms where host_id = 'pk_host_c'))$$, '%target_not_live%', 'cannot battle an offline room');
select public.invite_pk_battle((select id from public.rooms where host_id = 'pk_host_b'));
select tests.ok((select current_battle_id from public.rooms where host_id = 'pk_host_a') is not null, 'challenger room marked in-battle');
select tests.ok((select status from public.pk_battles where room_a_id = (select id from public.rooms where host_id = 'pk_host_a')) = 'invited', 'battle starts invited');
select tests.fails($$select public.invite_pk_battle((select id from public.rooms where host_id = 'pk_host_b'))$$, '%already_in_battle%', 'already-battling room cannot invite again');
reset role;

---------------------------------------------------------------------------------------
-- Only the challenged host can respond; a stranger cannot accept on their behalf
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"pk_host_c"}', false);
set role authenticated;
select tests.fails($$select public.respond_pk_battle((select id from public.pk_battles limit 1), true)$$, '%forbidden%', 'wrong host cannot accept');
reset role;

select set_config('request.jwt.claims', '{"sub":"pk_host_b"}', false);
set role authenticated;
select public.respond_pk_battle((select id from public.pk_battles limit 1), true);
reset role;
select tests.ok((select status from public.pk_battles limit 1) = 'live', 'battle goes live on accept');
select tests.ok((select ends_at from public.pk_battles limit 1) > now(), 'battle has an end time');

---------------------------------------------------------------------------------------
-- Gifts to either side tally onto that side's score automatically
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"pk_viewer"}', false);
set role authenticated;
-- Heart (id 3) = 10 coins.
select public.send_gift((select id from public.rooms where host_id = 'pk_host_a'), 3, 5, 'pk-gift-a-1');
select public.send_gift((select id from public.rooms where host_id = 'pk_host_b'), 3, 2, 'pk-gift-b-1');
reset role;
select tests.ok((select score_a from public.pk_battles limit 1) = 50, 'gifts to room A tally score_a');
select tests.ok((select score_b from public.pk_battles limit 1) = 20, 'gifts to room B tally score_b');

---------------------------------------------------------------------------------------
-- Ending: only a participant (or admin) before the clock runs out; winner = higher score
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"pk_host_c"}', false);
set role authenticated;
select tests.fails($$select public.end_pk_battle((select id from public.pk_battles limit 1))$$, '%forbidden%', 'non-participant cannot end early');
reset role;

select set_config('request.jwt.claims', '{"sub":"pk_host_a"}', false);
set role authenticated;
select public.end_pk_battle((select id from public.pk_battles limit 1));
reset role;
select tests.ok((select status from public.pk_battles limit 1) = 'ended', 'battle ends');
select tests.ok((select winner_room_id from public.pk_battles limit 1) = (select id from public.rooms where host_id = 'pk_host_a'), 'higher score wins');
select tests.ok((select current_battle_id from public.rooms where host_id = 'pk_host_a') is null, 'room A freed after battle');
select tests.ok((select current_battle_id from public.rooms where host_id = 'pk_host_b') is null, 'room B freed after battle');
select tests.fails($$select public.end_pk_battle((select id from public.pk_battles limit 1))$$, '%not_live%', 'cannot end an already-ended battle');

---------------------------------------------------------------------------------------
-- Decline frees both rooms without going live
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"pk_host_a"}', false);
set role authenticated;
select public.invite_pk_battle((select id from public.rooms where host_id = 'pk_host_b'));
reset role;
select set_config('request.jwt.claims', '{"sub":"pk_host_b"}', false);
set role authenticated;
select public.respond_pk_battle((select id from public.pk_battles where status = 'invited' limit 1), false);
reset role;
select tests.ok((select count(*) from public.pk_battles where status = 'declined') = 1, 'decline recorded');
select tests.ok((select current_battle_id from public.rooms where host_id = 'pk_host_a') is null, 'room A freed after decline');
select tests.ok((select current_battle_id from public.rooms where host_id = 'pk_host_b') is null, 'room B freed after decline');

---------------------------------------------------------------------------------------
-- Anon is blocked outright
---------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{}', false);
set role anon;
select tests.fails($$select public.invite_pk_battle((select id from public.rooms where host_id = 'pk_host_b'))$$, '%permission denied%', 'anon cannot invite');
select tests.fails($$select * from public.pk_battles$$, '%permission denied%', 'anon cannot read battles');
reset role;

drop schema tests cascade;
