-- Web recharge link (zynalive.com/recharge, optionally ?a=<agency code>): anyone pays by card for
-- a Zynalive ID. Card payments made through an agency's link carry payments.agency_id, so the
-- existing purchase split records the agency's margin (purchase_split.agency_margin_bps).
-- Both functions are for the `recharge` Edge Function only (rate-limited per visitor there).

-- What the payer sees before paying: the account's name and photo (to check it's the right
-- person) and that account's packages. Nothing else about the account is returned.
create or replace function public.internal_recharge_lookup(p_user_number bigint, p_agency_code text default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_user public.profiles; v_region text; v_agency text;
begin
  select * into v_user from public.profiles where user_number = p_user_number;
  if not found or public.user_status(v_user.id) = 'banned' then raise exception 'user_not_found'; end if;
  if v_user.age_check = 'minor' then raise exception 'under_18'; end if;
  if nullif(p_agency_code, '') is not null then
    select name into v_agency from public.agencies where code = p_agency_code and status = 'active';
    if v_agency is null then raise exception 'invalid_agency_code'; end if;
  end if;
  v_region := private.user_region(v_user.id);
  return jsonb_build_object(
    'name', coalesce(v_user.display_name, v_user.username, 'Zynalive user'),
    'avatar_url', v_user.avatar_url,
    'user_number', v_user.user_number,
    'agency', v_agency,
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'coins', coins, 'price_minor', price_minor, 'currency', currency) order by sort)
                 from public.coin_packages where active and region = v_region), '[]'));
end $$;

-- A pending card payment for that account, attributed to the agency when the link has one.
-- A retry within 30 minutes (same account, package and agency) returns the same payment, so the
-- payer gets the same Stripe page back, like the in-app checkout.
create or replace function public.internal_create_recharge_payment(p_user_number bigint, p_package_id int, p_agency_code text default null)
returns public.payments language plpgsql security definer set search_path = ''
as $$
declare v_user public.profiles; v_pkg public.coin_packages; v_agency uuid; v_row public.payments;
begin
  select * into v_user from public.profiles where user_number = p_user_number;
  if not found or public.user_status(v_user.id) = 'banned' then raise exception 'user_not_found'; end if;
  if v_user.age_check = 'minor' then raise exception 'under_18'; end if;
  select * into v_pkg from public.coin_packages where id = p_package_id and active;
  if not found or v_pkg.region <> private.user_region(v_user.id) then raise exception 'invalid_package'; end if;
  if nullif(p_agency_code, '') is not null then
    select id into v_agency from public.agencies where code = p_agency_code and status = 'active';
    if v_agency is null then raise exception 'invalid_agency_code'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('checkout:' || v_user.id, 0));
  select * into v_row from public.payments
    where user_id = v_user.id and package_id = v_pkg.id and status = 'pending' and provider = 'stripe'
      and agency_id is not distinct from v_agency and created_at > now() - interval '30 minutes'
    order by created_at desc limit 1;
  if found then return v_row; end if;

  insert into public.payments (user_id, package_id, coins, amount_minor, currency, agency_id)
    values (v_user.id, v_pkg.id, v_pkg.coins, v_pkg.price_minor, v_pkg.currency, v_agency)
    returning * into v_row;
  return v_row;
end $$;

revoke all on function public.internal_recharge_lookup(bigint, text), public.internal_create_recharge_payment(bigint, int, text) from public, anon, authenticated;
grant execute on function public.internal_recharge_lookup(bigint, text), public.internal_create_recharge_payment(bigint, int, text) to service_role;
