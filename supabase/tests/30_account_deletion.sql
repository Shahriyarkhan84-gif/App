-- Account deletion: only the service role can delete, personal data goes,
-- money records stay, pending withdrawals block it, and it's idempotent.

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

insert into public.profiles (id, username, display_name, bio, email, country)
  values ('del_a', 'del_a', 'Del A', 'hello', 'a@example.com', 'PK'), ('del_b', 'del_b', 'Del B', null, null, 'PK'),
         ('del_host', 'del_host', 'Del Host', null, null, 'PK');
insert into public.wallets (user_id, coin_balance) values ('del_a', 120), ('del_b', 0), ('del_host', 0);
insert into public.follows (follower_id, followee_id) values ('del_a', 'del_b'), ('del_b', 'del_a');
insert into public.direct_messages (sender_id, recipient_id, body) values ('del_a', 'del_b', 'hi there');
insert into public.notifications (user_id, type, title) values ('del_a', 'test', 'hello');
insert into public.hosts (user_id) values ('del_host');
insert into public.withdrawals (host_id, coins, amount_minor, payout_method) values ('del_host', 100, 5000, '{"type":"bank"}');

-- Clients (even the account owner) can't call it directly.
select set_config('request.jwt.claims', '{"sub":"del_a"}', false);
set role authenticated;
select tests.fails($$select public.internal_delete_account('del_a')$$, '%permission denied%', 'client deletes via RPC');
select tests.fails($$update public.profiles set deleted_at = now() where id = 'del_a'$$, '%permission denied%', 'client sets deleted_at');
reset role;

set role service_role;
select tests.ok((public.internal_delete_account('del_a') ->> 'deleted')::boolean, 'account deleted');
select tests.ok((public.internal_delete_account('del_a') ->> 'already')::boolean, 'second delete is a no-op');
select tests.fails($$select public.internal_delete_account('del_host')$$, '%withdrawal_pending%', 'pending withdrawal blocks deletion');
reset role;

select tests.ok((select display_name = 'Deleted user' and username is null and bio is null and email is null
                        and country is null and deleted_at is not null and status = 'banned'
                   from public.profiles where id = 'del_a'), 'profile anonymised');
select tests.ok((select count(*) from public.follows where 'del_a' in (follower_id, followee_id)) = 0, 'follows removed');
select tests.ok((select count(*) from public.direct_messages where 'del_a' in (sender_id, recipient_id)) = 0, 'DMs removed');
select tests.ok((select count(*) from public.notifications where user_id = 'del_a') = 0, 'notifications removed');
select tests.ok((select coin_balance from public.wallets where user_id = 'del_a') = 120, 'wallet record kept');
select tests.ok((select count(*) from public.audit_logs where action = 'account_deleted' and target_id = 'del_a') = 1, 'deletion audited');
select tests.ok((select deleted_at is null from public.profiles where id = 'del_host'), 'blocked account untouched');

drop schema tests cascade;
