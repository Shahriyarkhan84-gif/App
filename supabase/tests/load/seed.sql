-- Load-test seed: :users viewers with coins, :hosts hosts live, followers. Plain Postgres (no PostgREST).
\set ON_ERROR_STOP 1
update public.platform_settings set value = jsonb_set(value, '{required_to_go_live}', 'false') where key = 'host_verification';

insert into public.profiles (id, username, display_name, country)
select 'u' || i, 'user' || i, 'User ' || i, (array['PK','PK','PK','IN','BD','AE'])[1 + i % 6]
from generate_series(1, :users) i;
insert into public.wallets (user_id, coin_balance)
select 'u' || i, 1000000 from generate_series(1, :users) i;

insert into public.profiles (id, username, display_name, country)
select 'h' || i, 'host' || i, 'Host ' || i, (array['PK','PK','IN','BD'])[1 + i % 4]
from generate_series(1, :hosts) i;
insert into public.wallets (user_id, coin_balance) select 'h' || i, 0 from generate_series(1, :hosts) i;
insert into public.hosts (user_id) select 'h' || i from generate_series(1, :hosts) i;
insert into public.rooms (host_id, cover_url) select 'h' || i, 'https://example.com/cover.jpg' from generate_series(1, :hosts) i;

-- Every host goes live through the real RPC (creates the room + stream).
do $$
declare r record;
begin
  for r in select user_id from public.hosts loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.user_id)::text, true);
    perform public.go_live('Live with ' || r.user_id, 'chat');
  end loop;
end $$;
update public.rooms set viewer_count = (random() * 5000)::int where status = 'live';

-- Each viewer follows ~10 random hosts.
insert into public.follows (follower_id, followee_id)
select distinct 'u' || u, 'h' || (1 + (random() * (:hosts - 1))::int)
from generate_series(1, :users) u, generate_series(1, 10)
on conflict do nothing;
analyze;

-- Wrappers so an expected refusal (e.g. chat "slow_down") is counted instead of stopping the simulated user.
create schema loadtest;
grant usage on schema loadtest to authenticated;
create unlogged table loadtest.errors (scenario text, error text, at timestamptz default clock_timestamp());
grant insert on loadtest.errors to authenticated;
create function loadtest.gift(p_room uuid, p_gift int) returns void language plpgsql as $$
begin
  perform public.send_gift(p_room, p_gift, 1, md5(random()::text || clock_timestamp()::text));
exception when others then insert into loadtest.errors (scenario, error) values ('gift', sqlerrm);
end $$;
create function loadtest.chat(p_room uuid) returns void language plpgsql as $$
begin
  perform public.send_chat_message(p_room, 'hello ' || md5(random()::text));
exception when others then insert into loadtest.errors (scenario, error) values ('chat', sqlerrm);
end $$;
grant execute on all functions in schema loadtest to authenticated;

-- A live PK battle between the two most-watched hosts (h1 vs h2), running for the whole test.
insert into public.pk_battles (room_a_id, room_b_id, status, started_at, ends_at)
select a.id, b.id, 'live', now(), now() + interval '2 hours'
from public.rooms a, public.rooms b where a.host_id = 'h1' and b.host_id = 'h2';
update public.rooms set current_battle_id = (select id from public.pk_battles limit 1) where host_id in ('h1', 'h2');

create function loadtest.dm(p_to text) returns void language plpgsql as $$
begin
  perform public.send_direct_message(p_to, 'hi ' || md5(random()::text));
exception when others then insert into loadtest.errors (scenario, error) values ('dm', sqlerrm);
end $$;
create function loadtest.follow(p_host text) returns void language plpgsql as $$
begin
  if random() < 0.5 then
    insert into public.follows (follower_id, followee_id) values (public.requesting_user_id(), p_host) on conflict do nothing;
  else
    delete from public.follows where follower_id = public.requesting_user_id() and followee_id = p_host;
  end if;
exception when others then insert into loadtest.errors (scenario, error) values ('follow', sqlerrm);
end $$;
grant execute on all functions in schema loadtest to authenticated;
