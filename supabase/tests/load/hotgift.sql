-- Worst case: everyone gifting the SAME host at once (a viral PK battle).
\set uid random(1, :users)
begin;
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"u%s"}', :uid), true);
select loadtest.gift((select id from public.rooms where host_id = 'h1'), 1);
commit;
