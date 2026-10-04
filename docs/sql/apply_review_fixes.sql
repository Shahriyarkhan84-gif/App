-- Zynalive security fixes from the AI review. Paste into Supabase → SQL Editor (project zynalive) → Run. Safe to run more than once.

-- Fixes from the AI app review (server side). Each block names the finding it closes.

-- 1. Chargebacks/refunds claw back host earnings funded by the reversed coins, and new
--    earnings are held before they can be withdrawn (so stolen-card coins can't be cashed out
--    before the dispute arrives).
alter table public.earning_entries drop constraint if exists earning_entries_kind_check;
alter table public.earning_entries add constraint earning_entries_kind_check
  check (kind in ('gift', 'withdrawal_hold', 'withdrawal_release', 'withdrawal_paid', 'adjustment', 'chargeback_clawback'));

update public.platform_settings set value = value || '{"hold_days": 14}'::jsonb
  where key = 'withdrawal' and not (value ? 'hold_days');

create or replace function private.reverse_payment_coins(v public.payments, p_kind text)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v_wallet public.wallets; v_debit bigint; v_shortfall bigint; v_left bigint; v_gift record;
  v_part bigint; v_take bigint; v_earn public.creator_earnings;
begin
  v_wallet := private.lock_wallet(v.user_id);
  v_debit := least(v_wallet.coin_balance, v.coins);
  if v_debit > 0 then
    perform private.apply_coin_delta(v.user_id, -v_debit, p_kind, 'payment', v.id::text, p_kind || ':' || v.id);
  end if;
  v_shortfall := v.coins - v_debit;
  if v_shortfall > 0 then
    -- The buyer already gifted these coins: take the hosts' share back, newest gifts first.
    v_left := v_shortfall;
    for v_gift in
      select id, host_id, coins_total, host_share from public.gifts
      where sender_id = v.user_id and created_at >= v.created_at and host_share > 0
      order by created_at desc
    loop
      exit when v_left <= 0;
      v_part := least(v_left, v_gift.coins_total);
      v_take := (v_gift.host_share * v_part) / v_gift.coins_total;
      select * into v_earn from public.creator_earnings where host_id = v_gift.host_id for update;
      if found and v_take > 0 then
        update public.creator_earnings set balance = balance - least(balance, v_take), updated_at = now()
          where host_id = v_gift.host_id;
        insert into public.earning_entries (host_id, delta, kind, ref_id)
          values (v_gift.host_id, -least(v_earn.balance, v_take), 'chargeback_clawback', v.id::text);
        if v_earn.balance < v_take then
          -- Already withdrawn: flag the host for the owner to review.
          insert into public.moderation_actions (target_user_id, action, reason, source)
            values (v_gift.host_id, 'account_review', p_kind || ': ' || (v_take - v_earn.balance) || ' diamonds already withdrawn', 'system');
        end if;
      end if;
      v_left := v_left - v_part;
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
  if not coalesce((select (features ->> 'withdrawals')::boolean from public.regions where code = private.user_region(uid)), false) then
    raise exception 'withdrawals_unavailable';
  end if;
  if v_rate is null or v_rate <= 0 then raise exception 'withdrawals_not_configured'; end if;
  if p_coins is null or p_coins < (v_cfg ->> 'min_coins')::bigint then raise exception 'below_minimum'; end if;
  if p_payout_method is null or jsonb_typeof(p_payout_method) <> 'object'
     or (p_payout_method ->> 'type') not in ('easypaisa', 'jazzcash', 'bank')
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

-- 4. The legacy Didit session path needs an agency-linked host application first (it used to
--    verify hosts with no agency code).
create or replace function public.internal_start_host_verification(p_user text, p_session_id text)
returns public.host_verifications language plpgsql security definer set search_path = ''
as $$
declare v_host public.hosts; v_row public.host_verifications;
begin
  select * into v_host from public.hosts where user_id = p_user for update;
  if not found then raise exception 'not_a_host'; end if;
  if v_host.verification_status = 'approved' then raise exception 'already_verified'; end if;
  if not exists (select 1 from public.host_applications where user_id = p_user and agency_id is not null) then
    raise exception 'application_required';
  end if;
  insert into public.host_verifications (user_id, session_id) values (p_user, p_session_id)
    returning * into v_row;
  update public.hosts set verification_status = 'pending' where user_id = p_user;
  return v_row;
end $$;

-- 5. A late result for an old Didit session can't demote a host who was approved afterwards.
create or replace function private.guard_host_verification_downgrade()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_session_created timestamptz;
begin
  if old.verification_status = 'approved' and new.verification_status is distinct from 'approved'
     and coalesce(current_setting('zynalive.allow_unverify', true), '') <> 'on' then
    select max(created_at) into v_session_created from public.host_verifications where user_id = new.user_id;
    if old.verified_at is not null and (v_session_created is null or v_session_created <= old.verified_at) then
      new.verification_status := old.verification_status;
      new.verified_at := old.verified_at;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_host_verification_downgrade on public.hosts;
create trigger guard_host_verification_downgrade before update of verification_status on public.hosts
  for each row execute function private.guard_host_verification_downgrade();

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
