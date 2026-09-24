// Opens the Stripe customer portal so a subscriber can update or cancel.
import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json } from '../_shared/cors.ts';
import { rateLimit } from '../_shared/redis.ts';
import { getStripe, returnUrl } from '../_shared/stripe.ts';
import { adminClient } from '../_shared/supabase.ts';

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    await rateLimit('portal', userId, 10, '1 m');
    const { returnTo } = (await req.json().catch(() => ({}))) as { returnTo?: string };

    const { data } = await adminClient()
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) throw new HttpError(404, 'No billing account yet');

    const session = await getStripe().billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: returnUrl('/checkout-return', returnTo),
    });
    return json({ url: session.url });
  }),
);
