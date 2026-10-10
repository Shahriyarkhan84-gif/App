-- Gifts flooding both sides of a live PK battle (h1 vs h2).
\set uid random(1, :users)
\set side random(1, 2)
begin;
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"u%s"}', :uid), true);
select loadtest.gift((select id from public.rooms where host_id = format('h%s', :side)), 1);
commit;
