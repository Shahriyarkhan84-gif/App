-- One open checkout per buyer and package: a retry after a dropped connection (or a double tap)
-- gets the same pending payment back instead of a new one, so coins-checkout returns the same Stripe
-- Checkout page and the buyer can't end up paying twice. Concurrent calls for the same buyer are
-- serialised with a per-user transaction lock. A pending payment older than 30 minutes is not reused
-- (its Stripe session has expired or is about to); a paid one never is. Safe to run more than once.
create or replace function public.internal_create_payment(p_user text, p_package_id int)
returns public.payments language plpgsql security definer set search_path = ''
as $$
declare v_pkg public.coin_packages; v_row public.payments;
begin
  select * into v_pkg from public.coin_packages where id = p_package_id and active;
  if not found then raise exception 'invalid_package'; end if;
  if v_pkg.region <> private.user_region(p_user) then raise exception 'invalid_package'; end if;
  if public.user_status(p_user) = 'banned' then raise exception 'account_restricted'; end if;

  perform pg_advisory_xact_lock(hashtextextended('checkout:' || p_user, 0));
  select * into v_row from public.payments
    where user_id = p_user and package_id = v_pkg.id and status = 'pending'
      and provider = 'stripe' and created_at > now() - interval '30 minutes'
    order by created_at desc limit 1;
  if found then return v_row; end if;

  insert into public.payments (user_id, package_id, coins, amount_minor, currency)
  values (p_user, v_pkg.id, v_pkg.coins, v_pkg.price_minor, v_pkg.currency)
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.internal_create_payment(text, int) from public, anon, authenticated;
grant execute on function public.internal_create_payment(text, int) to service_role;
