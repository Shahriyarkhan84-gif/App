-- Stripe Checkout sessions that expire (customer never paid) or whose delayed payment fails
-- (checkout.session.expired / checkout.session.async_payment_failed) close their pending payment
-- row as 'failed', so the payments list shows what really happened. Never touches coins: only a
-- still-pending row changes, and a payment that was already credited stays paid.
-- Service role only (stripe-webhook). Safe to run more than once.
create or replace function public.internal_fail_payment(p_provider_ref text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v public.payments;
begin
  update public.payments set status = 'failed'
    where provider = 'stripe' and provider_ref = p_provider_ref and status = 'pending'
    returning * into v;
  if not found then return jsonb_build_object('changed', false); end if;
  perform private.audit('payment_failed', 'payment', v.id::text, '{}', 'system');
  return jsonb_build_object('changed', true);
end $$;
revoke execute on function public.internal_fail_payment(text) from public, anon, authenticated;
grant execute on function public.internal_fail_payment(text) to service_role;
