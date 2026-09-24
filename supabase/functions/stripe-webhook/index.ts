// Stripe webhook: the only path that credits coins. Signature-verified,
// replay-protected (processed_webhook_events) and backed by idempotent RPCs.
// Subscribe to: checkout.session.completed, checkout.session.async_payment_succeeded,
// charge.refunded, charge.dispute.created, charge.dispute.closed
import type Stripe from 'npm:stripe@18';

import { json, requireEnv } from '../_shared/cors.ts';
import { cryptoProvider, getStripe } from '../_shared/stripe.ts';
import { adminClient, alreadyProcessed, markEventProcessed } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const stripe = getStripe();
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      req.headers.get('Stripe-Signature') ?? '',
      requireEnv('STRIPE_WEBHOOK_SECRET'),
      undefined,
      cryptoProvider,
    );
  } catch {
    return json({ error: { code: 'invalid_signature', message: 'Invalid signature' } }, 400);
  }

  if (await alreadyProcessed('stripe', event.id)) return json({ duplicate: true });

  try {
    await handle(event);
  } catch (err) {
    console.error('stripe webhook failed', event.type, err);
    return json({ error: { code: 'internal', message: 'Handler failed' } }, 500); // Stripe retries
  }

  await markEventProcessed('stripe', event.id);
  return json({ received: true });
});

const intentId = (pi: string | Stripe.PaymentIntent | null) => (typeof pi === 'string' ? pi : pi?.id ?? null);

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await adminClient().rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  console.log(name, JSON.stringify(data));
}

async function handle(event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      if (session.mode !== 'payment' || session.payment_status !== 'paid') return;
      await rpc('internal_credit_payment', {
        p_provider_ref: session.id,
        p_payment_intent: intentId(session.payment_intent),
        p_amount_minor: session.amount_total,
        p_currency: session.currency,
      });
      break;
    }
    case 'charge.refunded': {
      const charge = event.data.object;
      if (!charge.refunded) return; // partial refunds are handled manually
      await rpc('internal_refund_payment', { p_payment_intent: intentId(charge.payment_intent) });
      break;
    }
    case 'charge.dispute.created':
      await rpc('internal_dispute_payment', { p_payment_intent: intentId(event.data.object.payment_intent), p_stage: 'opened' });
      break;
    case 'charge.dispute.closed': {
      const dispute = event.data.object;
      if (dispute.status !== 'won' && dispute.status !== 'lost') return;
      await rpc('internal_dispute_payment', { p_payment_intent: intentId(dispute.payment_intent), p_stage: dispute.status });
      break;
    }
  }
}
