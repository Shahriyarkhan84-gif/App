// Creates a Stripe Checkout session for a Premium subscription.
import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json, requireEnv } from '../_shared/cors.ts';
import { rateLimit } from '../_shared/redis.ts';
import { getStripe, returnUrl } from '../_shared/stripe.ts';
import { adminClient } from '../_shared/supabase.ts';

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    await rateLimit('checkout', userId, 5, '1 m');

    const { plan, returnTo } = (await req.json().catch(() => ({}))) as { plan?: string; returnTo?: string };
    const price =
      plan === 'monthly' ? requireEnv('STRIPE_PRICE_MONTHLY') : plan === 'yearly' ? requireEnv('STRIPE_PRICE_YEARLY') : null;
    if (!price) throw new HttpError(400, 'Unknown plan');

    const stripe = getStripe();
    const db = adminClient();

    const { data: existing } = await db
      .from('subscriptions')
      .select('stripe_customer_id,status')
      .eq('user_id', userId)
      .maybeSingle();
    if (existing && ['active', 'trialing'].includes(existing.status)) {
      throw new HttpError(409, 'You already have an active subscription');
    }

    let customerId = existing?.stripe_customer_id;
    if (!customerId) {
      const { data: profile } = await db.from('profiles').select('email').eq('id', userId).maybeSingle();
      const customer = await stripe.customers.create({
        email: profile?.email ?? undefined,
        metadata: { clerk_user_id: userId },
      });
      customerId = customer.id;
      await db.from('subscriptions').upsert({ user_id: userId, stripe_customer_id: customerId, status: 'incomplete' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { clerk_user_id: userId } },
      allow_promotion_codes: true,
      success_url: returnUrl('/checkout-return', returnTo, 'status=success'),
      cancel_url: returnUrl('/checkout-return', returnTo, 'status=cancelled'),
    });

    return json({ url: session.url });
  }),
);
