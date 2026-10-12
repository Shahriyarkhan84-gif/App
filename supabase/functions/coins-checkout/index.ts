// Starts a Stripe Checkout for a coin package. The payment row is created
// server-side from the package price; coins are credited only by the webhook.
import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json, readJson, rpcError } from '../_shared/cors.ts';
import { rateLimit } from '../_shared/redis.ts';
import { getStripe, returnUrl } from '../_shared/stripe.ts';
import { adminClient } from '../_shared/supabase.ts';

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    await rateLimit('checkout', userId, 5, '1 m');

    const { packageId, returnTo } = await readJson<{ packageId: number; returnTo: string }>(req);
    if (!Number.isInteger(packageId)) throw new HttpError(400, 'invalid_package');

    const db = adminClient();
    const { data: payment, error } = await db.rpc('internal_create_payment', { p_user: userId, p_package_id: packageId });
    if (error) rpcError(error);

    // Card, Link and the other payment methods turned on in the Dashboard are offered automatically
    // (no payment_method_types). Adaptive Pricing shows a local-currency price to buyers abroad; the
    // session's amount_total/currency stay in the package currency, which the webhook checks.
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      adaptive_pricing: { enabled: true },
      // Unpaid sessions close after 30 minutes (Stripe's minimum); the webhook marks them failed.
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
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
    }, { idempotencyKey: `checkout:${payment.id}` }); // a retried request can't open a second session

    const { error: attachError } = await db.rpc('internal_attach_payment_ref', {
      p_payment_id: payment.id,
      p_provider_ref: session.id,
    });
    if (attachError) throw attachError;

    return json({ url: session.url });
  }),
);
