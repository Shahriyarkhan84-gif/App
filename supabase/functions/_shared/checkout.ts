// One Stripe Checkout page per pending payment, shared by coins-checkout (in the app) and
// recharge (the web recharge link). Coins are credited only from what Stripe reports to the server
// (stripe-webhook or payments-reconcile). With STRIPE_PUBLISHABLE_KEY set, buyers pay on Zynalive's
// own page (zynalive.com/pay, a Checkout session in Elements mode); without it, on Stripe's hosted page.
import { HttpError, requireEnv } from './cors.ts';
import { payPageUrl } from './payments.ts';
import type { Stripe } from './stripe.ts';
import type { adminClient } from './supabase.ts';

// Elements-mode sessions use the current API (ui_mode 'elements'); zynalive.com/pay loads the
// matching Stripe.js version (js.stripe.com/dahlia).
const ELEMENTS_API_VERSION = '2026-08-26.dahlia';

export type Payment = { id: string; provider_ref: string | null; created_at: string; currency: string; amount_minor: number; coins: number };
type Db = ReturnType<typeof adminClient>;

/**
 * The page to pay `payment` on. `createPayment` returns the pending payment (a retry gets the same
 * one back from the database, so here it gets the same Stripe page back too).
 */
export async function checkoutPage(opts: {
  db: Db;
  stripe: Stripe;
  createPayment: () => Promise<Payment>;
  successUrl: string;
  backUrl: string;
  clientReference: string;
  email?: () => Promise<{ customer_email?: string }>;
}): Promise<string> {
  const { db, stripe, successUrl, backUrl } = opts;
  // Own payment page only when the publishable key is set and in the same mode as the secret key.
  const publishableKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY') ?? '';
  const keyMode = (k: string) => (/_live_/.test(k) ? 'live' : /_test_/.test(k) ? 'test' : null);
  const ownPage = /^pk_/.test(publishableKey) && keyMode(publishableKey) === keyMode(requireEnv('STRIPE_SECRET_KEY'));
  const pageFor = (s: { url: string | null; client_secret: string | null }) =>
    s.url ?? (s.client_secret && ownPage
      ? payPageUrl(requireEnv('SITE_URL'), { clientSecret: s.client_secret, publishableKey, returnUrl: successUrl, backUrl })
      : null);

  let payment = await opts.createPayment();
  if (payment.provider_ref) {
    const existing = await stripe.checkout.sessions.retrieve(payment.provider_ref);
    const reuse = existing.status === 'open' ? pageFor(existing) : null;
    if (reuse) return reuse;
    // Paid, but the webhook hasn't credited it yet: never open a second page.
    if (existing.status === 'complete') throw new HttpError(409, 'payment_processing', 'Your payment is being confirmed');
    // Expired unpaid page: close that payment and start a new one.
    await db.rpc('internal_fail_payment', { p_provider_ref: payment.provider_ref });
    payment = await opts.createPayment();
  }

  // Card, Link and the other payment methods turned on in the Dashboard are offered automatically
  // (no payment_method_types). Adaptive Pricing shows a local-currency price to buyers abroad; the
  // session's amount_total/currency stay in the package currency, which the webhook checks.
  const params = {
    mode: 'payment',
    adaptive_pricing: { enabled: true },
    // Fixed per payment (62 min after it was created; a pending payment is reused for at most 30),
    // so a concurrent retry sends identical parameters and Stripe's idempotency returns the same page.
    // The webhook or the reconciler marks the payment failed when the page expires unpaid.
    expires_at: Math.floor(new Date(payment.created_at).getTime() / 1000) + 62 * 60,
    client_reference_id: opts.clientReference,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: payment.currency,
          unit_amount: payment.amount_minor,
          product_data: { name: `${payment.coins} Zynalive coins` },
        },
      },
    ],
    metadata: { payment_id: payment.id },
    payment_intent_data: { metadata: { payment_id: payment.id } },
    ...(ownPage
      ? { ui_mode: 'elements', return_url: successUrl, ...(opts.email ? await opts.email() : {}) }
      : { success_url: successUrl, cancel_url: backUrl }),
  } as unknown as Stripe.Checkout.SessionCreateParams;

  let session;
  try {
    session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: `checkout:${payment.id}`, // one Stripe page per payment, ever
      ...(ownPage ? { apiVersion: ELEMENTS_API_VERSION } : {}),
    });
  } catch (err) {
    // Same payment started from another device (different return address): finish that page first.
    if ((err as { type?: string }).type === 'StripeIdempotencyError') throw new HttpError(409, 'checkout_in_progress');
    throw err;
  }

  const { error: attachError } = await db.rpc('internal_attach_payment_ref', { p_payment_id: payment.id, p_provider_ref: session.id });
  if (attachError) throw attachError;

  const url = pageFor(session);
  if (!url) throw new Error('Checkout session has no page');
  return url;
}
