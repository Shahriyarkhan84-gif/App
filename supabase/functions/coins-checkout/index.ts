// Starts a Stripe Checkout for a coin package. The payment row is created
// server-side from the package price; coins are credited only from what Stripe reports to the server
// (the webhook or payments-reconcile). With STRIPE_PUBLISHABLE_KEY set, buyers pay on Zynalive's own
// page (zynalive.com/pay, a Checkout session in Elements mode); without it, on Stripe's hosted page.
import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json, readJson, requireEnv, rpcError } from '../_shared/cors.ts';
import { payPageUrl } from '../_shared/payments.ts';
import { rateLimit } from '../_shared/redis.ts';
import { getStripe, returnUrl, type Stripe } from '../_shared/stripe.ts';
import { adminClient } from '../_shared/supabase.ts';

// Elements-mode sessions use the current API (ui_mode 'elements'); zynalive.com/pay loads the
// matching Stripe.js version (js.stripe.com/dahlia).
const ELEMENTS_API_VERSION = '2026-08-26.dahlia';

type Payment = { id: string; provider_ref: string | null; created_at: string; currency: string; amount_minor: number; coins: number };

/** Elements-mode checkout needs the buyer's email; the profile has the one they signed up with. */
async function buyerEmail(db: ReturnType<typeof adminClient>, userId: string): Promise<{ customer_email?: string }> {
  const { data } = await db.from('profiles').select('email').eq('id', userId).maybeSingle();
  const email = (data as { email?: string | null } | null)?.email;
  return email ? { customer_email: email } : {};
}

async function createPayment(db: ReturnType<typeof adminClient>, userId: string, packageId: number): Promise<Payment> {
  const { data, error } = await db.rpc('internal_create_payment', { p_user: userId, p_package_id: packageId });
  if (error) rpcError(error);
  return data as Payment;
}

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    await rateLimit('checkout', userId, 5, '1 m');

    const { packageId, returnTo } = await readJson<{ packageId: number; returnTo: string }>(req);
    if (typeof packageId !== 'number' || !Number.isInteger(packageId)) throw new HttpError(400, 'invalid_package');

    const db = adminClient();
    const stripe = getStripe();
    const successUrl = returnUrl('/checkout-return', returnTo, 'status=success');
    const backUrl = returnUrl('/checkout-return', returnTo, 'status=cancelled');
    // Own payment page only when the publishable key is set and in the same mode as the secret key.
    const publishableKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY') ?? '';
    const keyMode = (k: string) => (/_live_/.test(k) ? 'live' : /_test_/.test(k) ? 'test' : null);
    const ownPage = /^pk_/.test(publishableKey) && keyMode(publishableKey) === keyMode(requireEnv('STRIPE_SECRET_KEY'));
    const pageFor = (s: { url: string | null; client_secret: string | null }) =>
      s.url ?? (s.client_secret && ownPage
        ? payPageUrl(requireEnv('SITE_URL'), { clientSecret: s.client_secret, publishableKey, returnUrl: successUrl, backUrl })
        : null);
    // A retry (dropped connection, double tap) gets the same pending payment back from the database
    // (one open checkout per buyer and package), so here it gets the same Stripe page back too.
    let payment = await createPayment(db, userId, packageId);
    if (payment.provider_ref) {
      const existing = await stripe.checkout.sessions.retrieve(payment.provider_ref);
      const reuse = existing.status === 'open' ? pageFor(existing) : null;
      if (reuse) return json({ url: reuse });
      // Paid, but the webhook hasn't credited it yet: never open a second page.
      if (existing.status === 'complete') throw new HttpError(409, 'payment_processing', 'Your payment is being confirmed');
      // Expired unpaid page: close that payment and start a new one.
      await db.rpc('internal_fail_payment', { p_provider_ref: payment.provider_ref });
      payment = await createPayment(db, userId, packageId);
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
      client_reference_id: userId,
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
        ? { ui_mode: 'elements', return_url: successUrl, ...(await buyerEmail(db, userId)) }
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

    const { error: attachError } = await db.rpc('internal_attach_payment_ref', {
      p_payment_id: payment.id,
      p_provider_ref: session.id,
    });
    if (attachError) throw attachError;

    const url = pageFor(session);
    if (!url) throw new Error('Checkout session has no page');
    return json({ url });
  }),
);
