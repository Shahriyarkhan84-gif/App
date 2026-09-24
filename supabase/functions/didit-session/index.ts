// Starts a Didit identity verification (ID + liveness + face match) for a host.
// Returns the hosted verification URL; the result arrives via didit-webhook.
import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json, readJson, rpcError } from '../_shared/cors.ts';
import { createSession } from '../_shared/didit.ts';
import { rateLimit } from '../_shared/redis.ts';
import { returnUrl } from '../_shared/stripe.ts';
import { adminClient } from '../_shared/supabase.ts';

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    await rateLimit('didit-session', userId, 5, '1 h');

    const { returnTo, language } = await readJson<{ returnTo: string; language: string }>(req);
    const db = adminClient();

    const { data: host } = await db.from('hosts').select('verification_status').eq('user_id', userId).maybeSingle();
    if (!host) throw new HttpError(403, 'not_a_host');
    if (host.verification_status === 'approved') throw new HttpError(409, 'already_verified');
    if (host.verification_status === 'in_review') throw new HttpError(409, 'verification_in_review');

    const session = await createSession({
      vendorData: userId,
      callback: returnUrl('/verify-return', returnTo),
      language: typeof language === 'string' && /^[a-z]{2}$/.test(language) ? language : undefined,
    });

    const { error } = await db.rpc('internal_start_host_verification', { p_user: userId, p_session_id: session.session_id });
    if (error) rpcError(error);

    return json({ url: session.url });
  }),
);
