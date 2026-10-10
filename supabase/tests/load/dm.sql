-- A viewer sends a direct message to a random host.
\set uid random(1, :users)
\set hid random(1, :hosts)
begin;
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"u%s"}', :uid), true);
select loadtest.dm(format('h%s', :hid));
commit;
