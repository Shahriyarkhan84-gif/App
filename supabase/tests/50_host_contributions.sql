-- Host contributions: per-period ranking of gifters, overall since the host joined hosting.
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

insert into public.profiles (id, username, display_name) values ('hc_host', 'hc_host', 'Host'), ('hc_a', 'hc_a', 'Ali'), ('hc_b', 'hc_b', 'Bina'), ('hc_c', 'hc_c', 'Cyrus');
insert into public.hosts (user_id, created_at) values ('hc_host', now() - interval '90 days');
insert into public.rooms (host_id) values ('hc_host');
update public.hosts set created_at = now() - interval '90 days' where user_id = 'hc_host';

-- Ali: today 100; Bina: 40 days ago 5000 (overall only); Cyrus: 2 days ago 300 (week or month depending on the day).
insert into public.gifts (room_id, sender_id, host_id, gift_id, quantity, coins_total, host_share, stream_share, owner_share, idempotency_key, created_at)
select r.id, x.s, 'hc_host', (select min(id) from public.gift_catalog), 1, x.c, x.c, 0, 0, x.k, x.t
from public.rooms r, (values ('hc_a', 100, 'k1', now()), ('hc_b', 5000, 'k2', now() - interval '40 days'), ('hc_c', 300, 'k3', now() - interval '2 days'),
  ('hc_b', 1, 'k4', now() - interval '200 days')) as x(s, c, k, t)
where r.host_id = 'hc_host';

select set_config('request.jwt.claims', '{"sub":"hc_c"}', false);
set role authenticated;
select tests.ok((select string_agg(user_id, ',' order by rank) from public.host_contributions('hc_host', 'day')) = 'hc_a', 'daily: only today');
select tests.ok((select user_id from public.host_contributions('hc_host', 'overall') where rank = 1) = 'hc_b', 'overall top 1');
select tests.ok((select coins from public.host_contributions('hc_host', 'overall') where user_id = 'hc_b') = 5000, 'overall counts only since joining hosting');
select tests.ok((select count(*) from public.host_contributions('hc_host', 'month')) between 1 and 2, 'monthly excludes older gifts');
select tests.ok(not exists (select 1 from public.host_contributions('hc_host', 'month') where user_id = 'hc_b'), 'monthly excludes 40-day-old gift');
select tests.fails($$select * from public.host_contributions('hc_host', 'year')$$, '%invalid_period%', 'bad period');
select tests.ok((select count(*) from public.host_contributions('hc_a', 'overall')) = 0, 'non-host has none');
reset role;
select set_config('request.jwt.claims', '{}', false);
set role anon;
select tests.fails($$select * from public.host_contributions('hc_host', 'day')$$, '%permission denied%', 'anon blocked');
reset role;

drop schema tests cascade;
