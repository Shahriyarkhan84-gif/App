// Web recharge link (zynalive.com/recharge, an agency's link adds ?a=<code>). No sign-in: the payer
// enters a Zynalive ID, sees whose account it is, picks a package and pays by card on Stripe.
// lookup: { action: 'lookup', id, agency? } -> { name, avatar_url, user_number, agency, packages }
// checkout: { action: 'checkout', id, packageId, agency? } -> { url } (the Stripe page)
// The payment carries the agency (its margin is recorded); diamonds are credited only from Stripe's
// confirmation, like every card purchase. Both actions are rate-limited per visitor.
import { checkoutPage, type Payment } from '../_shared/checkout.ts';
import { handler, HttpError, json, readJson, requireEnv, rpcError } from '../_shared/cors.ts';
import { parseAgency, parseId } from '../_shared/recharge.ts';
import { rateLimit } from '../_shared/redis.ts';
import { getStripe } from '../_shared/stripe.ts';
import { adminClient } from '../_shared/supabase.ts';

type Body = { action: 'lookup' | 'checkout'; id: string; packageId?: number; agency?: string };

Deno.serve(
  handler(async (req) => {
    const visitor = `ip:${(req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()}`;
    const { action, id, packageId, agency } = await readJson<Body>(req);
    const userNumber = parseId(id);
    const agencyCode = parseAgency(agency);
    const db = adminClient();

    if (action === 'lookup') {
      // Enough for a real payer, too few to walk through everyone's IDs.
      await rateLimit('recharge-lookup', visitor, 15, '10 m', { failClosed: true });
      const { data, error } = await db.rpc('internal_recharge_lookup', { p_user_number: userNumber, p_agency_code: agencyCode });
      if (error) rpcError(error);
      return json(data);
    }

    if (action === 'checkout') {
      await rateLimit('recharge-checkout', visitor, 10, '10 m', { failClosed: true });
      if (typeof packageId !== 'number' || !Number.isInteger(packageId)) throw new HttpError(400, 'invalid_package');
      const site = requireEnv('SITE_URL').replace(/\/$/, '');
      const back = new URL(`${site}/recharge`);
      back.searchParams.set('id', String(userNumber));
      if (agencyCode) back.searchParams.set('a', agencyCode);
      const success = new URL(back);
      success.searchParams.set('status', 'success');
      const url = await checkoutPage({
        db,
        stripe: getStripe(),
        createPayment: async () => {
          const { data, error } = await db.rpc('internal_create_recharge_payment', {
            p_user_number: userNumber, p_package_id: packageId, p_agency_code: agencyCode,
          });
          if (error) rpcError(error);
          return data as Payment;
        },
        successUrl: success.toString(),
        backUrl: back.toString(),
        clientReference: `recharge:${userNumber}`,
      });
      return json({ url });
    }

    throw new HttpError(400, 'invalid_request');
  }),
);
