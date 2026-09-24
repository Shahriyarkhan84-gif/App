-- Coin + gift economy, payments, refunds/chargebacks, creator earnings, withdrawals.
--
-- Trust boundary: clients can never write balances, ledgers or payments.
-- Coins are credited only by internal_credit_payment(), which is callable only
-- by the service role from the verified Stripe webhook. Every money movement
-- happens in one transaction under a row lock and writes an append-only ledger
-- row with a unique idempotency key.

create table public.wallets (
  user_id text primary key references public.profiles(id) on delete cascade,
  coin_balance bigint not null default 0 check (coin_balance >= 0),
  frozen boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.coin_transactions (
  id bigint generated always as identity primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  delta bigint not null check (delta <> 0),
  balance_after bigint not null check (balance_after >= 0),
  kind text not null check (kind in ('purchase', 'gift_sent', 'refund', 'chargeback', 'adjustment')),
  ref_type text,
  ref_id text,
  idempotency_key text unique not null,
  created_at timestamptz not null default now()
);
create index coin_transactions_user_idx on public.coin_transactions (user_id, created_at desc);

create table public.gift_catalog (
  id int generated always as identity primary key,
  name text not null,
  icon text not null,
  coin_price int not null check (coin_price > 0),
  active boolean not null default true,
  sort int not null default 0
);

create table public.gifts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id),
  stream_id uuid references public.streams(id),
  sender_id text not null references public.profiles(id),
  host_id text not null references public.hosts(user_id),
  gift_id int not null references public.gift_catalog(id),
  quantity int not null check (quantity between 1 and 999),
  coins_total bigint not null check (coins_total > 0),
  host_share bigint not null check (host_share >= 0),
  stream_share bigint not null check (stream_share >= 0),
  owner_share bigint not null check (owner_share >= 0),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (sender_id, idempotency_key),
  check (host_share + stream_share + owner_share = coins_total)
);
create index gifts_host_idx on public.gifts (host_id, created_at desc);
create index gifts_stream_idx on public.gifts (stream_id);
create index gifts_created_idx on public.gifts (created_at desc);

create table public.creator_earnings (
  host_id text primary key references public.hosts(user_id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  held bigint not null default 0 check (held >= 0),
  lifetime bigint not null default 0 check (lifetime >= 0),
  updated_at timestamptz not null default now()
);

create table public.earning_entries (
  id bigint generated always as identity primary key,
  host_id text not null references public.hosts(user_id) on delete cascade,
  delta bigint not null,
  kind text not null check (kind in ('gift', 'withdrawal_hold', 'withdrawal_release', 'withdrawal_paid', 'adjustment')),
  ref_id text,
  created_at timestamptz not null default now()
);
create index earning_entries_host_idx on public.earning_entries (host_id, created_at desc);

-- Owner-side ledger (gift owner share in coins, purchase allocations in money).
create table public.platform_ledger (
  id bigint generated always as identity primary key,
  bucket text not null,
  unit text not null check (unit in ('coins', 'minor')),
  currency text,
  amount bigint not null,
  ref_type text,
  ref_id text,
  created_at timestamptz not null default now()
);

create table public.coin_packages (
  id int generated always as identity primary key,
  name text not null,
  coins bigint not null check (coins > 0),
  price_minor bigint not null check (price_minor > 0),
  currency text not null default 'pkr',
  active boolean not null default true,
  sort int not null default 0
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(id),
  provider text not null default 'stripe',
  provider_ref text,                  -- Stripe Checkout Session id
  provider_payment_ref text,          -- Stripe PaymentIntent id (refunds/disputes)
  package_id int references public.coin_packages(id),
  coins bigint not null check (coins > 0),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  agency_id uuid references public.agencies(id),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'refunded', 'disputed', 'dispute_lost')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index payments_user_idx on public.payments (user_id, created_at desc);
create index payments_intent_idx on public.payments (provider_payment_ref);

-- Replay protection: each provider event is processed at most once.
create table public.processed_webhook_events (
  provider text not null,
  event_id text not null,
  processed_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  user_id text not null references public.profiles(id),
  reason text not null check (char_length(reason) between 5 and 500),
  status text not null default 'requested' check (status in ('requested', 'approved', 'denied')),
  reviewed_by text references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (payment_id)
);

create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  host_id text not null references public.hosts(user_id),
  coins bigint not null check (coins > 0),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'pkr',
  payout_method jsonb not null,
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'paid')),
  reviewed_by text references public.profiles(id),
  review_note text,
  payout_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index withdrawals_host_idx on public.withdrawals (host_id, created_at desc);

-- Helpers --------------------------------------------------------------------

create or replace function private.setting(p_key text)
returns jsonb language sql stable security definer set search_path = ''
as $$ select value from public.platform_settings where key = p_key $$;

-- Locks (creating if needed) and returns the wallet row.
create or replace function private.lock_wallet(p_user text)
returns public.wallets language plpgsql security definer set search_path = ''
as $$
declare v public.wallets;
begin
  insert into public.wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into v from public.wallets where user_id = p_user for update;
  return v;
end $$;

-- Applies a ledgered balance change. Negative results are rejected by the
-- CHECK constraint, so a debit can never overdraw.
create or replace function private.apply_coin_delta(
  p_user text, p_delta bigint, p_kind text, p_ref_type text, p_ref_id text, p_idempotency_key text
)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare v_balance bigint;
begin
  update public.wallets set coin_balance = coin_balance + p_delta, updated_at = now()
  where user_id = p_user returning coin_balance into v_balance;
  insert into public.coin_transactions (user_id, delta, balance_after, kind, ref_type, ref_id, idempotency_key)
  values (p_user, p_delta, v_balance, p_kind, p_ref_type, p_ref_id, p_idempotency_key);
  return v_balance;
end $$;

-- Gift engine ------------------------------------------------------------------

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
  update public.creator_earnings
    set balance = balance + v_host, lifetime = lifetime + v_host, updated_at = now()
    where host_id = v_room.host_id;
  insert into public.earning_entries (host_id, delta, kind, ref_id) values (v_room.host_id, v_host, 'gift', v_row.id::text);

  if v_room.current_stream_id is not null then
    update public.streams set gift_coins = gift_coins + v_total, pool_coins = pool_coins + v_stream
      where id = v_room.current_stream_id;
  end if;
  insert into public.platform_ledger (bucket, unit, amount, ref_type, ref_id)
    values ('gift_owner_share', 'coins', v_owner, 'gift', v_row.id::text);

  return v_row;
end $$;

-- Payments (service role only) -------------------------------------------------

-- Creates the pending payment row before redirecting to Stripe.
create or replace function public.internal_create_payment(p_user text, p_package_id int)
returns public.payments language plpgsql security definer set search_path = ''
as $$
declare v_pkg public.coin_packages; v_row public.payments;
begin
  select * into v_pkg from public.coin_packages where id = p_package_id and active;
  if not found then raise exception 'invalid_package'; end if;
  if public.user_status(p_user) = 'banned' then raise exception 'account_restricted'; end if;
  insert into public.payments (user_id, package_id, coins, amount_minor, currency)
  values (p_user, v_pkg.id, v_pkg.coins, v_pkg.price_minor, v_pkg.currency)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.internal_attach_payment_ref(p_payment_id uuid, p_provider_ref text)
returns void language sql security definer set search_path = ''
as $$ update public.payments set provider_ref = p_provider_ref where id = p_payment_id and provider_ref is null $$;

-- Credits coins for a verified, paid Checkout Session. Idempotent: a replayed
-- or duplicated webhook returns credited=false and changes nothing.
create or replace function public.internal_credit_payment(
  p_provider_ref text, p_payment_intent text, p_amount_minor bigint, p_currency text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v public.payments;
  v_split jsonb := private.setting('purchase_split');
  v_agency bigint := 0;
  v_platform bigint;
  v_reserve bigint;
  v_internal bigint;
  v_livekit bigint;
  v_balance bigint;
begin
  select * into v from public.payments where provider = 'stripe' and provider_ref = p_provider_ref for update;
  if not found then raise exception 'unknown_payment'; end if;
  if v.status <> 'pending' then
    return jsonb_build_object('credited', false, 'reason', 'already_processed', 'status', v.status);
  end if;
  if v.amount_minor <> p_amount_minor or lower(v.currency) <> lower(p_currency) then
    update public.payments set status = 'failed' where id = v.id;
    perform private.audit('payment_amount_mismatch', 'payment', v.id::text,
      jsonb_build_object('expected', v.amount_minor, 'got', p_amount_minor, 'currency', p_currency), 'system');
    return jsonb_build_object('credited', false, 'reason', 'amount_mismatch');
  end if;

  update public.payments set status = 'paid', paid_at = now(), provider_payment_ref = p_payment_intent where id = v.id;
  perform private.lock_wallet(v.user_id);
  v_balance := private.apply_coin_delta(v.user_id, v.coins, 'purchase', 'payment', v.id::text, 'payment:' || v.id);

  -- Money path: agency margin -> platform -> coin reserve / internal -> LiveKit / owner.
  if v.agency_id is not null then
    v_agency := (v.amount_minor * (v_split ->> 'agency_margin_bps')::int) / 10000;
  end if;
  v_platform := v.amount_minor - v_agency;
  v_reserve := (v_platform * (v_split ->> 'coin_reserve_bps_of_platform')::int) / 10000;
  v_internal := v_platform - v_reserve;
  v_livekit := (v_internal * (v_split ->> 'livekit_bps_of_internal')::int) / 10000;

  insert into public.platform_ledger (bucket, unit, currency, amount, ref_type, ref_id)
  select b, 'minor', v.currency, a, 'payment', v.id::text
  from (values ('agency_margin', v_agency), ('coin_reserve', v_reserve),
               ('livekit_reserve', v_livekit), ('owner_revenue', v_internal - v_livekit)) t(b, a)
  where a <> 0;

  perform private.notify(v.user_id, 'coins_credited', 'Coins added',
    v.coins || ' coins were added to your wallet.', jsonb_build_object('payment_id', v.id));
  return jsonb_build_object('credited', true, 'coins', v.coins, 'balance', v_balance);
end $$;

-- Reverses up to the purchased coins; any shortfall is absorbed by the
-- platform and the account is flagged for review.
create or replace function private.reverse_payment_coins(v public.payments, p_kind text)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare v_wallet public.wallets; v_debit bigint; v_shortfall bigint;
begin
  v_wallet := private.lock_wallet(v.user_id);
  v_debit := least(v_wallet.coin_balance, v.coins);
  if v_debit > 0 then
    perform private.apply_coin_delta(v.user_id, -v_debit, p_kind, 'payment', v.id::text, p_kind || ':' || v.id);
  end if;
  v_shortfall := v.coins - v_debit;
  if v_shortfall > 0 then
    insert into public.platform_ledger (bucket, unit, amount, ref_type, ref_id)
      values (p_kind || '_shortfall', 'coins', -v_shortfall, 'payment', v.id::text);
    insert into public.moderation_actions (target_user_id, action, reason, source)
      values (v.user_id, 'account_review', p_kind || ': ' || v_shortfall || ' coins already spent', 'system');
  end if;
  return v_shortfall;
end $$;

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
  perform private.audit('payment_refunded', 'payment', v.id::text, jsonb_build_object('shortfall', v_short), 'system');
  return jsonb_build_object('reversed', true, 'shortfall', v_short);
end $$;

-- Chargebacks: freeze during the dispute; losing debits the platform and flags the account.
create or replace function public.internal_dispute_payment(p_payment_intent text, p_stage text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v public.payments; v_short bigint;
begin
  if p_stage not in ('opened', 'won', 'lost') then raise exception 'invalid_stage'; end if;
  select * into v from public.payments where provider_payment_ref = p_payment_intent for update;
  if not found then raise exception 'unknown_payment'; end if;

  if p_stage = 'opened' then
    if v.status <> 'paid' then return jsonb_build_object('changed', false, 'status', v.status); end if;
    update public.payments set status = 'disputed' where id = v.id;
    perform private.lock_wallet(v.user_id);
    update public.wallets set frozen = true, updated_at = now() where user_id = v.user_id;
  elsif p_stage = 'won' then
    if v.status <> 'disputed' then return jsonb_build_object('changed', false, 'status', v.status); end if;
    update public.payments set status = 'paid' where id = v.id;
    if not exists (select 1 from public.payments where user_id = v.user_id and status = 'disputed') then
      update public.wallets set frozen = false, updated_at = now() where user_id = v.user_id;
    end if;
  else
    if v.status <> 'disputed' then return jsonb_build_object('changed', false, 'status', v.status); end if;
    update public.payments set status = 'dispute_lost' where id = v.id;
    v_short := private.reverse_payment_coins(v, 'chargeback');
    insert into public.platform_ledger (bucket, unit, currency, amount, ref_type, ref_id)
      values ('chargeback_loss', 'minor', v.currency, -v.amount_minor, 'payment', v.id::text);
    insert into public.moderation_actions (target_user_id, action, reason, source)
      values (v.user_id, 'account_review', 'Lost chargeback on payment ' || v.id, 'system');
  end if;
  perform private.audit('payment_dispute_' || p_stage, 'payment', v.id::text, '{}', 'system');
  return jsonb_build_object('changed', true, 'status', p_stage);
end $$;

-- Refund requests (user) and review (admin) ------------------------------------

create or replace function public.request_refund(p_payment_id uuid, p_reason text)
returns public.refund_requests language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_row public.refund_requests;
begin
  if not exists (select 1 from public.payments where id = p_payment_id and user_id = uid and status = 'paid') then
    raise exception 'payment_not_refundable';
  end if;
  insert into public.refund_requests (payment_id, user_id, reason) values (p_payment_id, uid, p_reason)
  returning * into v_row;
  return v_row;
end $$;

-- Approval reverses coins in-app; the money is then refunded in Stripe and the
-- charge.refunded webhook finds the payment already refunded (no double reversal).
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
    if v.status = 'paid' then
      update public.payments set status = 'refunded' where id = v.id;
      perform private.reverse_payment_coins(v, 'refund');
    end if;
  end if;
  update public.refund_requests set status = case when p_approve then 'approved' else 'denied' end,
    reviewed_by = public.requesting_user_id() where id = p_request_id returning * into v_req;
  perform private.audit('refund_' || v_req.status, 'refund_request', p_request_id::text);
  perform private.notify(v_req.user_id, 'refund', 'Refund ' || v_req.status, null, jsonb_build_object('payment_id', v_req.payment_id));
  return v_req;
end $$;

-- Withdrawals ------------------------------------------------------------------

create or replace function public.request_withdrawal(p_coins bigint, p_payout_method jsonb)
returns public.withdrawals language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v_cfg jsonb := private.setting('withdrawal');
  v_rate numeric := (v_cfg ->> 'pkr_per_coin')::numeric;
  v_earn public.creator_earnings;
  v_row public.withdrawals;
begin
  if not exists (select 1 from public.hosts where user_id = uid and status = 'active') then raise exception 'not_a_host'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if v_rate is null or v_rate <= 0 then raise exception 'withdrawals_not_configured'; end if;
  if p_coins is null or p_coins < (v_cfg ->> 'min_coins')::bigint then raise exception 'below_minimum'; end if;
  if p_payout_method is null or jsonb_typeof(p_payout_method) <> 'object' or not (p_payout_method ? 'type') then
    raise exception 'invalid_payout_method';
  end if;

  select * into v_earn from public.creator_earnings where host_id = uid for update;
  if not found or v_earn.balance < p_coins then raise exception 'insufficient_earnings'; end if;

  update public.creator_earnings set balance = balance - p_coins, held = held + p_coins, updated_at = now()
    where host_id = uid;
  insert into public.withdrawals (host_id, coins, amount_minor, currency, payout_method)
    values (uid, p_coins, floor(p_coins * v_rate * 100)::bigint, 'pkr', p_payout_method)
    returning * into v_row;
  insert into public.earning_entries (host_id, delta, kind, ref_id) values (uid, -p_coins, 'withdrawal_hold', v_row.id::text);
  return v_row;
end $$;

create or replace function public.review_withdrawal(p_withdrawal_id uuid, p_approve boolean, p_note text default null)
returns public.withdrawals language plpgsql security definer set search_path = ''
as $$
declare v public.withdrawals;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  select * into v from public.withdrawals where id = p_withdrawal_id and status = 'requested' for update;
  if not found then raise exception 'not_found'; end if;
  perform 1 from public.creator_earnings where host_id = v.host_id for update;
  if p_approve then
    update public.creator_earnings set held = held - v.coins, updated_at = now() where host_id = v.host_id;
  else
    update public.creator_earnings set held = held - v.coins, balance = balance + v.coins, updated_at = now()
      where host_id = v.host_id;
    insert into public.earning_entries (host_id, delta, kind, ref_id) values (v.host_id, v.coins, 'withdrawal_release', v.id::text);
  end if;
  update public.withdrawals set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = public.requesting_user_id(), review_note = p_note, updated_at = now()
    where id = v.id returning * into v;
  perform private.audit('withdrawal_' || v.status, 'withdrawal', v.id::text, jsonb_build_object('coins', v.coins));
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
  return v;
end $$;

-- Seed data --------------------------------------------------------------------

insert into public.gift_catalog (name, icon, coin_price, sort) values
  ('Rose', '🌹', 1, 1), ('Chai', '☕', 5, 2), ('Heart', '💖', 10, 3), ('Star', '⭐', 49, 4),
  ('Crown', '👑', 99, 5), ('Rocket', '🚀', 499, 6), ('Palace', '🏰', 999, 7), ('Galaxy', '🌌', 4999, 8);

-- Five coin packages (price in paisa; Stripe treats PKR as a two-decimal currency).
insert into public.coin_packages (name, coins, price_minor, currency, sort) values
  ('Starter', 140, 20000, 'pkr', 1),  -- stays above Stripe's minimum charge
  ('Popular', 350, 50000, 'pkr', 2),
  ('Value', 700, 100000, 'pkr', 3),
  ('Big', 2000, 300000, 'pkr', 4),
  ('Mega', 7000, 1000000, 'pkr', 5);
