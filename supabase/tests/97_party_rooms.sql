-- Party rooms: only the host (or a room admin while live) can seat people, seats
-- are capped by mode, clients can't write seats directly, and seats end with the live.
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
  ('pt_host', 'pt_host', 'Party Host'), ('pt_admin', 'pt_admin', 'Admin'),
  ('pt_g1', 'pt_g1', 'G1'), ('pt_g2', 'pt_g2', 'G2'), ('pt_g3', 'pt_g3', 'G3'), ('pt_g4', 'pt_g4', 'G4'),
  ('pt_g5', 'pt_g5', 'G5'), ('pt_g6', 'pt_g6', 'G6'), ('pt_g7', 'pt_g7', 'G7'), ('pt_kicked', 'pt_kicked', 'Kicked');
insert into public.hosts (user_id) values ('pt_host');
insert into public.rooms (host_id, status, cover_url) values ('pt_host', 'offline', 'https://cdn.test/p.jpg');
insert into public.room_admins (room_id, user_id) select id, 'pt_admin' from public.rooms where host_id = 'pt_host';
insert into public.room_bans (room_id, user_id, kind, created_by) select id, 'pt_kicked', 'kick', 'pt_host' from public.rooms where host_id = 'pt_host';
create temp table party as select id from public.rooms where host_id = 'pt_host';
grant select on party to authenticated;

-- A normal live has no seats.
select set_config('request.jwt.claims', '{"sub":"pt_g1"}', false);
set role authenticated;
select tests.fails($$select public.request_seat((select id from party))$$, '%not_a_party%', 'no seats in a normal live');
-- Only the host sets the mode.
select tests.fails($$select public.set_room_mode('video')$$, '%not_a_host%', 'viewer cannot set mode');
reset role;

select set_config('request.jwt.claims', '{"sub":"pt_host"}', false);
set role authenticated;
select public.set_room_mode('video');
select tests.fails($$select public.set_room_mode('karaoke')$$, '%invalid_mode%', 'unknown mode rejected');
reset role;
update public.rooms set status = 'live' where host_id = 'pt_host';
-- The room type is fixed while live.
select set_config('request.jwt.claims', '{"sub":"pt_host"}', false);
set role authenticated;
select tests.fails($$select public.set_room_mode('voice')$$, '%already_live%', 'cannot change mode mid-live');
select public.set_room_mode('video');
reset role;

-- Clients cannot write seats or requests directly.
select set_config('request.jwt.claims', '{"sub":"pt_g1"}', false);
set role authenticated;
select tests.fails($$insert into public.room_seats (room_id, seat, user_id) values ((select id from party), 1, 'pt_g1')$$, '%permission denied%', 'direct seat insert');
select tests.fails($$insert into public.seat_requests (room_id, user_id) values ((select id from party), 'pt_g1')$$, '%permission denied%', 'direct request insert');
select public.request_seat((select id from party));
-- A viewer cannot seat themselves or others.
select tests.fails($$select public.approve_seat((select id from party), 'pt_g1')$$, '%forbidden%', 'viewer cannot approve');
reset role;

-- Kicked users cannot ask for a seat.
select set_config('request.jwt.claims', '{"sub":"pt_kicked"}', false);
set role authenticated;
select tests.fails($$select public.request_seat((select id from party))$$, '%banned_from_room%', 'kicked user cannot request');
reset role;

-- Host approves g1 into seat 1; approval needs a request.
select set_config('request.jwt.claims', '{"sub":"pt_host"}', false);
set role authenticated;
select tests.ok(public.approve_seat((select id from party), 'pt_g1') = 1, 'first guest gets seat 1');
select tests.fails($$select public.approve_seat((select id from party), 'pt_g2')$$, '%no_request%', 'cannot seat someone who did not ask');
reset role;

-- A room admin can approve while live; video caps at 6 guests.
do $$
declare g text;
begin
  foreach g in array array['pt_g2', 'pt_g3', 'pt_g4', 'pt_g5', 'pt_g6', 'pt_g7'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', g)::text, false);
    set local role authenticated;
    perform public.request_seat((select id from party));
    reset role;
  end loop;
end $$;
select set_config('request.jwt.claims', '{"sub":"pt_admin"}', false);
set role authenticated;
select public.approve_seat((select id from party), u) from unnest(array['pt_g2', 'pt_g3', 'pt_g4', 'pt_g5', 'pt_g6']) u;
select tests.fails($$select public.approve_seat((select id from party), 'pt_g7')$$, '%seats_full%', 'video party holds 6 guests');
reset role;
select tests.ok((select count(*) from public.room_seats where room_id = (select id from party)) = 6, '6 seats taken');
-- Kicking a seated guest also frees their seat.
select set_config('request.jwt.claims', '{"sub":"pt_host"}', false);
set role authenticated;
select public.room_moderate((select id from party), 'pt_g6', 'kick', 10);
reset role;
select tests.ok(not exists (select 1 from public.room_seats where user_id = 'pt_g6'), 'kicked guest loses their seat');

-- Guests mute/leave only themselves; a viewer cannot remove a guest.
select set_config('request.jwt.claims', '{"sub":"pt_g1"}', false);
set role authenticated;
select public.set_seat_muted((select id from party), true);
select tests.fails($$select public.remove_from_seat((select id from party), 'pt_g2')$$, '%forbidden%', 'guest cannot remove another guest');
select public.leave_seat((select id from party));
reset role;
select tests.ok(not exists (select 1 from public.room_seats where user_id = 'pt_g1'), 'guest left seat');

-- Leaving the LiveKit room gives up the seat and the place in the queue.
select set_config('request.jwt.claims', '{"sub":"pt_g7"}', false);
set role authenticated;
select public.request_seat((select id from party));
reset role;
-- A seat given seconds ago survives the old connection leaving (the guest is reconnecting).
select public.internal_viewer_event((select livekit_room from public.rooms where host_id = 'pt_host'), 'pt_g2', false, 3);
select tests.ok(exists (select 1 from public.room_seats where user_id = 'pt_g2'), 'a just-given seat survives the reconnect');
update public.room_seats set created_at = now() - interval '1 minute' where user_id = 'pt_g2';
select public.internal_viewer_event((select livekit_room from public.rooms where host_id = 'pt_host'), 'pt_g2', false, 3);
select public.internal_viewer_event((select livekit_room from public.rooms where host_id = 'pt_host'), 'pt_g7', false, 2);
select tests.ok(not exists (select 1 from public.room_seats where user_id = 'pt_g2'), 'leaving the room frees the seat');
select tests.ok(not exists (select 1 from public.seat_requests where user_id = 'pt_g7'), 'leaving the room drops the request');

-- A room mute takes the guest off their seat; a muted user can't be seated.
select set_config('request.jwt.claims', '{"sub":"pt_host"}', false);
set role authenticated;
select public.room_moderate((select id from party), 'pt_g3', 'mute', 10);
reset role;
select tests.ok(not exists (select 1 from public.room_seats where user_id = 'pt_g3'), 'muted guest loses their seat');
insert into public.seat_requests (room_id, user_id) select id, 'pt_g3' from party;
select set_config('request.jwt.claims', '{"sub":"pt_host"}', false);
set role authenticated;
select tests.fails($$select public.approve_seat((select id from party), 'pt_g3')$$, '%muted_in_room%', 'muted user cannot be seated');
reset role;

-- A restricted room admin can't moderate.
update public.profiles set status = 'restricted' where id = 'pt_admin';
select set_config('request.jwt.claims', '{"sub":"pt_admin"}', false);
set role authenticated;
select tests.fails($$select public.remove_from_seat((select id from party), 'pt_g3')$$, '%forbidden%', 'restricted admin cannot moderate');
reset role;

-- Seats end with the live.
select set_config('request.jwt.claims', '{"sub":"pt_g7"}', false);
set role authenticated;
select public.request_seat((select id from party));
reset role;
select set_config('request.jwt.claims', '{"sub":"pt_host"}', false);
set role authenticated;
select public.approve_seat((select id from party), 'pt_g7');
reset role;
update public.rooms set status = 'offline' where host_id = 'pt_host';
select tests.ok(not exists (select 1 from public.room_seats where room_id = (select id from party)), 'seats cleared when the live ends');

drop table party;
drop schema tests cascade;
