// Lets zynalive.com/pay check that a Checkout session is one of ours before showing a card form.
// POST { cs } (the session's client secret, from the pay link) -> { pk } (Zynalive's Stripe
// publishable key). The page never takes a key from its URL, so a link carrying someone else's
// Stripe session and key can't collect a payment on a Zynalive page. Public (no sign-in: the buyer
// may open the link in another browser); it reveals only the publishable key, for our own pending
// sessions.
import { handler, HttpError, json, readJson } from '../_shared/cors.ts';
import { rateLimit } from '../_shared/redis.ts';
import { adminClient } from '../_shared/supabase.ts';

const CLIENT_SECRET = /^(cs_(?:test|live)_[A-Za-z0-9]+)_secret_[A-Za-z0-9]+$/;

Deno.serve(
  handler(async (req) => {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    await rateLimit('pay-session', ip, 30, '1 m');
    const { cs } = await readJson<{ cs?: string }>(req);
    const sessionId = typeof cs === 'string' ? CLIENT_SECRET.exec(cs)?.[1] : undefined;
    if (!sessionId) throw new HttpError(400, 'invalid_session');

    const { data: payment } = await adminClient().from('payments').select('id')
      .eq('provider', 'stripe').eq('provider_ref', sessionId).eq('status', 'pending').maybeSingle();
    const pk = Deno.env.get('STRIPE_PUBLISHABLE_KEY');
    if (!payment || !pk) throw new HttpError(404, 'payment_not_found');
    return json({ pk });
  }),
);
