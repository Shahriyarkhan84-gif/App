-- Home / Party feed exactly as the app asks PostgREST for it (RLS on, as a signed-in viewer).
\set uid random(1, :users)
begin;
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"u%s"}', :uid), true);
select r.id, r.host_id, r.title, r.category, r.cover_url, r.status, r.viewer_count, r.current_stream_id, r.current_battle_id, r.updated_at, r.mode,
       p.id, p.display_name, p.username, p.avatar_url, p.country, p.verified_at, p.owner_verified_at, p.role
from public.rooms r left join public.hosts h on h.user_id = r.host_id left join public.profiles p on p.id = h.user_id
where r.status = 'live' order by r.viewer_count desc limit 200;
select followee_id from public.follows where follower_id = format('u%s', :uid);
commit;
