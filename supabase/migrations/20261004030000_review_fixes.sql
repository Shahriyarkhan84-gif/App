-- Fixes from the AI app review (server side). Each block names the finding it closes.

-- 1. Chargebacks/refunds claw back host earnings funded by the reversed coins, and new
--    earnings are held before they can be withdrawn (so stolen-card coins can't be cashed out
--    before the dispute arrives).
alter table public.earning_entries drop constraint if exists earning_entries_kind_check;
alter table public.earning_entries add constraint earning_entries_kind_check
  check (kind in ('gift', 'withdrawal_hold', 'withdrawal_release', 'withdrawal_paid', 'adjustment', 'chargeback_clawback'));

update public.platform_settings set value = value || '{"hold_days": 14}'::jsonb
  where key = 'withdrawal' and not (value ? 'hold_days');

-- Each gift remembers how many of its coins were already clawed back, so two reversals never
-- take the same gift twice.
alter table public.gifts add column if not exists clawed_coins bigint not null default 0;
alter table public.gifts drop constraint if exists gifts_clawed_coins_check;
alter table public.gifts add constraint gifts_clawed_coins_check check (clawed_coins between 0 and coins_total);

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

-- 2. Withdrawals: only where the host's region allows them, only earnings older than the hold
--    window, and only to a known payout type with a sane account value.
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

-- 3. Only the platform owner can move a host into an agency (agency staff could claim any host
--    and then see their payouts). Hosts join agencies through their application's agency code.
create or replace function public.assign_host_to_agency(p_host text, p_agency uuid)
returns public.hosts language plpgsql security definer set search_path = ''
as $$
declare v public.hosts;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  update public.hosts set agency_id = p_agency where user_id = p_host returning * into v;
  if not found then raise exception 'not_found_or_already_assigned'; end if;
  perform private.audit('host_assigned', 'host', p_host, jsonb_build_object('agency', p_agency));
  return v;
end $$;

-- 4. The legacy Didit session path needs an approved, agency-linked host application first (it
--    used to verify hosts with no agency code).
create or replace function public.internal_start_host_verification(p_user text, p_session_id text)
returns public.host_verifications language plpgsql security definer set search_path = ''
as $$
declare v_host public.hosts; v_row public.host_verifications;
begin
  select * into v_host from public.hosts where user_id = p_user for update;
  if not found then raise exception 'not_a_host'; end if;
  if v_host.verification_status = 'approved' then raise exception 'already_verified'; end if;
  if not exists (select 1 from public.host_applications where user_id = p_user and agency_id is not null and status = 'approved') then
    raise exception 'application_required';
  end if;
  insert into public.host_verifications (user_id, session_id) values (p_user, p_session_id)
    returning * into v_row;
  update public.hosts set verification_status = 'pending' where user_id = p_user;
  return v_row;
end $$;

-- 5. A late Didit result can't demote an approved host: once approved, only a decline (the
--    provider reversing its own decision) changes it.
drop trigger if exists guard_host_verification_downgrade on public.hosts;
drop function if exists private.guard_host_verification_downgrade();

create or replace function public.internal_apply_host_verification(p_session_id text, p_provider_status text, p_summary jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v public.host_verifications;
  v_status text := private.map_didit_status(p_provider_status);
  v_latest uuid;
  v_before text;
begin
  select * into v from public.host_verifications where session_id = p_session_id for update;
  if not found then raise exception 'unknown_session'; end if;
  if v.provider_status = p_provider_status then
    return jsonb_build_object('changed', false, 'status', v.status);
  end if;

  update public.host_verifications
    set provider_status = p_provider_status, status = v_status, summary = coalesce(p_summary, '{}'), updated_at = now()
    where id = v.id;

  -- Only the host's most recent session drives their status.
  select id into v_latest from public.host_verifications where user_id = v.user_id order by created_at desc limit 1;
  if v_latest <> v.id then
    return jsonb_build_object('changed', true, 'status', v_status, 'applied_to_host', false);
  end if;

  select verification_status into v_before from public.hosts where user_id = v.user_id for update;
  -- No new session can start once approved, so this is the approving session: only an explicit
  -- decline (Didit reversing its decision) may demote; expired/abandoned/in-review results can't.
  if v_before = 'approved' and v_status not in ('approved', 'declined') then
    return jsonb_build_object('changed', true, 'status', v_status, 'applied_to_host', false);
  end if;
  update public.hosts
    set verification_status = v_status,
        verified_at = case when v_status = 'approved' then now() when v_status = 'declined' then null else verified_at end
    where user_id = v.user_id;

  if v_status is distinct from v_before and v_status in ('approved', 'declined', 'in_review') then
    perform private.notify(v.user_id, 'verification',
      case v_status
        when 'approved' then 'You''re verified — Host badge unlocked'
        when 'declined' then 'Verification unsuccessful'
        else 'Verification under review' end,
      case v_status
        when 'approved' then 'Your identity is confirmed and you''ve earned the Host badge. You can now go live and withdraw earnings.'
        when 'declined' then 'We couldn''t verify your identity. You can try again from the Go live tab.'
        else 'Our team is reviewing your documents. This usually takes less than a day.' end,
      jsonb_build_object('session_id', p_session_id));
  end if;
  perform private.audit('host_verification_' || v_status, 'user', v.user_id,
    jsonb_build_object('session_id', p_session_id, 'provider_status', p_provider_status), 'system');
  return jsonb_build_object('changed', true, 'status', v_status, 'applied_to_host', true);
end $$;

-- 6. Room admins must follow the host and be active; re-adding an existing admin is a no-op.
create or replace function public.set_room_admin(p_user text, p_enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room uuid;
begin
  select id into v_room from public.rooms where host_id = uid;
  if v_room is null then raise exception 'not_a_host'; end if;
  if p_enabled then
    if exists (select 1 from public.room_admins where room_id = v_room and user_id = p_user) then return; end if;
    if p_user = uid then raise exception 'invalid_admin'; end if;
    if not exists (select 1 from public.follows where follower_id = p_user and followee_id = uid) then raise exception 'must_follow_host'; end if;
    if public.user_status(p_user) <> 'active' then raise exception 'account_restricted'; end if;
    insert into public.room_admins (room_id, user_id) values (v_room, p_user);
  else
    delete from public.room_admins where room_id = v_room and user_id = p_user;
  end if;
  perform private.audit(case when p_enabled then 'room_admin_added' else 'room_admin_removed' end, 'user', p_user,
    jsonb_build_object('room', v_room));
end $$;

-- 7. Kicking or blocking someone also takes them off their party seat and out of the queue.
create or replace function private.unseat_on_room_ban()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind in ('kick', 'block') then
    delete from public.room_seats where room_id = new.room_id and user_id = new.user_id;
    delete from public.seat_requests where room_id = new.room_id and user_id = new.user_id;
  end if;
  return new;
end $$;
drop trigger if exists unseat_on_room_ban on public.room_bans;
create trigger unseat_on_room_ban after insert or update on public.room_bans
  for each row execute function private.unseat_on_room_ban();

-- 8. Room admins only moderate while their own account is active.
create or replace function private.can_moderate_room(p_room public.rooms, p_user text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_room.host_id = p_user
      or (p_room.status = 'live' and public.user_status(p_user) = 'active'
          and exists (select 1 from public.room_admins where room_id = p_room.id and user_id = p_user))
$$;

-- 9. The room type can't change mid-live (viewers would be stranded on the wrong screen, and
--    switching a party to a solo live would wipe its seats).
create or replace function public.set_room_mode(p_mode text)
returns public.rooms language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms;
begin
  if p_mode not in ('live', 'voice', 'video') then raise exception 'invalid_mode'; end if;
  select * into v_room from public.rooms where host_id = uid for update;
  if not found then raise exception 'not_a_host'; end if;
  if v_room.status = 'live' and v_room.mode is distinct from p_mode then raise exception 'already_live'; end if;
  update public.rooms set mode = p_mode, updated_at = now() where id = v_room.id returning * into v_room;
  delete from public.room_seats where room_id = v_room.id and seat > private.party_capacity(p_mode);
  if p_mode = 'live' then delete from public.seat_requests where room_id = v_room.id; end if;
  return v_room;
end $$;

-- 10. Leaving the LiveKit room gives up your party seat and your place in the queue.
create or replace function public.internal_viewer_event(p_livekit_room text, p_user text, p_joined boolean, p_count int)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room public.rooms;
begin
  select * into v_room from public.rooms where livekit_room = p_livekit_room;
  if not found or v_room.status <> 'live' then return; end if;
  update public.rooms set viewer_count = greatest(p_count, 0) where id = v_room.id;
  update public.streams set peak_viewers = greatest(peak_viewers, p_count) where id = v_room.current_stream_id;
  if p_user is not null and p_user <> v_room.host_id and exists (select 1 from public.profiles where id = p_user) then
    if p_joined then
      insert into public.viewers (stream_id, user_id) values (v_room.current_stream_id, p_user)
        on conflict (stream_id, user_id) do update set left_at = null;
    else
      update public.viewers set left_at = now() where stream_id = v_room.current_stream_id and user_id = p_user;
      delete from public.room_seats where room_id = v_room.id and user_id = p_user;
      delete from public.seat_requests where room_id = v_room.id and user_id = p_user;
    end if;
  end if;
end $$;

-- 11. Ending a stream ends (or cancels) its PK battle, so the opponent isn't left battling an
--     offline room and the old battle doesn't come back on the next live.
create or replace function private.end_stream(p_room uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room public.rooms; v_stream public.streams; v_battle public.pk_battles;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if v_room.status <> 'live' then return; end if;
  for v_battle in
    select * from public.pk_battles where (room_a_id = p_room or room_b_id = p_room) and status in ('invited', 'live') for update
  loop
    if v_battle.status = 'live' then
      update public.pk_battles set status = 'ended', ended_at = now(),
        winner_room_id = case when score_a = score_b then null when score_a > score_b then room_a_id else room_b_id end
        where id = v_battle.id;
    else
      update public.pk_battles set status = 'cancelled', ended_at = now() where id = v_battle.id;
    end if;
    update public.rooms set current_battle_id = null
      where id in (v_battle.room_a_id, v_battle.room_b_id) and current_battle_id = v_battle.id;
  end loop;
  update public.streams set ended_at = now() where id = v_room.current_stream_id and ended_at is null
    returning * into v_stream;
  update public.rooms set status = 'offline', viewer_count = 0, current_battle_id = null, updated_at = now() where id = p_room;
  if v_stream.id is not null then
    update public.hosts set total_live_seconds = total_live_seconds + extract(epoch from (v_stream.ended_at - v_stream.started_at))::bigint
      where user_id = v_stream.host_id;
    update public.viewers set left_at = now() where stream_id = v_stream.id and left_at is null;
    perform private.enqueue_ai_job('creator_assist', jsonb_build_object('stream_id', v_stream.id), 'creator_assist:' || v_stream.id);
  end if;
end $$;

-- 12. Gifts after a battle's clock runs out don't score (even if nobody has ended it yet).
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

  if v_room.id = v_battle.room_a_id then
    update public.pk_battles set score_a = score_a + new.coins_total where id = v_battle.id;
  else
    update public.pk_battles set score_b = score_b + new.coins_total where id = v_battle.id;
  end if;
  return new;
end $$;
