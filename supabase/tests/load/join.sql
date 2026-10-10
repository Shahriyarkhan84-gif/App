-- LiveKit webhook: a viewer joins or leaves a random live room (service role).
\set uid random(1, :users)
\set hid random(1, :hosts)
\set n random(0, 5000)
select public.internal_viewer_event((select livekit_room from public.rooms where host_id = format('h%s', :hid)), format('u%s', :uid), random() < 0.6, :n);
