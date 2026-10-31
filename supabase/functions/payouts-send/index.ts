// Sends automatic host payouts. Woken by the database (pg_net, x-payout-secret header) when a
// withdrawal is approved automatically or retried by the owner, and by a host's Earnings screen
// (their own payouts only) as the safety net. The request carries no payout data: what to pay
// comes from internal_claim_payouts(), and each result is recorded with internal_payout_result().
import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json } from '../_shared/cors.ts';
import { payoutProvider, sendPayout } from '../_shared/payouts.ts';
import { rateLimit } from '../_shared/redis.ts';
import { adminClient } from '../_shared/supabase.ts';

Deno.serve(
  handler(async (req) => {
    const secret = req.headers.get('x-payout-secret');
    let host: string | null = null;
    if (!secret) {
      host = (await requireUser(req)).userId;
      await rateLimit('payouts-send', host, 3, '1 m', { failClosed: true });
    }

    const provider = payoutProvider();
    const db = adminClient();
    // Small batches: each provider call can take seconds, and the function has a time limit.
    const { data, error } = await db.rpc('internal_claim_payouts', { p_secret: secret, p_host: host, p_limit: 5 });
    if (error) throw new HttpError(error.message === 'forbidden' ? 403 : 500, error.message === 'forbidden' ? 'forbidden' : 'payout_queue_failed');

    let sent = 0, failed = 0;
    for (const w of data ?? []) {
      // Turned on without a connected provider: nothing is sent; each payout goes to the owner.
      const outcome = provider ? await sendPayout(provider, w) : { ok: false as const, retry: false, error: 'payout_provider_not_connected' };
      const { error: saveError } = await db.rpc('internal_payout_result', {
        p_id: w.id,
        p_ok: outcome.ok,
        p_ref: outcome.ok ? outcome.ref : null,
        p_error: outcome.ok ? null : outcome.error,
        p_retry: outcome.ok ? false : outcome.retry,
      });
      // Left in 'sending': taken again after 15 minutes with the same id, so never paid twice.
      if (saveError) console.error('payout result not saved', w.id, saveError.message);
      if (outcome.ok) sent++; else failed++;
    }
    return json({ sent, failed });
  }),
);
