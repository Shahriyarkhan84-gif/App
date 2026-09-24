// Didit webhook → host verification status. Signature-verified (X-Signature or
// X-Signature-Simple, 5-minute freshness), replay-protected, and the status is
// re-read from Didit's API before it is applied, so a forged body can't approve anyone.
import { json, requireEnv } from '../_shared/cors.ts';
import { getDecisionSummary, verifyWebhook } from '../_shared/didit.ts';
import { adminClient, alreadyProcessed, markEventProcessed } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: { code: 'method_not_allowed', message: 'Use POST' } }, 405);
  const raw = await req.text();
  const event = await verifyWebhook(req.headers, raw, requireEnv('DIDIT_WEBHOOK_SECRET'));
  if (!event) return json({ error: { code: 'invalid_signature', message: 'Invalid signature' } }, 401);

  if (event.webhook_type !== 'status.updated' || !event.session_id) return json({ ignored: true });

  const eventKey = event.event_id ?? `${event.session_id}:${event.status}:${event.webhook_type}`;
  if (await alreadyProcessed('didit', eventKey)) return json({ duplicate: true });

  const db = adminClient();
  const { data: known } = await db.from('host_verifications').select('id').eq('session_id', event.session_id).maybeSingle();
  if (!known) return json({ ignored: true, reason: 'unknown_session' }); // not one of ours

  try {
    const decision = await getDecisionSummary(event.session_id);
    const { data, error } = await db.rpc('internal_apply_host_verification', {
      p_session_id: event.session_id,
      p_provider_status: decision.status,
      p_summary: decision.summary,
    });
    if (error) throw error;
    console.log('didit', event.session_id, JSON.stringify(data));
  } catch (err) {
    console.error('didit webhook failed', err);
    return json({ error: { code: 'internal', message: 'Handler failed' } }, 500); // Didit retries
  }

  await markEventProcessed('didit', eventKey);
  return json({ ok: true });
});
