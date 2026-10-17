-- Payment reconciliation (payments-reconcile Edge Function). Stripe's webhook is no longer the
-- only way a payment leaves 'pending': the function also asks Stripe directly and applies the
-- same internal_credit_payment / internal_fail_payment. This adds the one case Stripe can't
-- report: a payment row whose checkout page was never created (the request died before Stripe
-- answered). After 2 hours it can no longer be reused (reuse window: 30 min), so it is closed.
-- Never touches coins or paid payments. Service role only. Safe to run more than once.
create or replace function public.internal_expire_unstarted_payments(p_user text, p_older_than interval default interval '2 hours')
returns int language plpgsql security definer set search_path = ''
as $$
declare v_count int;
begin
  with closed as (
    update public.payments set status = 'failed'
      where user_id = p_user and provider = 'stripe' and status = 'pending'
        and provider_ref is null and created_at < now() - p_older_than
      returning id
  )
  select count(*) into v_count from closed;
  if v_count > 0 then
    perform private.audit('payment_unstarted_expired', 'user', p_user, jsonb_build_object('count', v_count), 'system');
  end if;
  return v_count;
end $$;
revoke execute on function public.internal_expire_unstarted_payments(text, interval) from public, anon, authenticated;
grant execute on function public.internal_expire_unstarted_payments(text, interval) to service_role;
