-- A viral live: everyone joining/leaving the same room (h1) at once.
\set uid random(1, :users)
\set n random(1000, 50000)
select public.internal_viewer_event((select livekit_room from public.rooms where host_id = 'h1'), format('u%s', :uid), random() < 0.6, :n);
