-- Fixes from the 50-corner AI review (server side). Safe to run more than once.

-- 1. Realtime for kicks/blocks (viewers are removed at once) and stream summaries (AI coach card).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'room_bans') then
      alter publication supabase_realtime add table public.room_bans;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'streams') then
      alter publication supabase_realtime add table public.streams;
    end if;
  end if;
end $$;

-- 2. A banned account loses its owner tick and Home pin.
create or replace function private.clear_owner_verification_on_ban()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'banned' and old.status is distinct from 'banned' then
    new.owner_verified_at := null;
    delete from public.pinned_profiles where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists clear_owner_verification_on_ban on public.profiles;
create trigger clear_owner_verification_on_ban before update of status on public.profiles
  for each row execute function private.clear_owner_verification_on_ban();

-- 3. Blocking works both ways for direct messages.
create or replace function public.send_direct_message(p_recipient text, p_body text)
returns public.direct_messages language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_body text := trim(p_body); v_row public.direct_messages;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if char_length(v_body) not between 1 and 1000 then raise exception 'invalid_length'; end if;
  if exists (select 1 from public.user_blocks
             where (blocker_id = p_recipient and blocked_id = uid) or (blocker_id = uid and blocked_id = p_recipient)) then
    raise exception 'blocked';
  end if;
  if (select count(*) from public.direct_messages where sender_id = uid and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'slow_down';
  end if;
  insert into public.direct_messages (sender_id, recipient_id, body) values (uid, p_recipient, private.filter_text(v_body))
    returning * into v_row;
  return v_row;
end $$;

-- 4. Blocking someone also removes follows both ways, and blocked people can't follow.
create or replace function public.block_user(p_user text)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_user is null or p_user = uid then raise exception 'invalid_target'; end if;
  insert into public.user_blocks (blocker_id, blocked_id) values (uid, p_user) on conflict do nothing;
  delete from public.follows where (follower_id = uid and followee_id = p_user) or (follower_id = p_user and followee_id = uid);
end $$;
create or replace function public.unblock_user(p_user text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.user_blocks where blocker_id = public.requesting_user_id() and blocked_id = p_user;
end $$;
revoke execute on function public.block_user(text), public.unblock_user(text) from public, anon;
grant execute on function public.block_user(text), public.unblock_user(text) to authenticated;

drop policy if exists "follow as self" on public.follows;
create policy "follow as self" on public.follows for insert to authenticated with check (
  follower_id = public.requesting_user_id()
  and not exists (select 1 from public.user_blocks b
                  where (b.blocker_id = followee_id and b.blocked_id = follower_id) or (b.blocker_id = follower_id and b.blocked_id = followee_id))
  and exists (select 1 from public.profiles p where p.id = followee_id and p.deleted_at is null)
);

-- 5. Rankings leave out deleted and banned accounts.
create or replace function public.get_rankings(p_kind text, p_period text default 'week')
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

-- 6. Hosts see what they can withdraw now (earnings older than the hold window).
create or replace function public.my_withdrawable_coins()
returns bigint language sql stable security definer set search_path = ''
as $$
  select greatest(0, coalesce((select balance from public.creator_earnings where host_id = public.requesting_user_id()), 0)
    - coalesce((select sum(delta) from public.earning_entries
                where host_id = public.requesting_user_id() and kind = 'gift'
                  and created_at > now() - make_interval(days => coalesce((private.setting('withdrawal') ->> 'hold_days')::int, 14))), 0))::bigint
$$;
revoke execute on function public.my_withdrawable_coins() from public, anon;
grant execute on function public.my_withdrawable_coins() to authenticated;

-- 7. An approved withdrawal whose payout failed can still be rejected (coins go back to the host);
--    hosts are told when a payout is sent.
create or replace function public.review_withdrawal(p_withdrawal_id uuid, p_approve boolean, p_note text default null)
returns public.withdrawals language plpgsql security definer set search_path = ''
as $$
declare v public.withdrawals; v_was text;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  select * into v from public.withdrawals where id = p_withdrawal_id
    and (status = 'requested' or (status = 'approved' and not p_approve)) for update;
  if not found then raise exception 'not_found'; end if;
  v_was := v.status;
  perform 1 from public.creator_earnings where host_id = v.host_id for update;
  if p_approve then
    update public.creator_earnings set held = held - v.coins, updated_at = now() where host_id = v.host_id;
  elsif v_was = 'requested' then
    update public.creator_earnings set held = held - v.coins, balance = balance + v.coins, updated_at = now()
      where host_id = v.host_id;
    insert into public.earning_entries (host_id, delta, kind, ref_id) values (v.host_id, v.coins, 'withdrawal_release', v.id::text);
  else
    -- Already approved (coins left "held"): the failed payout's coins return to the balance.
    update public.creator_earnings set balance = balance + v.coins, updated_at = now() where host_id = v.host_id;
    insert into public.earning_entries (host_id, delta, kind, ref_id) values (v.host_id, v.coins, 'withdrawal_release', v.id::text);
  end if;
  update public.withdrawals set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = public.requesting_user_id(), review_note = p_note, updated_at = now()
    where id = v.id returning * into v;
  perform private.audit('withdrawal_' || v.status, 'withdrawal', v.id::text, jsonb_build_object('coins', v.coins, 'was', v_was));
  perform private.notify(v.host_id, 'withdrawal', 'Withdrawal ' || v.status, p_note, jsonb_build_object('withdrawal_id', v.id));
  return v;
end $$;

create or replace function public.mark_withdrawal_paid(p_withdrawal_id uuid, p_payout_ref text)
returns public.withdrawals language plpgsql security definer set search_path = ''
as $$
declare v public.withdrawals;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  update public.withdrawals set status = 'paid', payout_ref = p_payout_ref, updated_at = now()
    where id = p_withdrawal_id and status = 'approved' returning * into v;
  if not found then raise exception 'not_found'; end if;
  insert into public.earning_entries (host_id, delta, kind, ref_id) values (v.host_id, 0, 'withdrawal_paid', v.id::text);
  perform private.audit('withdrawal_paid', 'withdrawal', v.id::text, jsonb_build_object('payout_ref', p_payout_ref));
  perform private.notify(v.host_id, 'withdrawal', 'Withdrawal paid', 'Your payout has been sent.', jsonb_build_object('withdrawal_id', v.id));
  return v;
end $$;

-- 8. A wallet frozen by a dispute is unfrozen once no dispute is open (won, lost, refunded, or
--    closed in our favour), and refunds are only approved for payments that are still paid.
create or replace function private.unfreeze_if_no_disputes(p_user text)
returns void language sql security definer set search_path = ''
as $$
  update public.wallets set frozen = false, updated_at = now()
  where user_id = p_user and frozen
    and not exists (select 1 from public.payments where user_id = p_user and status = 'disputed')
$$;

create or replace function public.internal_refund_payment(p_payment_intent text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v public.payments; v_short bigint;
begin
  select * into v from public.payments where provider_payment_ref = p_payment_intent for update;
  if not found then raise exception 'unknown_payment'; end if;
  if v.status = 'refunded' then return jsonb_build_object('reversed', false, 'reason', 'already_refunded'); end if;
  if v.status not in ('paid', 'disputed') then return jsonb_build_object('reversed', false, 'reason', v.status); end if;
  update public.payments set status = 'refunded' where id = v.id;
  v_short := private.reverse_payment_coins(v, 'refund');
  perform private.unfreeze_if_no_disputes(v.user_id);
  perform private.audit('payment_refunded', 'payment', v.id::text, jsonb_build_object('shortfall', v_short), 'system');
  return jsonb_build_object('reversed', true, 'shortfall', v_short);
end $$;

create or replace function public.internal_dispute_payment(p_payment_intent text, p_stage text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v public.payments; v_short bigint;
begin
  if p_stage not in ('opened', 'won', 'lost', 'closed') then raise exception 'invalid_stage'; end if;
  select * into v from public.payments where provider_payment_ref = p_payment_intent for update;
  if not found then raise exception 'unknown_payment'; end if;

  if p_stage = 'opened' then
    if v.status <> 'paid' then return jsonb_build_object('changed', false, 'status', v.status); end if;
    update public.payments set status = 'disputed' where id = v.id;
    perform private.lock_wallet(v.user_id);
    update public.wallets set frozen = true, updated_at = now() where user_id = v.user_id;
  elsif p_stage in ('won', 'closed') then
    -- 'closed' = an inquiry that closed without a chargeback (Stripe warning_closed / prevented).
    if v.status <> 'disputed' then return jsonb_build_object('changed', false, 'status', v.status); end if;
    update public.payments set status = 'paid' where id = v.id;
    perform private.unfreeze_if_no_disputes(v.user_id);
  else
    if v.status <> 'disputed' then return jsonb_build_object('changed', false, 'status', v.status); end if;
    update public.payments set status = 'dispute_lost' where id = v.id;
    v_short := private.reverse_payment_coins(v, 'chargeback');
    insert into public.platform_ledger (bucket, unit, currency, amount, ref_type, ref_id)
      values ('chargeback_loss', 'minor', v.currency, -v.amount_minor, 'payment', v.id::text);
    insert into public.moderation_actions (target_user_id, action, reason, source)
      values (v.user_id, 'account_review', 'Lost chargeback on payment ' || v.id, 'system');
    perform private.unfreeze_if_no_disputes(v.user_id);
  end if;
  perform private.audit('payment_dispute_' || p_stage, 'payment', v.id::text, '{}', 'system');
  return jsonb_build_object('changed', true, 'status', p_stage);
end $$;

create or replace function public.review_refund(p_request_id uuid, p_approve boolean)
returns public.refund_requests language plpgsql security definer set search_path = ''
as $$
declare v_req public.refund_requests; v public.payments;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  select * into v_req from public.refund_requests where id = p_request_id and status = 'requested' for update;
  if not found then raise exception 'not_found'; end if;
  if p_approve then
    select * into v from public.payments where id = v_req.payment_id for update;
    if v.status <> 'paid' then raise exception 'payment_not_refundable'; end if;
    update public.payments set status = 'refunded' where id = v.id;
    perform private.reverse_payment_coins(v, 'refund');
  end if;
  update public.refund_requests set status = case when p_approve then 'approved' else 'denied' end,
    reviewed_by = public.requesting_user_id() where id = p_request_id returning * into v_req;
  perform private.audit('refund_' || v_req.status, 'refund_request', p_request_id::text);
  perform private.notify(v_req.user_id, 'refund', 'Refund ' || v_req.status, null, jsonb_build_object('payment_id', v_req.payment_id));
  return v_req;
end $$;

-- 9. PK battles: solo lives only (party rooms have no battle screen), rooms locked in a fixed
--    order (no deadlock when two hosts invite each other), and accepting re-checks both rooms.
create or replace function public.invite_pk_battle(p_target_room_id uuid)
returns public.pk_battles language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v_my_room public.rooms;
  v_target public.rooms;
  v_row public.pk_battles;
  v_my_id uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if p_target_room_id is null then raise exception 'invalid_target'; end if;
  select id into v_my_id from public.rooms where host_id = uid;
  if v_my_id is null then raise exception 'not_live'; end if;
  perform 1 from public.rooms where id in (v_my_id, p_target_room_id) order by id for update;

  select * into v_my_room from public.rooms where id = v_my_id;
  if v_my_room.status <> 'live' then raise exception 'not_live'; end if;
  if v_my_room.mode <> 'live' then raise exception 'not_live'; end if;
  if v_my_room.current_battle_id is not null then raise exception 'already_in_battle'; end if;

  select * into v_target from public.rooms where id = p_target_room_id;
  if not found or v_target.status <> 'live' or v_target.mode <> 'live' then raise exception 'target_not_live'; end if;
  if v_target.host_id = uid then raise exception 'cannot_battle_self'; end if;
  if v_target.current_battle_id is not null then raise exception 'target_already_in_battle'; end if;

  insert into public.pk_battles (room_a_id, room_b_id) values (v_my_room.id, v_target.id) returning * into v_row;
  update public.rooms set current_battle_id = v_row.id where id in (v_my_room.id, v_target.id);

  perform private.notify(v_target.host_id, 'pk_battle_invite', 'PK battle invite',
    'A host wants to battle you live.', jsonb_build_object('battle_id', v_row.id, 'room_id', v_my_room.id));
  perform private.audit('pk_battle_invited', 'pk_battle', v_row.id::text,
    jsonb_build_object('room_a', v_my_room.id, 'room_b', v_target.id));
  return v_row;
end $$;

create or replace function public.respond_pk_battle(p_battle_id uuid, p_accept boolean)
returns public.pk_battles language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v public.pk_battles;
  v_room_a public.rooms;
  v_room_b public.rooms;
  v_duration int;
  v_is_challenger boolean;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into v from public.pk_battles where id = p_battle_id for update;
  if not found or v.status <> 'invited' then raise exception 'not_invitable'; end if;
  select * into v_room_a from public.rooms where id = v.room_a_id;
  select * into v_room_b from public.rooms where id = v.room_b_id;
  v_is_challenger := v_room_a.host_id = uid;
  if v_room_b.host_id <> uid and not v_is_challenger then raise exception 'forbidden'; end if;
  if v_is_challenger and p_accept then raise exception 'forbidden'; end if;

  if p_accept then
    if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
    if v_room_a.status <> 'live' or v_room_b.status <> 'live' then raise exception 'target_not_live'; end if;
    v_duration := coalesce((private.setting('pk_battle') ->> 'duration_seconds')::int, 180);
    update public.pk_battles set status = 'live', started_at = now(), ends_at = now() + make_interval(secs => v_duration)
      where id = p_battle_id returning * into v;
    perform private.notify(v_room_a.host_id, 'pk_battle_accepted', 'Battle accepted',
      'Your PK battle is live.', jsonb_build_object('battle_id', v.id));
  else
    update public.pk_battles set status = case when v_is_challenger then 'cancelled' else 'declined' end
      where id = p_battle_id returning * into v;
    update public.rooms set current_battle_id = null where id in (v.room_a_id, v.room_b_id);
    perform private.notify(case when v_is_challenger then v_room_b.host_id else v_room_a.host_id end,
      'pk_battle_' || v.status, initcap(v.status) || ' battle', null, jsonb_build_object('battle_id', v.id));
  end if;
  perform private.audit('pk_battle_' || v.status, 'pk_battle', v.id::text);
  return v;
end $$;

-- Scores only land on a battle that is still live and in time (a gift waiting on the end lock
-- must not change the score after the winner is set).
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
    update public.pk_battles set score_a = score_a + new.coins_total
      where id = v_battle.id and status = 'live' and (ends_at is null or ends_at > now());
  else
    update public.pk_battles set score_b = score_b + new.coins_total
      where id = v_battle.id and status = 'live' and (ends_at is null or ends_at > now());
  end if;
  return new;
end $$;

-- 10. A deleted account gives up its party seats and queue places.
create or replace function private.clear_seats_on_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.room_seats where user_id = new.id;
    delete from public.seat_requests where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists clear_seats_on_delete on public.profiles;
create trigger clear_seats_on_delete after update of deleted_at on public.profiles
  for each row execute function private.clear_seats_on_delete();

-- 11. Media uploads that never finished (older than a day) no longer count towards the
--     pending-uploads limit, so failed uploads can't block a host for good.
update public.media_assets set status = 'failed', error = coalesce(error, 'upload_expired')
  where status = 'awaiting_upload' and created_at < now() - interval '1 day';

-- 12. Didit doesn't check that a live person took the selfie, so new hosts go to owner review
--     unless the owner turns on host_verification.auto_approve.
create or replace function public.internal_submit_host_application(
  p_user text, p_full_name text, p_phone text, p_cnic_last4 text, p_agency_code text,
  p_id_status text, p_face_status text, p_face_score int, p_cnic_match boolean, p_name_match boolean,
  p_age int, p_id_request text, p_face_request text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_agency uuid;
  v_status text;
  v_reasons text[] := '{}';
  v_app public.host_applications;
begin
  if public.user_status(p_user) <> 'active' then raise exception 'account_restricted'; end if;
  if exists (select 1 from public.hosts where user_id = p_user and verification_status = 'approved') then
    raise exception 'already_verified';
  end if;

  if nullif(trim(p_agency_code), '') is null then raise exception 'agency_code_required'; end if;
  select id into v_agency from public.agencies where code = trim(p_agency_code) and status = 'active';
  if v_agency is null then raise exception 'invalid_agency_code'; end if;

  if (p_age is not null and p_age < 18) or p_id_status = 'Declined' or p_face_status = 'Declined' then
    -- Hard fails.
    v_status := 'declined';
    if p_age is not null and p_age < 18 then v_reasons := array_append(v_reasons, 'underage'); end if;
    if p_id_status = 'Declined' then v_reasons := array_append(v_reasons, 'id_declined'); end if;
    if p_face_status = 'Declined' then v_reasons := array_append(v_reasons, 'face_mismatch'); end if;
  elsif p_id_status = 'Approved' and p_face_status = 'Approved' and p_age is not null
        and coalesce((private.setting('host_verification') ->> 'auto_approve')::boolean, false) then
    -- Verified by Didit and the owner turned on auto-approval.
    v_status := 'approved';
  elsif p_id_status = 'Approved' and p_face_status = 'Approved' and p_age is not null then
    -- Didit checks the selfie against the card but not that a live person took it (a photo of
    -- someone else's card passes), so a person approves unless the owner opts into auto-approval.
    v_status := 'in_review';
    v_reasons := array_append(v_reasons, 'liveness_not_checked');
  else
    -- Didit hasn't reached a decision (or the age couldn't be read): a person decides.
    v_status := 'in_review';
    if p_id_status is distinct from 'Approved' then v_reasons := array_append(v_reasons, 'id_needs_review'); end if;
    if p_face_status is distinct from 'Approved' then v_reasons := array_append(v_reasons, 'face_needs_review'); end if;
    if p_age is null then v_reasons := array_append(v_reasons, 'age_unknown'); end if;
  end if;
  -- Notes only; never block approval.
  if p_cnic_match is not true then v_reasons := array_append(v_reasons, 'cnic_mismatch'); end if;
  if p_name_match is not true then v_reasons := array_append(v_reasons, 'name_mismatch'); end if;

  perform private.ensure_host(p_user);

  insert into public.host_applications (user_id, full_name, phone, cnic_last4, agency_code, agency_id, id_status, face_status,
    face_score, cnic_match, name_match, age, status, reasons, didit_id_request, didit_face_request)
  values (p_user, trim(p_full_name), p_phone, p_cnic_last4, trim(p_agency_code), v_agency, p_id_status, p_face_status,
    p_face_score, p_cnic_match, p_name_match, p_age, v_status, v_reasons, p_id_request, p_face_request)
  returning * into v_app;

  perform private.apply_host_decision(v_app);
  perform private.audit('host_application_' || v_status, 'user', p_user,
    jsonb_build_object('application_id', v_app.id, 'reasons', v_reasons), 'system');
  return jsonb_build_object('id', v_app.id, 'status', v_status, 'reasons', v_reasons);
end $$;