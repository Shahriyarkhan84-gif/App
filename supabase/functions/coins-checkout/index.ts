// Starts a Stripe Checkout for a coin package. The payment row is created
// server-side from the package price; coins are credited only from what Stripe reports to the server
// (the webhook or payments-reconcile). The page itself comes from _shared/checkout.ts.
import { requireUser } from '../_shared/auth.ts';
import { checkoutPage, type Payment } from '../_shared/checkout.ts';
import { handler, HttpError, json, readJson, rpcError } from '../_shared/cors.ts';
import { rateLimit } from '../_shared/redis.ts';
import { getStripe, returnUrl } from '../_shared/stripe.ts';
import { adminClient } from '../_shared/supabase.ts';

/** Elements-mode checkout needs the buyer's email; the profile has the one they signed up with. */
async function buyerEmail(db: ReturnType<typeof adminClient>, userId: string): Promise<{ customer_email?: string }> {
  const { data } = await db.from('profiles').select('email').eq('id', userId).maybeSingle();
  const email = (data as { email?: string | null } | null)?.email;
  return email ? { customer_email: email } : {};
}

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    await rateLimit('checkout', userId, 5, '1 m', { failClosed: true });

    const { packageId, returnTo } = await readJson<{ packageId: number; returnTo: string }>(req);
    if (typeof packageId !== 'number' || !Number.isInteger(packageId)) throw new HttpError(400, 'invalid_package');

    const db = adminClient();
    const url = await checkoutPage({
      db,
      stripe: getStripe(),
      createPayment: async () => {
        const { data, error } = await db.rpc('internal_create_payment', { p_user: userId, p_package_id: packageId });
        if (error) rpcError(error);
        return data as Payment;
      },
      successUrl: returnUrl('/checkout-return', returnTo, 'status=success'),
      backUrl: returnUrl('/checkout-return', returnTo, 'status=cancelled'),
      clientReference: userId,
      email: () => buyerEmail(db, userId),
    });
    return json({ url });
  }),
);
