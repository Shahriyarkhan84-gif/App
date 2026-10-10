-- Hot-row fix for gifts (load test, docs/LOAD_TEST.md): simultaneous gifts to one host used to queue
-- on that host's creator_earnings row, the live streams row, the PK battle row and the event score row.
-- Each gift now appends its amounts to private.gift_tallies (no row is shared, so nothing waits) and then
-- tries to fold all pending tallies into the total with SKIP LOCKED: if another gift is folding, it skips
-- instead of waiting, and that folder (or the next gift) picks its tally up. Wherever money or a result is
-- decided the tallies are folded exactly first: withdrawals, clawbacks, ending a stream or a PK battle,
-- finalizing an event. Totals shown in the app can trail by the gifts still in flight.

create table private.gift_tallies (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('earnings', 'stream', 'pk', 'event')),
  -- earnings: host id · stream: stream id · pk: battle id · event: event_id|role|user_id
  target text not null,
  a bigint not null default 0, -- earnings: diamonds · stream: gift_coins · pk: score_a · event: score
  b bigint not null default 0, -- stream: pool_coins · pk: score_b
  created_at timestamptz not null default now()
);
create index gift_tallies_target_idx on private.gift_tallies (kind, target);
revoke all on private.gift_tallies from public, anon, authenticated;

-- Folds a target's pending tallies into its total. p_wait = false never waits: if the total is locked
-- (someone else is folding or ending it) it returns and leaves the tallies for them.
create or replace function private.fold_tally(p_kind text, p_target text, p_wait boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_a bigint; v_b bigint; v_got boolean; v_parts text[]; v_live boolean;
begin
  if p_kind = 'earnings' then
    if p_wait then perform 1 from public.creator_earnings where host_id = p_target for update;
    else perform 1 from public.creator_earnings where host_id = p_target for update skip locked; end if;
    if not found then return; end if;
    with d as (delete from private.gift_tallies where kind = 'earnings' and target = p_target returning a)
      select coalesce(sum(a), 0) into v_a from d;
    if v_a <> 0 then
      update public.creator_earnings set balance = balance + v_a, lifetime = lifetime + v_a, updated_at = now() where host_id = p_target;
    end if;
  elsif p_kind = 'stream' then
    if p_wait then perform 1 from public.streams where id = p_target::uuid for update;
    else perform 1 from public.streams where id = p_target::uuid for update skip locked; end if;
    if not found then return; end if;
    with d as (delete from private.gift_tallies where kind = 'stream' and target = p_target returning a, b)
      select coalesce(sum(a), 0), coalesce(sum(b), 0) into v_a, v_b from d;
    if v_a <> 0 or v_b <> 0 then
      update public.streams set gift_coins = gift_coins + v_a, pool_coins = pool_coins + v_b where id = p_target::uuid;
    end if;
  elsif p_kind = 'pk' then
    if p_wait then select status = 'live' into v_live from public.pk_battles where id = p_target::uuid for update;
    else select status = 'live' into v_live from public.pk_battles where id = p_target::uuid for update skip locked; end if;
    if not found then return; end if;
    with d as (delete from private.gift_tallies where kind = 'pk' and target = p_target returning a, b)
      select coalesce(sum(a), 0), coalesce(sum(b), 0) into v_a, v_b from d;
    -- A battle that already ended keeps its final score (late gifts never counted before either).
    if v_live and (v_a <> 0 or v_b <> 0) then
      update public.pk_battles set score_a = score_a + v_a, score_b = score_b + v_b where id = p_target::uuid;
    end if;
  elsif p_kind = 'event' then
    v_parts := string_to_array(p_target, '|');
    insert into public.event_scores (event_id, role, user_id, score) values (v_parts[1]::uuid, v_parts[2], v_parts[3], 0)
      on conflict (event_id, role, user_id) do nothing;
    if p_wait then perform 1 from public.event_scores where event_id = v_parts[1]::uuid and role = v_parts[2] and user_id = v_parts[3] for update;
    else perform 1 from public.event_scores where event_id = v_parts[1]::uuid and role = v_parts[2] and user_id = v_parts[3] for update skip locked; end if;
    if not found then return; end if;
    with d as (delete from private.gift_tallies where kind = 'event' and target = p_target returning a)
      select coalesce(sum(a), 0) into v_a from d;
    if v_a <> 0 then
      update public.event_scores set score = score + v_a, updated_at = now()
        where event_id = v_parts[1]::uuid and role = v_parts[2] and user_id = v_parts[3];
    end if;
  end if;
end $$;

create or replace function private.fold_event_tallies(p_event uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare t text;
begin
  for t in select distinct target from private.gift_tallies where kind = 'event' and target like p_event::text || '|%' order by target loop
    perform private.fold_tally('event', t, true);
  end loop;
end $$;

-- Ending a battle or a stream folds its pending tallies into the row being ended (the ender already
-- holds that row's lock, so no other folder can race it) and decides the winner on the full score.
create or replace function private.pk_battle_fold_on_end()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_a bigint; v_b bigint;
begin
  with d as (delete from private.gift_tallies where kind = 'pk' and target = new.id::text returning a, b)
    select coalesce(sum(a), 0), coalesce(sum(b), 0) into v_a, v_b from d;
  if new.status = 'ended' then
    new.score_a := new.score_a + v_a;
    new.score_b := new.score_b + v_b;
    new.winner_room_id := case when new.score_a = new.score_b then null when new.score_a > new.score_b then new.room_a_id else new.room_b_id end;
  end if;
  return new;
end $$;
create trigger pk_battle_fold_on_end before update of status on public.pk_battles
  for each row when (old.status = 'live' and new.status <> 'live') execute function private.pk_battle_fold_on_end();

create or replace function private.stream_fold_on_end()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_a bigint; v_b bigint;
begin
  with d as (delete from private.gift_tallies where kind = 'stream' and target = new.id::text returning a, b)
    select coalesce(sum(a), 0), coalesce(sum(b), 0) into v_a, v_b from d;
  new.gift_coins := new.gift_coins + v_a;
  new.pool_coins := new.pool_coins + v_b;
  return new;
end $$;
create trigger stream_fold_on_end before update of ended_at on public.streams
  for each row when (old.ended_at is null and new.ended_at is not null) execute function private.stream_fold_on_end();

-- Gifts ----------------------------------------------------------------------------------------------
create or replace function public.send_gift(p_room_id uuid, p_gift_id int, p_quantity int, p_idempotency_key text)
returns public.gifts language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v_wallet public.wallets;
  v_existing public.gifts;
  v_room public.rooms;
  v_gift public.gift_catalog;
  v_split jsonb := private.setting('gift_split');
  v_total bigint;
  v_host bigint;
  v_owner bigint;
  v_stream bigint;
  v_row public.gifts;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 999 then raise exception 'invalid_quantity'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'invalid_idempotency_key';
  end if;

  -- The wallet row lock serializes all spends by this user, so a duplicate or
  -- concurrent retry waits here and then finds the first request's gift.
  v_wallet := private.lock_wallet(uid);

  select * into v_existing from public.gifts where sender_id = uid and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if v_wallet.frozen then raise exception 'wallet_frozen'; end if;

  select * into v_room from public.rooms where id = p_room_id;
  if not found or v_room.status <> 'live' then raise exception 'room_not_live'; end if;
  if v_room.host_id = uid then raise exception 'cannot_gift_self'; end if;
  if exists (select 1 from public.room_bans where room_id = p_room_id and user_id = uid
             and kind in ('kick', 'block') and (expires_at is null or expires_at > now())) then
    raise exception 'banned_from_room';
  end if;

  select * into v_gift from public.gift_catalog where id = p_gift_id and active;
  if not found then raise exception 'invalid_gift'; end if;

  v_total := v_gift.coin_price::bigint * p_quantity;
  if v_wallet.coin_balance < v_total then raise exception 'insufficient_coins'; end if;

  v_host := (v_total * (v_split ->> 'host_pct')::int) / 100;
  v_owner := (v_total * (v_split ->> 'owner_pct')::int) / 100;
  v_stream := v_total - v_host - v_owner; -- rounding remainder stays in the stream pool

  insert into public.gifts (room_id, stream_id, sender_id, host_id, gift_id, quantity, coins_total,
                            host_share, stream_share, owner_share, idempotency_key)
  values (p_room_id, v_room.current_stream_id, uid, v_room.host_id, p_gift_id, p_quantity, v_total,
          v_host, v_stream, v_owner, p_idempotency_key)
  returning * into v_row;

  perform private.apply_coin_delta(uid, -v_total, 'gift_sent', 'gift', v_row.id::text, 'gift:' || v_row.id);

  insert into public.creator_earnings (host_id) values (v_room.host_id) on conflict (host_id) do nothing;
  -- Hot-row fix: record the host's share as a tally and fold it in only if nobody else is folding.
  insert into private.gift_tallies (kind, target, a) values ('earnings', v_room.host_id, v_host);
  perform private.fold_tally('earnings', v_room.host_id, false);
  insert into public.earning_entries (host_id, delta, kind, ref_id) values (v_room.host_id, v_host, 'gift', v_row.id::text);

  if v_room.current_stream_id is not null then
    insert into private.gift_tallies (kind, target, a, b) values ('stream', v_room.current_stream_id::text, v_total, v_stream);
    perform private.fold_tally('stream', v_room.current_stream_id::text, false);
  end if;
  insert into public.platform_ledger (bucket, unit, amount, ref_type, ref_id)
    values ('gift_owner_share', 'coins', v_owner, 'gift', v_row.id::text);

  return v_row;
end $$;

-- PK score: same checks as before; the score goes in as a tally.
create or replace function private.pk_battle_apply_gift_score()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.rooms;
  v_battle public.pk_battles;
begin
  select * into v_room from public.rooms where id = new.room_id;
  if v_room.current_battle_id is null then return new; end if;
  select * into v_battle from public.pk_battles where id = v_room.current_battle_id and status = 'live'
    and (ends_at is null or ends_at > now());
  if not found then return new; end if;

  insert into private.gift_tallies (kind, target, a, b) values ('pk', v_battle.id::text,
    case when v_room.id = v_battle.room_a_id then new.coins_total else 0 end,
    case when v_room.id = v_battle.room_a_id then 0 else new.coins_total end);
  perform private.fold_tally('pk', v_battle.id::text, false);
  return new;
end $$;

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
    -- Hot-row fix: a top host's score row would otherwise serialize every gift during the event.
    insert into private.gift_tallies (kind, target, a) values
      ('event', e.id || '|host|' || new.host_id, new.coins_total),
      ('event', e.id || '|gifter|' || new.sender_id, new.coins_total);
    perform private.fold_tally('event', e.id || '|host|' || new.host_id, false);
    perform private.fold_tally('event', e.id || '|gifter|' || new.sender_id, false);
  end loop;
  return new;
end $$;

create or replace function private.finalize_event(p_id uuid)
returns public.events language plpgsql security definer set search_path = ''
as $$
declare v public.events; r record;
begin
  select * into v from public.events where id = p_id for update;
  if not found or v.status <> 'scheduled' then raise exception 'not_finalizable'; end if;
  if v.ends_at > now() then raise exception 'event_not_ended'; end if;
  perform private.fold_event_tallies(p_id);

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

-- Money decisions read the exact balance ------------------------------------------------------------
create or replace function public.request_withdrawal(p_coins bigint, p_payout_method jsonb)
returns public.withdrawals language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v_cfg jsonb := private.setting('withdrawal');
  v_rate numeric := (v_cfg ->> 'pkr_per_coin')::numeric;
  v_hold int := coalesce((v_cfg ->> 'hold_days')::int, 14);
  v_recent bigint;
  v_earn public.creator_earnings;
  v_row public.withdrawals;
  v_account text := p_payout_method ->> 'account';
begin
  if not exists (select 1 from public.hosts where user_id = uid and status = 'active') then raise exception 'not_a_host'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if private.host_verification_required('withdraw')
     and (select verification_status from public.hosts where user_id = uid) <> 'approved' then
    raise exception 'verification_required';
  end if;
  -- Hosts with no recorded signup country (older accounts) keep the old behaviour.
  if (select signup_country from public.profiles where id = uid) is not null
     and not coalesce((select (features ->> 'withdrawals')::boolean from public.regions where code = private.user_region(uid)), false) then
    raise exception 'withdrawals_unavailable';
  end if;
  if v_rate is null or v_rate <= 0 then raise exception 'withdrawals_not_configured'; end if;
  if p_coins is null or p_coins < (v_cfg ->> 'min_coins')::bigint then raise exception 'below_minimum'; end if;
  if p_payout_method is null or jsonb_typeof(p_payout_method) <> 'object'
     or coalesce(p_payout_method ->> 'type', '') not in ('easypaisa', 'jazzcash', 'bank')
     or v_account is null or char_length(v_account) not between 6 and 34 or v_account !~ '^[A-Za-z0-9 +-]+$'
     or pg_column_size(p_payout_method) > 512 then
    raise exception 'invalid_payout_method';
  end if;

  perform private.fold_tally('earnings', uid, true); -- exact balance before checking it
  select * into v_earn from public.creator_earnings where host_id = uid for update;
  if not found then raise exception 'insufficient_earnings'; end if;
  select coalesce(sum(delta), 0) into v_recent from public.earning_entries
    where host_id = uid and kind = 'gift' and created_at > now() - make_interval(days => v_hold);
  if v_earn.balance - v_recent < p_coins then raise exception 'insufficient_earnings'; end if;

  update public.creator_earnings set balance = balance - p_coins, held = held + p_coins, updated_at = now()
    where host_id = uid;
  insert into public.withdrawals (host_id, coins, amount_minor, currency, payout_method)
    values (uid, p_coins, floor(p_coins * v_rate * 100)::bigint, 'pkr',
            jsonb_build_object('type', p_payout_method ->> 'type', 'account', v_account))
    returning * into v_row;
  insert into public.earning_entries (host_id, delta, kind, ref_id) values (uid, -p_coins, 'withdrawal_hold', v_row.id::text);
  return v_row;
end $$;

create or replace function private.reverse_payment_coins(v public.payments, p_kind text)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v_wallet public.wallets; v_debit bigint; v_shortfall bigint; v_left bigint; v_gift record;
  v_part bigint; v_takes jsonb := '{}'; v_host record; v_earn public.creator_earnings; v_taken bigint;
begin
  v_wallet := private.lock_wallet(v.user_id);
  v_debit := least(v_wallet.coin_balance, v.coins);
  if v_debit > 0 then
    perform private.apply_coin_delta(v.user_id, -v_debit, p_kind, 'payment', v.id::text, p_kind || ':' || v.id);
  end if;
  v_shortfall := v.coins - v_debit;
  if v_shortfall > 0 then
    -- The buyer already gifted these coins. Coins are spent oldest first, so the gifts sent right
    -- after this purchase are the ones it paid for; skip coins an earlier reversal already took.
    v_left := v_shortfall;
    for v_gift in
      select id, host_id, coins_total, host_share, clawed_coins from public.gifts
      where sender_id = v.user_id and created_at >= v.created_at and coins_total > clawed_coins
      order by created_at, id
      for update
    loop
      exit when v_left <= 0;
      v_part := least(v_left, v_gift.coins_total - v_gift.clawed_coins);
      update public.gifts set clawed_coins = clawed_coins + v_part where id = v_gift.id;
      if v_gift.host_share > 0 then
        v_takes := jsonb_set(v_takes, array[v_gift.host_id],
          to_jsonb(coalesce((v_takes ->> v_gift.host_id)::bigint, 0) + (v_gift.host_share * v_part) / v_gift.coins_total));
      end if;
      v_left := v_left - v_part;
    end loop;
    -- Take the hosts' share back, locking earnings in host order (no deadlocks between reversals).
    for v_host in select key as host_id, value::bigint as take from jsonb_each_text(v_takes) order by key loop
      continue when v_host.take <= 0;
      perform private.fold_tally('earnings', v_host.host_id, true); -- exact balance before clawing back
      select * into v_earn from public.creator_earnings where host_id = v_host.host_id for update;
      v_taken := least(coalesce(v_earn.balance, 0), v_host.take);
      if v_taken > 0 then
        update public.creator_earnings set balance = balance - v_taken, updated_at = now() where host_id = v_host.host_id;
        insert into public.earning_entries (host_id, delta, kind, ref_id)
          values (v_host.host_id, -v_taken, 'chargeback_clawback', v.id::text);
      end if;
      if v_taken < v_host.take then
        -- Already withdrawn or requested: the owner reviews the host (and any pending withdrawal).
        insert into public.moderation_actions (target_user_id, action, reason, source)
          values (v_host.host_id, 'account_review',
                  p_kind || ': ' || (v_host.take - v_taken) || ' diamonds could not be clawed back; check pending withdrawals', 'system');
      end if;
    end loop;
    insert into public.platform_ledger (bucket, unit, amount, ref_type, ref_id)
      values (p_kind || '_shortfall', 'coins', -v_shortfall, 'payment', v.id::text);
    insert into public.moderation_actions (target_user_id, action, reason, source)
      values (v.user_id, 'account_review', p_kind || ': ' || v_shortfall || ' coins already spent', 'system');
  end if;
  return v_shortfall;
end $$;

-- Includes this host's tallies that haven't been folded in yet.
create or replace function public.my_withdrawable_coins()
returns bigint language sql stable security definer set search_path = ''
as $$
  select greatest(0, coalesce((select balance from public.creator_earnings where host_id = public.requesting_user_id()), 0)
    + coalesce((select sum(a) from private.gift_tallies where kind = 'earnings' and target = public.requesting_user_id()), 0)
    - coalesce((select sum(delta) from public.earning_entries
                where host_id = public.requesting_user_id() and kind = 'gift'
                  and created_at > now() - make_interval(days => coalesce((private.setting('withdrawal') ->> 'hold_days')::int, 14))), 0))::bigint
$$;

-- The earnings screen folds the host's own tallies first, so it shows the exact balance.
create or replace function public.settle_my_earnings()
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform private.fold_tally('earnings', uid, true);
end $$;
revoke execute on function public.settle_my_earnings() from public, anon;
grant execute on function public.settle_my_earnings() to authenticated;
revoke execute on function private.fold_tally(text, text, boolean) from public, anon, authenticated;
revoke execute on function private.fold_event_tallies(uuid) from public, anon, authenticated;
