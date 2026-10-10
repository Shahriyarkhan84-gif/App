-- Index check after a run: the AI coach's per-stream chat count, with and without messages_stream_idx.
\timing on
select count(*) as messages_total from public.messages;
\set sid `echo`
select stream_id as sid from public.messages group by stream_id order by count(*) desc limit 1 \gset
explain (analyze, costs off, timing off, summary on) select count(*) from public.messages m where m.stream_id = :'sid';
begin;
drop index public.messages_stream_idx;
explain (analyze, costs off, timing off, summary on) select count(*) from public.messages m where m.stream_id = :'sid';
rollback;
