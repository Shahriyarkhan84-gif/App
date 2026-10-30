-- In-app purchases: diamond packages bought through Google Play Billing or the Apple App Store.
-- The app never credits anything itself. The iap-verify Edge Function asks Google or Apple about
-- the purchase and, only when the store says it is paid, calls internal_credit_store_purchase()
-- with what the store returned. Store refunds go through the existing internal_refund_payment().

-- Store product IDs (the same ID in Play Console and App Store Connect). One product per diamond
-- amount, sold worldwide; the store sets each country's price, so regions share product IDs.
alter table public.coin_packages add column if not exists store_product_id text
  check (store_product_id is null or store_product_id ~ '^[a-z0-9_.]{3,100}$');
update public.coin_packages set store_product_id = 'zynalive_diamonds_' || coins
  where store_product_id is null and coins in (140, 350, 700, 2000, 7000);
create index if not exists coin_packages_store_product_idx on public.coin_packages (store_product_id);

-- Google and Apple keep a share of each sale. Recorded before the usual purchase split so the
-- owner's revenue in the ledger is what actually arrives (15% = both stores' small-business rate).
insert into public.platform_settings (key, value)
  values ('store_fees', '{"google_play_bps": 1500, "app_store_bps": 1500}')
  on conflict (key) do nothing;

-- Credits one verified store purchase. p_purchase_ref is the Google purchase token or the Apple
-- transaction id; p_order_ref is what refunds name (Google order id / Apple transaction id).
-- Idempotent: the same purchase credits once, and a purchase can never be claimed by another user.
create or replace function public.internal_credit_store_purchase(
  p_user text, p_provider text, p_product_id text, p_purchase_ref text, p_order_ref text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_pkg public.coin_packages;
  v public.payments;
  v_split jsonb := private.setting('purchase_split');
  v_fee_bps int;
  v_fee bigint;
  v_platform bigint;
  v_reserve bigint;
  v_internal bigint;
  v_livekit bigint;
  v_balance bigint;
begin
  if p_provider not in ('google_play', 'app_store') then raise exception 'invalid_provider'; end if;
  if coalesce(p_purchase_ref, '') = '' or coalesce(p_order_ref, '') = '' then raise exception 'invalid_purchase'; end if;

  perform pg_advisory_xact_lock(hashtextextended('store:' || p_provider || ':' || p_purchase_ref, 0));
  select * into v from public.payments where provider = p_provider and provider_ref = p_purchase_ref;
  if found then
    if v.user_id <> p_user then
      perform private.audit('store_purchase_reused', 'payment', v.id::text,
        jsonb_build_object('claimed_by', p_user), 'system');
      raise exception 'purchase_not_yours';
    end if;
    return jsonb_build_object('credited', false, 'reason', 'already_processed', 'status', v.status);
  end if;

  -- The buyer's own region first (that sets the ledger amount), else any active package.
  select * into v_pkg from public.coin_packages
    where store_product_id = p_product_id and active
    order by (region = private.user_region(p_user)) desc, id
    limit 1;
  if not found then raise exception 'invalid_package'; end if;
  if public.user_status(p_user) = 'banned' then raise exception 'account_restricted'; end if;
  if (select age_check from public.profiles where id = p_user) = 'minor' then raise exception 'under_18'; end if;

  insert into public.payments (user_id, provider, provider_ref, provider_payment_ref, package_id, coins,
                               amount_minor, currency, status, paid_at)
    values (p_user, p_provider, p_purchase_ref,
            case p_provider when 'google_play' then 'gp:' else 'as:' end || p_order_ref,
            v_pkg.id, v_pkg.coins, v_pkg.price_minor, v_pkg.currency, 'paid', now())
    returning * into v;

  perform private.lock_wallet(p_user);
  v_balance := private.apply_coin_delta(p_user, v.coins, 'purchase', 'payment', v.id::text, 'payment:' || v.id);

  -- Store fee, then the same split as card purchases (no agency margin: stores pay us directly).
  v_fee_bps := coalesce((private.setting('store_fees') ->> (case p_provider when 'google_play' then 'google_play_bps' else 'app_store_bps' end))::int, 1500);
  v_fee := (v.amount_minor * v_fee_bps) / 10000;
  v_platform := v.amount_minor - v_fee;
  v_reserve := (v_platform * (v_split ->> 'coin_reserve_bps_of_platform')::int) / 10000;
  v_internal := v_platform - v_reserve;
  v_livekit := (v_internal * (v_split ->> 'livekit_bps_of_internal')::int) / 10000;

  insert into public.platform_ledger (bucket, unit, currency, amount, ref_type, ref_id)
  select b, 'minor', v.currency, a, 'payment', v.id::text
  from (values ('store_fee', v_fee), ('coin_reserve', v_reserve),
               ('livekit_reserve', v_livekit), ('owner_revenue', v_internal - v_livekit)) t(b, a)
  where a <> 0;

  perform private.audit('store_purchase_credited', 'payment', v.id::text,
    jsonb_build_object('provider', p_provider, 'product', p_product_id, 'coins', v.coins), 'system');
  perform private.notify(p_user, 'coins_credited', 'Coins added',
    v.coins || ' coins were added to your wallet.', jsonb_build_object('payment_id', v.id));
  return jsonb_build_object('credited', true, 'coins', v.coins, 'balance', v_balance, 'payment_id', v.id);
end $$;

revoke execute on function public.internal_credit_store_purchase(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.internal_credit_store_purchase(text, text, text, text, text) to service_role;
