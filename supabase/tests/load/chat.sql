-- A viewer chats in a random live room.
\set uid random(1, :users)
\set hid random(1, :hosts)
begin;
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"u%s"}', :uid), true);
select loadtest.chat((select id from public.rooms where host_id = format('h%s', :hid)));
commit;
