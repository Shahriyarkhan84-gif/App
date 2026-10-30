// Refunds from the stores. Apple (App Store Server Notifications v2) and Google (Real-time developer
// notifications through Pub/Sub push) call this when a purchase is refunded or charged back. The
// message only says which purchase; this confirms the refund with Apple or Google before taking the
// diamonds back through internal_refund_payment(), so a forged message can't change anything.
import { handler, HttpError, json, readJson, requireEnv } from '../_shared/cors.ts';
import { getAppleTransaction, isGoogleOrderVoided, jwsPayload } from '../_shared/stores.ts';
import { adminClient } from '../_shared/supabase.ts';

type AppleNotification = { notificationType?: string; data?: { signedTransactionInfo?: string } };
type GoogleMessage = { voidedPurchaseNotification?: { orderId?: string; productType?: number } };

async function refund(orderRef: string) {
  const { data, error } = await adminClient().rpc('internal_refund_payment', { p_payment_intent: orderRef });
  if (error && error.message !== 'unknown_payment') throw new Error(`refund failed: ${error.message}`);
  return data;
}

Deno.serve(
  handler(async (req) => {
    const body = await readJson<{ signedPayload?: string; message?: { data?: string } }>(req);

    // Apple
    if (typeof body.signedPayload === 'string') {
      const n = jwsPayload<AppleNotification>(body.signedPayload);
      if (n.notificationType !== 'REFUND' || !n.data?.signedTransactionInfo) return json({ ok: true, ignored: n.notificationType ?? null });
      const claimed = jwsPayload<{ transactionId?: string }>(n.data.signedTransactionInfo).transactionId;
      if (!claimed) return json({ ok: true, ignored: 'no_transaction' });
      const confirmed = await getAppleTransaction(claimed); // straight from Apple
      if (!confirmed.revocationDate) return json({ ok: true, ignored: 'not_revoked' });
      return json({ ok: true, result: await refund(`as:${confirmed.transactionId}`) });
    }

    // Google (Pub/Sub push); the subscription's push URL carries ?token=STORE_NOTIFY_TOKEN.
    if (body.message?.data) {
      if (new URL(req.url).searchParams.get('token') !== requireEnv('STORE_NOTIFY_TOKEN')) throw new HttpError(401, 'not_authenticated');
      const m = JSON.parse(atob(body.message.data)) as GoogleMessage;
      const v = m.voidedPurchaseNotification;
      if (!v?.orderId || v.productType !== 2) return json({ ok: true, ignored: 'not_a_voided_product' });
      if (!(await isGoogleOrderVoided(v.orderId))) return json({ ok: true, ignored: 'not_voided' });
      return json({ ok: true, result: await refund(`gp:${v.orderId}`) });
    }

    throw new HttpError(400, 'invalid_notification');
  }),
);
