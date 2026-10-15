// Starts a Stripe Checkout for a coin package. The payment row is created
// server-side from the package price; coins are credited only by the webhook.
import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json, readJson, rpcError } from '../_shared/cors.ts';
import { rateLimit } from '../_shared/redis.ts';
import { getStripe, returnUrl } from '../_shared/stripe.ts';
import { adminClient } from '../_shared/supabase.ts';

type Payment = { id: string; provider_ref: string | null; created_at: string; currency: string; amount_minor: number; coins: number };

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
    // A retry (dropped connection, double tap) gets the same pending payment back from the database
    // (one open checkout per buyer and package), so here it gets the same Stripe page back too.
    let payment = await createPayment(db, userId, packageId);
    if (payment.provider_ref) {
      const existing = await stripe.checkout.sessions.retrieve(payment.provider_ref);
      if (existing.status === 'open' && existing.url) return json({ url: existing.url });
      // Paid, but the webhook hasn't credited it yet: never open a second page.
      if (existing.status === 'complete') throw new HttpError(409, 'payment_processing', 'Your payment is being confirmed');
      // Expired unpaid page: close that payment and start a new one.
      await db.rpc('internal_fail_payment', { p_provider_ref: payment.provider_ref });
      payment = await createPayment(db, userId, packageId);
    }

    // Card, Link and the other payment methods turned on in the Dashboard are offered automatically
    // (no payment_method_types). Adaptive Pricing shows a local-currency price to buyers abroad; the
    // session's amount_total/currency stay in the package currency, which the webhook checks.
    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        adaptive_pricing: { enabled: true },
        // Fixed per payment (62 min after it was created; a pending payment is reused for at most 30),
        // so a concurrent retry sends identical parameters and Stripe's idempotency returns the same page.
        // The webhook marks the payment failed when the page expires unpaid.
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
        success_url: returnUrl('/checkout-return', returnTo, 'status=success'),
        cancel_url: returnUrl('/checkout-return', returnTo, 'status=cancelled'),
      }, { idempotencyKey: `checkout:${payment.id}` }); // one Stripe page per payment, ever
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

    return json({ url: session.url });
  }),
);
