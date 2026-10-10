-- Rankings cache. get_rankings used to add up every gift in the period (7 or 30 days) on each
-- call; now the result is kept for 60 s (15 s for the live-viewers list) and shared by everyone.
-- The first caller after it expires recomputes it; callers arriving while that runs get the
-- previous copy instead of piling on (advisory lock). Safe to run more than once.

create table if not exists private.rankings_cache (
  kind text not null,
  period text not null,
  computed_at timestamptz not null,
  rows jsonb not null,
  primary key (kind, period)
);
revoke all on private.rankings_cache from public, anon, authenticated;

-- The previous get_rankings body, unchanged (it now only runs on a cache miss).
create or replace function private.compute_rankings(p_kind text, p_period text)
returns table (rank bigint, subject_id text, label text, avatar_url text, score bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare v_since timestamptz := case p_period when 'day' then now() - interval '1 day'
  when 'month' then now() - interval '30 days' else now() - interval '7 days' end;
begin
  if p_kind = 'gifter' then
    return query select row_number() over (order by sum(g.coins_total) desc), g.sender_id,
      coalesce(p.display_name, p.username, 'Viewer'), p.avatar_url, sum(g.coins_total)::bigint
      from public.gifts g join public.profiles p on p.id = g.sender_id
      where g.created_at >= v_since and p.deleted_at is null and p.status <> 'banned'
      group by g.sender_id, p.display_name, p.username, p.avatar_url
      order by 5 desc limit 50;
  elsif p_kind = 'creator' then
    return query select row_number() over (order by sum(g.coins_total) desc), g.host_id,
      coalesce(p.display_name, p.username, 'Host'), p.avatar_url, sum(g.coins_total)::bigint
      from public.gifts g join public.profiles p on p.id = g.host_id
      where g.created_at >= v_since and p.deleted_at is null and p.status <> 'banned'
      group by g.host_id, p.display_name, p.username, p.avatar_url
      order by 5 desc limit 50;
  elsif p_kind = 'country' then
    return query select row_number() over (order by sum(g.coins_total) desc), coalesce(p.country, '??'),
      coalesce(p.country, 'Unknown'), null::text, sum(g.coins_total)::bigint
      from public.gifts g join public.profiles p on p.id = g.host_id
      where g.created_at >= v_since group by p.country order by 5 desc limit 50;
  elsif p_kind = 'live' then
    return query select row_number() over (order by r.viewer_count desc), r.id::text, r.title,
      p.avatar_url, r.viewer_count::bigint
      from public.rooms r join public.profiles p on p.id = r.host_id
      where r.status = 'live' and p.status <> 'banned' order by r.viewer_count desc limit 50;
  else
    raise exception 'invalid_kind';
  end if;
end $$;
revoke execute on function private.compute_rankings(text, text) from public, anon, authenticated;

create or replace function public.get_rankings(p_kind text, p_period text default 'week')
returns table (rank bigint, subject_id text, label text, avatar_url text, score bigint)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_period text := case when p_period in ('day', 'month') then p_period else 'week' end;
  v_ttl interval := case when p_kind = 'live' then interval '15 seconds' else interval '60 seconds' end;
  v_hit private.rankings_cache;
  v_rows jsonb;
begin
  if p_kind not in ('gifter', 'creator', 'country', 'live') then raise exception 'invalid_kind'; end if;
  select * into v_hit from private.rankings_cache where kind = p_kind and period = v_period;
  if found and v_hit.computed_at > now() - v_ttl then
    v_rows := v_hit.rows;
  elsif pg_try_advisory_xact_lock(hashtext('rankings:' || p_kind || ':' || v_period)) then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.rank), '[]'::jsonb) into v_rows
      from private.compute_rankings(p_kind, v_period) r;
    insert into private.rankings_cache (kind, period, computed_at, rows) values (p_kind, v_period, now(), v_rows)
      on conflict (kind, period) do update set computed_at = excluded.computed_at, rows = excluded.rows;
  elsif found then
    v_rows := v_hit.rows; -- someone is recomputing right now: the previous copy is good enough
  else
    select coalesce(jsonb_agg(to_jsonb(r) order by r.rank), '[]'::jsonb) into v_rows
      from private.compute_rankings(p_kind, v_period) r;
  end if;
  return query select x.rank, x.subject_id, x.label, x.avatar_url, x.score
    from jsonb_to_recordset(v_rows) as x(rank bigint, subject_id text, label text, avatar_url text, score bigint)
    order by x.rank;
end $$;
revoke execute on function public.get_rankings(text, text) from public, anon;
grant execute on function public.get_rankings(text, text) to authenticated;
