-- Demo catalog using openly licensed Blender Foundation films and public test
-- HLS streams. Artwork uses placeholder images — replace with your own.
with v as (
  insert into public.videos (title, description, genres, release_year, duration_seconds, maturity_rating, poster_url, backdrop_url, is_premium, featured)
  values
    ('Big Buck Bunny', 'A giant, gentle rabbit takes revenge on three bullying rodents in this comedic animated short.', '{Animation,Comedy,Family}', 2008, 596, 'G', 'https://picsum.photos/seed/bigbuckbunny/400/600', 'https://picsum.photos/seed/bigbuckbunny-bd/1280/720', false, true),
    ('Sintel', 'A lonely young woman searches the world for the baby dragon she once rescued.', '{Animation,Fantasy,Adventure}', 2010, 888, 'PG-13', 'https://picsum.photos/seed/sintel/400/600', 'https://picsum.photos/seed/sintel-bd/1280/720', true, false),
    ('Tears of Steel', 'In a future Amsterdam, a group of scientists attempts to save the world from destructive robots.', '{Sci-Fi,Action}', 2012, 734, 'PG-13', 'https://picsum.photos/seed/tearsofsteel/400/600', 'https://picsum.photos/seed/tearsofsteel-bd/1280/720', true, false),
    ('Elephants Dream', 'Two men explore a strange, surreal machine world that may only exist in their minds.', '{Animation,Sci-Fi,Drama}', 2006, 654, 'PG', 'https://picsum.photos/seed/elephantsdream/400/600', 'https://picsum.photos/seed/elephantsdream-bd/1280/720', false, false),
    ('Apple Bipbop', 'A classic adaptive-bitrate test stream — handy for checking playback quality switching.', '{Documentary}', 2016, 1800, 'G', 'https://picsum.photos/seed/bipbop/400/600', 'https://picsum.photos/seed/bipbop-bd/1280/720', false, false)
  returning id, title
)
insert into public.video_streams (video_id, hls_url)
select id, case title
  when 'Big Buck Bunny' then 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
  when 'Sintel' then 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8'
  when 'Tears of Steel' then 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8'
  when 'Elephants Dream' then 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
  else 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8'
end
from v;
