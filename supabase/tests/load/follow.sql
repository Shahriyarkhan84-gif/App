-- A viewer follows or unfollows a random host (RLS insert policy with block checks).
\set uid random(1, :users)
\set hid random(1, :hosts)
begin;
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"u%s"}', :uid), true);
select loadtest.follow(format('h%s', :hid));
commit;
