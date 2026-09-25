-- Signup country: set once at profile creation, never editable afterwards.
create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'TEST FAILED: %', p_msg; end if;
end $$;
grant execute on all functions in schema tests to authenticated, service_role;

select set_config('request.jwt.claims', '{"sub":"sc_user"}', false);
set role authenticated;
select public.ensure_profile('Sara', 'pk');
select tests.ok((select signup_country from public.profiles where id = 'sc_user') = 'PK', 'country recorded at sign-up');
select public.ensure_profile('Sara', 'IN');
select tests.ok((select signup_country from public.profiles where id = 'sc_user') = 'PK', 'later sign-ins do not change it');
select tests.ok(not has_column_privilege('public.profiles', 'signup_country', 'UPDATE'), 'client cannot write signup_country');
reset role;
update public.profiles set signup_country = 'US' where id = 'sc_user';
select tests.ok((select signup_country from public.profiles where id = 'sc_user') = 'PK', 'frozen even for direct writes');

-- Edge country header wins over the device region.
select set_config('request.jwt.claims', '{"sub":"sc_user2"}', false);
select set_config('request.headers', '{"cf-ipcountry":"BD"}', false);
set role authenticated;
select public.ensure_profile('Rafi', 'PK');
reset role;
select tests.ok((select signup_country from public.profiles where id = 'sc_user2') = 'BD', 'edge country used when present');
select set_config('request.headers', '', false);

-- Junk region is ignored.
select set_config('request.jwt.claims', '{"sub":"sc_user3"}', false);
set role authenticated;
select public.ensure_profile('X', 'Pakistan!');
reset role;
select tests.ok((select signup_country is null from public.profiles where id = 'sc_user3'), 'invalid region ignored');

-- Deleting the account clears it.
set role service_role;
select public.internal_delete_account('sc_user');
reset role;
select tests.ok((select signup_country is null from public.profiles where id = 'sc_user'), 'deleted account loses signup country');

drop schema tests cascade;
