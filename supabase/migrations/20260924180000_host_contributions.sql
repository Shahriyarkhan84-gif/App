-- Contributions on a host's public profile: who sent them the most coins
-- today / this week / this month (calendar periods, Pakistan time) and overall
-- since the host joined hosting. Read-only; shows public profile fields only.

create or replace function public.host_contributions(p_host text, p_period text default 'day')
returns table (rank bigint, user_id text, display_name text, username text, avatar_url text, user_number bigint, coins bigint, since timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_local timestamp := now() at time zone 'Asia/Karachi';
  v_joined timestamptz;
  v_since timestamptz;
begin
  if public.requesting_user_id() is null then raise exception 'not_authenticated'; end if;
  select h.created_at into v_joined from public.hosts h where h.user_id = p_host;
  if v_joined is null then return; end if;
  v_since := case p_period
    when 'day' then date_trunc('day', v_local) at time zone 'Asia/Karachi'
    when 'week' then date_trunc('week', v_local) at time zone 'Asia/Karachi'
    when 'month' then date_trunc('month', v_local) at time zone 'Asia/Karachi'
    when 'overall' then v_joined
    else null end;
  if v_since is null then raise exception 'invalid_period'; end if;
  v_since := greatest(v_since, v_joined);

  return query
    select row_number() over (order by sum(g.coins_total) desc, min(g.created_at)) as rank,
           g.sender_id, p.display_name, p.username, p.avatar_url, p.user_number,
           sum(g.coins_total)::bigint, v_since
    from public.gifts g
    join public.profiles p on p.id = g.sender_id and p.deleted_at is null
    where g.host_id = p_host and g.created_at >= v_since
    group by g.sender_id, p.display_name, p.username, p.avatar_url, p.user_number
    order by 7 desc, min(g.created_at)
    limit 50;
end $$;

revoke execute on function public.host_contributions(text, text) from public, anon;
grant execute on function public.host_contributions(text, text) to authenticated;
