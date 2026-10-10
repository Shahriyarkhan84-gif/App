-- A viewer sends a gift to a random live room (money path: wallet lock, ledger, host earnings).
\set uid random(1, :users)
\set hid random(1, :hosts)
\set gift random(1, 5)
begin;
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"u%s"}', :uid), true);
select loadtest.gift((select id from public.rooms where host_id = format('h%s', :hid)), :gift);
commit;
