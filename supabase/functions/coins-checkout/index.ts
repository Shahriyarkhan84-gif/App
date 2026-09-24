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

    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
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
    });

    const { error: attachError } = await db.rpc('internal_attach_payment_ref', {
      p_payment_id: payment.id,
      p_provider_ref: session.id,
    });
    if (attachError) throw attachError;

    return json({ url: session.url });
  }),
);
