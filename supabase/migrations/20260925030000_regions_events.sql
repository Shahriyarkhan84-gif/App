-- Regional variants + engagement events (core architecture: Engagement layer →
-- Revenue split → … → Regional variants).
--
-- Regions: each market (PK, IN, BD, … GLOBAL) has its own currency, default
-- language, timezone, coin-package pricing and feature switches. A user's
-- region comes from profiles.signup_country (server-recorded, frozen) — never
-- from the user-editable profiles.country — so pricing can't be gamed.
-- internal_create_payment() refuses a package from another region.
--
-- Events: time-boxed campaigns (gifting races, PK battle leagues), global or
-- per region. Scores are kept by triggers on the ledgered gift and battle
-- paths (send_gift() itself is untouched); leaderboards are read-only RPCs;
-- only platform admins create or finalize events. Rewards are recorded and
-- announced; anything paid out in coins goes through the owner, not here.

-- Regions --------------------------------------------------------------------

create table public.regions (
  code text primary key check (code ~ '^[A-Z]{2,6}$'),
  name text not null,
  countries text[] not null default '{}',
  currency text not null check (currency ~ '^[a-z]{3}$'),
  default_language text not null,
  languages text[] not null,
  timezone text not null,
  features jsonb not null default '{}',
  active boolean not null default false,
  sort int not null default 0
);

insert into public.regions (code, name, countries, currency, default_language, languages, timezone, active, sort, features) values
  ('PK', 'Pakistan', '{PK}', 'pkr', 'ur', '{ur,en}', 'Asia/Karachi', true, 1, '{"pk_battles": true, "uploads": true, "withdrawals": true}'),
  ('IN', 'India', '{IN}', 'inr', 'hi', '{hi,en,bn}', 'Asia/Kolkata', true, 2, '{"pk_battles": true, "uploads": true, "withdrawals": false}'),
  ('BD', 'Bangladesh', '{BD}', 'bdt', 'bn', '{bn,en}', 'Asia/Dhaka', true, 3, '{"pk_battles": true, "uploads": true, "withdrawals": false}'),
  ('ID', 'Indonesia', '{ID}', 'idr', 'id', '{id,en}', 'Asia/Jakarta', false, 4, '{}'),
  ('MY', 'Malaysia', '{MY}', 'myr', 'ms', '{ms,en}', 'Asia/Kuala_Lumpur', false, 5, '{}'),
  ('TR', 'Türkiye', '{TR}', 'try', 'tr', '{tr,en}', 'Europe/Istanbul', false, 6, '{}'),
  ('GULF', 'Gulf', '{AE,SA,QA,KW,BH,OM}', 'aed', 'ar', '{ar,ur,en,hi}', 'Asia/Dubai', false, 7, '{}'),
  ('PH', 'Philippines', '{PH}', 'php', 'fil', '{fil,en}', 'Asia/Manila', false, 8, '{}'),
  ('NP', 'Nepal', '{NP}', 'npr', 'ne', '{ne,en,hi}', 'Asia/Kathmandu', false, 9, '{}'),
  -- Everyone else (UK and the rest of the world) and inactive markets.
  ('GLOBAL', 'Global', '{}', 'usd', 'en', '{en,ur,hi,bn}', 'UTC', true, 99, '{"pk_battles": true, "uploads": true, "withdrawals": false}');

-- Active region containing the country, else GLOBAL.
create or replace function private.region_for_country(p_country text)
returns text language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select code from public.regions where active and code <> 'GLOBAL' and upper(p_country) = any(countries) order by sort limit 1),
    'GLOBAL')
$$;

create or replace function private.user_region(p_user text)
returns text language sql stable security definer set search_path = ''
as $$ select private.region_for_country((select signup_country from public.profiles where id = p_user)) $$;

-- The caller's region (anonymous callers get GLOBAL).
create or replace function public.my_region()
returns public.regions language sql stable security definer set search_path = ''
as $$ select * from public.regions where code = private.user_region(public.requesting_user_id()) $$;

-- Regional pricing ---------------------------------------------------------------

alter table public.coin_packages add column region text not null default 'PK' references public.regions(code);
alter table public.coin_packages alter column region drop default;

insert into public.coin_packages (name, coins, price_minor, currency, sort, region) values
  -- India (paise)
  ('Starter', 140, 7900, 'inr', 1, 'IN'), ('Popular', 350, 19900, 'inr', 2, 'IN'), ('Value', 700, 39900, 'inr', 3, 'IN'),
  ('Big', 2000, 99900, 'inr', 4, 'IN'), ('Mega', 7000, 329900, 'inr', 5, 'IN'),
  -- Bangladesh (poisha)
  ('Starter', 140, 11000, 'bdt', 1, 'BD'), ('Popular', 350, 27500, 'bdt', 2, 'BD'), ('Value', 700, 55000, 'bdt', 3, 'BD'),
  ('Big', 2000, 150000, 'bdt', 4, 'BD'), ('Mega', 7000, 500000, 'bdt', 5, 'BD'),
  -- Global (cents)
  ('Starter', 140, 199, 'usd', 1, 'GLOBAL'), ('Popular', 350, 499, 'usd', 2, 'GLOBAL'), ('Value', 700, 999, 'usd', 3, 'GLOBAL'),
  ('Big', 2000, 2699, 'usd', 4, 'GLOBAL'), ('Mega', 7000, 8999, 'usd', 5, 'GLOBAL');

-- Signed-in users see their own region's packages; anonymous (web landing) sees all.
drop policy "coin packages" on public.coin_packages;
create policy "coin packages public" on public.coin_packages for select to anon using (active);
create policy "coin packages for my region" on public.coin_packages for select to authenticated
  using (public.is_platform_admin() or (active and region = private.user_region(public.requesting_user_id())));

-- internal_create_payment: unchanged except the package must be in the buyer's region.
create or replace function public.internal_create_payment(p_user text, p_package_id int)
returns public.payments language plpgsql security definer set search_path = ''
as $$
declare v_pkg public.coin_packages; v_row public.payments;
begin
  select * into v_pkg from public.coin_packages where id = p_package_id and active;
  if not found then raise exception 'invalid_package'; end if;
  if v_pkg.region <> private.user_region(p_user) then raise exception 'invalid_package'; end if;
  if public.user_status(p_user) = 'banned' then raise exception 'account_restricted'; end if;
  insert into public.payments (user_id, package_id, coins, amount_minor, currency)
  values (p_user, v_pkg.id, v_pkg.coins, v_pkg.price_minor, v_pkg.currency)
  returning * into v_row;
  return v_row;
end $$;

-- Gift catalog: optionally limited to regions (null = everywhere). This is
-- presentation only: price still comes from the catalog in send_gift().
alter table public.gift_catalog add column regions text[];
drop policy "gift catalog" on public.gift_catalog;
create policy "gift catalog" on public.gift_catalog for select to anon, authenticated
  using (public.is_platform_admin()
         or (active and (regions is null or private.user_region(public.requesting_user_id()) = any(regions))));

-- Events ---------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 80),
  description text check (char_length(description) <= 1000),
  kind text not null check (kind in ('gifting', 'pk_battle')),
  region text references public.regions(code),          -- null = global
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  gift_ids int[],                                        -- gifting: qualifying gifts (null = all)
  rewards jsonb not null default '[]',                   -- [{"role","rank_from","rank_to","reward"}]
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'cancelled', 'finalized')),
  created_by text references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '62 days')
);
create index events_active_idx on public.events (starts_at, ends_at) where status = 'scheduled';

create table public.event_scores (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('host', 'gifter')),
  score bigint not null default 0 check (score >= 0),
  updated_at timestamptz not null default now(),
  primary key (event_id, role, user_id)
);
create index event_scores_rank_idx on public.event_scores (event_id, role, score desc);

create table public.event_results (
  event_id uuid not null references public.events(id) on delete cascade,
  role text not null check (role in ('host', 'gifter')),
  rank int not null check (rank > 0),
  user_id text not null references public.profiles(id) on delete cascade,
  score bigint not null,
  reward text,
  primary key (event_id, role, rank)
);

create or replace function private.validate_event_rewards(p_rewards jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p_rewards) = 'array'
     and jsonb_array_length(p_rewards) <= 20
     and not exists (
       select 1 from jsonb_array_elements(p_rewards) r
       where coalesce(r ->> 'role', '') not in ('host', 'gifter')
          or (r ->> 'rank_from') !~ '^[0-9]{1,3}$' or (r ->> 'rank_to') !~ '^[0-9]{1,3}$'
          or (r ->> 'rank_from')::int < 1 or (r ->> 'rank_to')::int < (r ->> 'rank_from')::int
          or char_length(coalesce(r ->> 'reward', '')) not between 1 and 120)
$$;

-- Platform admins create (p_id null) or edit an event; editing is only
-- allowed before it starts. p_publish moves a draft to scheduled.
create or replace function public.upsert_event(
  p_id uuid, p_title text, p_description text, p_kind text, p_region text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_gift_ids int[], p_rewards jsonb, p_publish boolean
)
returns public.events language plpgsql security definer set search_path = ''
as $$
declare v public.events;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if p_region is not null and not exists (select 1 from public.regions where code = p_region) then raise exception 'invalid_region'; end if;
  if not private.validate_event_rewards(coalesce(p_rewards, '[]')) then raise exception 'invalid_rewards'; end if;
  if p_gift_ids is not null and exists (select 1 from unnest(p_gift_ids) g where not exists (select 1 from public.gift_catalog c where c.id = g)) then
    raise exception 'invalid_gift';
  end if;
  if p_ends_at <= p_starts_at or p_ends_at <= now() then raise exception 'invalid_schedule'; end if;

  if p_id is null then
    insert into public.events (title, description, kind, region, starts_at, ends_at, gift_ids, rewards, status, created_by)
    values (trim(p_title), nullif(trim(p_description), ''), p_kind, p_region, p_starts_at, p_ends_at,
            case when p_kind = 'gifting' then p_gift_ids end, coalesce(p_rewards, '[]'),
            case when p_publish then 'scheduled' else 'draft' end, public.requesting_user_id())
    returning * into v;
  else
    select * into v from public.events where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    if v.status in ('cancelled', 'finalized') or (v.status = 'scheduled' and v.starts_at <= now()) then
      raise exception 'event_locked';
    end if;
    update public.events set title = trim(p_title), description = nullif(trim(p_description), ''), kind = p_kind,
      region = p_region, starts_at = p_starts_at, ends_at = p_ends_at,
      gift_ids = case when p_kind = 'gifting' then p_gift_ids end, rewards = coalesce(p_rewards, '[]'),
      status = case when p_publish then 'scheduled' else status end, updated_at = now()
      where id = p_id returning * into v;
  end if;
  perform private.audit('event_saved', 'event', v.id::text, jsonb_build_object('status', v.status, 'kind', v.kind, 'region', v.region));
  return v;
end $$;

create or replace function public.cancel_event(p_id uuid)
returns public.events language plpgsql security definer set search_path = ''
as $$
declare v public.events;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  update public.events set status = 'cancelled', updated_at = now()
    where id = p_id and status in ('draft', 'scheduled') returning * into v;
  if not found then raise exception 'not_found'; end if;
  perform private.audit('event_cancelled', 'event', v.id::text);
  return v;
end $$;

-- Snapshots the leaderboards, attaches rewards and notifies winners.
-- Admins may finalize any ended event; the worker finalizes due ones.
create or replace function private.finalize_event(p_id uuid)
returns public.events language plpgsql security definer set search_path = ''
as $$
declare v public.events; r record;
begin
  select * into v from public.events where id = p_id for update;
  if not found or v.status <> 'scheduled' then raise exception 'not_finalizable'; end if;
  if v.ends_at > now() then raise exception 'event_not_ended'; end if;

  insert into public.event_results (event_id, role, rank, user_id, score, reward)
  select s.event_id, s.role, s.rank, s.user_id, s.score,
         (select rw ->> 'reward' from jsonb_array_elements(v.rewards) rw
          where rw ->> 'role' = s.role and s.rank between (rw ->> 'rank_from')::int and (rw ->> 'rank_to')::int limit 1)
  from (select event_id, role, user_id, score,
               row_number() over (partition by role order by score desc, updated_at asc, user_id) as rank
        from public.event_scores where event_id = p_id and score > 0) s
  where s.rank <= 100;

  update public.events set status = 'finalized', finalized_at = now(), updated_at = now() where id = p_id returning * into v;
  for r in select * from public.event_results where event_id = p_id and reward is not null loop
    perform private.notify(r.user_id, 'event_reward', v.title,
      'You finished #' || r.rank || ' — ' || r.reward, jsonb_build_object('event_id', v.id, 'rank', r.rank, 'role', r.role));
  end loop;
  perform private.audit('event_finalized', 'event', v.id::text, '{}', case when public.requesting_user_id() is null then 'system' else 'user' end);
  return v;
end $$;

create or replace function public.finalize_event(p_id uuid)
returns public.events language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  return private.finalize_event(p_id);
end $$;

create or replace function public.internal_finalize_due_events()
returns int language plpgsql security definer set search_path = ''
as $$
declare r record; n int := 0;
begin
  for r in select id from public.events where status = 'scheduled' and ends_at <= now() order by ends_at limit 50 loop
    perform private.finalize_event(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Ranked leaderboard (public profile fields only).
create or replace function public.event_leaderboard(p_event_id uuid, p_role text, p_limit int default 50)
returns table (rank bigint, user_id text, display_name text, username text, avatar_url text, score bigint, reward text)
language sql stable security definer set search_path = ''
as $$
  with e as (select * from public.events where id = p_event_id and (status in ('scheduled', 'finalized') or public.is_platform_admin())),
  ranked as (
    select s.user_id, s.score, row_number() over (order by s.score desc, s.updated_at asc, s.user_id) as rank
    from public.event_scores s join e on e.id = s.event_id
    where s.role = p_role and s.score > 0
  )
  select r.rank, r.user_id, p.display_name, p.username, p.avatar_url, r.score,
         (select rw ->> 'reward' from e, jsonb_array_elements(e.rewards) rw
          where rw ->> 'role' = p_role and r.rank between (rw ->> 'rank_from')::int and (rw ->> 'rank_to')::int limit 1)
  from ranked r join public.profiles p on p.id = r.user_id
  where p.deleted_at is null
  order by r.rank
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

-- Scoring triggers -------------------------------------------------------------
-- Read the already-final gift / battle rows; never touch wallets or the ledger.

create or replace function private.event_score(p_event uuid, p_user text, p_role text, p_points bigint)
returns void language sql security definer set search_path = ''
as $$
  insert into public.event_scores (event_id, user_id, role, score) values (p_event, p_user, p_role, p_points)
  on conflict (event_id, role, user_id) do update set score = public.event_scores.score + excluded.score, updated_at = now()
$$;

create or replace function private.events_apply_gift()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare e record; v_region text;
begin
  if not exists (select 1 from public.events where status = 'scheduled' and kind = 'gifting' and now() >= starts_at and now() < ends_at) then
    return new;
  end if;
  v_region := private.user_region(new.host_id);
  for e in select id from public.events
           where status = 'scheduled' and kind = 'gifting' and now() >= starts_at and now() < ends_at
             and (region is null or region = v_region)
             and (gift_ids is null or new.gift_id = any(gift_ids)) loop
    perform private.event_score(e.id, new.host_id, 'host', new.coins_total);
    perform private.event_score(e.id, new.sender_id, 'gifter', new.coins_total);
  end loop;
  return new;
end $$;
create trigger events_gift_score after insert on public.gifts
  for each row execute function private.events_apply_gift();

-- PK battle leagues: win = 3 points, tie = 1 each.
create or replace function private.events_apply_battle()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare e record; v_host_a text; v_host_b text;
begin
  if new.status <> 'ended' or old.status = 'ended' then return new; end if;
  select host_id into v_host_a from public.rooms where id = new.room_a_id;
  select host_id into v_host_b from public.rooms where id = new.room_b_id;
  for e in select id, region from public.events
           where status = 'scheduled' and kind = 'pk_battle' and new.started_at >= starts_at and new.started_at < ends_at loop
    if new.winner_room_id is null then
      if e.region is null or private.user_region(v_host_a) = e.region then perform private.event_score(e.id, v_host_a, 'host', 1); end if;
      if e.region is null or private.user_region(v_host_b) = e.region then perform private.event_score(e.id, v_host_b, 'host', 1); end if;
    else
      declare v_winner text := case when new.winner_room_id = new.room_a_id then v_host_a else v_host_b end;
      begin
        if e.region is null or private.user_region(v_winner) = e.region then perform private.event_score(e.id, v_winner, 'host', 3); end if;
      end;
    end if;
  end loop;
  return new;
end $$;
create trigger events_battle_score after update of status on public.pk_battles
  for each row execute function private.events_apply_battle();

-- Access ------------------------------------------------------------------------

revoke all on public.regions, public.events, public.event_scores, public.event_results from anon, authenticated;
grant select on public.regions to anon, authenticated;
grant select on public.events, public.event_scores, public.event_results to authenticated;
alter table public.regions enable row level security;
alter table public.events enable row level security;
alter table public.event_scores enable row level security;
alter table public.event_results enable row level security;

create policy "regions public" on public.regions for select to anon, authenticated using (true);
create policy "published events" on public.events for select to authenticated
  using (status in ('scheduled', 'finalized') or public.is_platform_admin());
create policy "event scores of published events" on public.event_scores for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id));
create policy "event results public" on public.event_results for select to authenticated using (true);

do $$
declare f text;
begin
  foreach f in array array[
    'public.my_region()', 'public.event_leaderboard(uuid, text, int)', 'public.finalize_event(uuid)', 'public.cancel_event(uuid)',
    'public.upsert_event(uuid, text, text, text, text, timestamptz, timestamptz, int[], jsonb, boolean)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant execute on function public.my_region() to anon;
revoke execute on function public.internal_finalize_due_events() from public, anon, authenticated;
grant execute on function public.internal_finalize_due_events() to service_role;
revoke execute on function public.internal_create_payment(text, int) from public, anon, authenticated;
grant execute on function public.internal_create_payment(text, int) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.event_scores;
  end if;
end $$;
