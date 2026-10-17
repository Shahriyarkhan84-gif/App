// Brings the signed-in buyer's pending coin payments in line with Stripe, so coins never depend
// on the webhook alone (a missed or misconfigured webhook used to leave payments 'pending' and
// paid coins uncredited). Asks Stripe for each open checkout and applies the same RPCs as
// stripe-webhook: internal_credit_payment for a paid session (amount-checked, credits once),
// internal_fail_payment for an expired one. Called by the Wallet screen. Never trusts the client.
import { requireUser } from '../_shared/auth.ts';
import { handler, json } from '../_shared/cors.ts';
import { sessionOutcome } from '../_shared/payments.ts';
import { rateLimit } from '../_shared/redis.ts';
import { getStripe } from '../_shared/stripe.ts';
import { adminClient } from '../_shared/supabase.ts';

const MAX_PER_CALL = 5;

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    await rateLimit('payments-reconcile', userId, 10, '1 m');
    const db = adminClient();
    const stripe = getStripe();

    const { data: pending, error } = await db.from('payments')
      .select('provider_ref')
      .eq('user_id', userId).eq('provider', 'stripe').eq('status', 'pending')
      .not('provider_ref', 'is', null)
      .order('created_at', { ascending: false })
      .limit(MAX_PER_CALL);
    if (error) throw error;

    const result = { credited: 0, failed: 0, pending: 0 };
    for (const { provider_ref } of pending ?? []) {
      const session = await stripe.checkout.sessions.retrieve(provider_ref as string);
      const outcome = sessionOutcome(session);
      if (outcome === 'credit') {
        const { data, error: e } = await db.rpc('internal_credit_payment', {
          p_provider_ref: session.id,
          p_payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
          p_amount_minor: session.amount_total,
          p_currency: session.currency,
        });
        if (e) throw e;
        if ((data as { credited?: boolean })?.credited) result.credited++;
      } else if (outcome === 'fail') {
        const { data, error: e } = await db.rpc('internal_fail_payment', { p_provider_ref: session.id });
        if (e) throw e;
        if ((data as { changed?: boolean })?.changed) result.failed++;
      } else {
        result.pending++;
      }
    }

    // Checkouts that never reached Stripe can't be looked up; close them once they're too old to reuse.
    const { data: expired, error: e2 } = await db.rpc('internal_expire_unstarted_payments', { p_user: userId });
    if (e2) throw e2;
    result.failed += (expired as number) ?? 0;

    if (result.credited || result.failed) console.log('reconciled', userId, JSON.stringify(result));
    return json(result);
  }),
);
