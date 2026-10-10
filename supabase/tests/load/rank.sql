-- Rankings screen (weekly top gifters) through the shared 60 s cache, as a signed-in viewer.
\set uid random(1, :users)
begin;
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"u%s"}', :uid), true);
select count(*) from public.get_rankings('gifter', 'week');
commit;
