// Credits diamonds for a Google Play or App Store purchase made in the app. The app sends only
// which purchase it made; this asks Google or Apple about it and credits through
// internal_credit_store_purchase() only when the store says it is paid and belongs to this account.
import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json, readJson, requireEnv, rpcError } from '../_shared/cors.ts';
import { rateLimit } from '../_shared/redis.ts';
import {
  allowTestPurchases, appleAccountToken, appleOutcome, consumeGooglePurchase, getAppleTransaction,
  getGooglePurchase, googleAccountTag, googleOutcome, type Outcome,
} from '../_shared/stores.ts';
import { adminClient } from '../_shared/supabase.ts';

type Body = { platform: 'android' | 'ios'; productId: string; purchaseToken?: string; transactionId?: string };

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    await rateLimit('iap', userId, 20, '1 m', { failClosed: true });
    const { platform, productId, purchaseToken, transactionId } = await readJson<Body>(req);
    if (typeof productId !== 'string' || !/^[a-z0-9_.]{3,100}$/.test(productId)) throw new HttpError(400, 'invalid_package');

    let outcome: Outcome;
    let purchaseRef: string;
    if (platform === 'android') {
      if (typeof purchaseToken !== 'string' || purchaseToken.length < 10 || purchaseToken.length > 1000) throw new HttpError(400, 'invalid_purchase');
      purchaseRef = purchaseToken;
      outcome = googleOutcome(await getGooglePurchase(productId, purchaseToken), await googleAccountTag(userId), allowTestPurchases());
    } else if (platform === 'ios') {
      if (typeof transactionId !== 'string') throw new HttpError(400, 'invalid_purchase');
      purchaseRef = transactionId;
      outcome = appleOutcome(
        await getAppleTransaction(transactionId),
        { bundleId: requireEnv('APPLE_BUNDLE_ID'), productId, accountToken: await appleAccountToken(userId) },
        allowTestPurchases(),
      );
    } else {
      throw new HttpError(400, 'invalid_purchase');
    }

    if (outcome.action === 'pending') return json({ status: 'pending' }, 202);
    if (outcome.action === 'reject') throw new HttpError(outcome.reason === 'purchase_not_yours' ? 403 : 400, outcome.reason);

    const { data, error } = await adminClient().rpc('internal_credit_store_purchase', {
      p_user: userId,
      p_provider: platform === 'android' ? 'google_play' : 'app_store',
      p_product_id: productId,
      p_purchase_ref: purchaseRef,
      p_order_ref: outcome.orderRef,
    });
    if (error) rpcError(error);

    // Credited (now or before): consume it on Play so it can be bought again and Google never
    // auto-refunds it. On iOS the app finishes the transaction after this answer.
    if (platform === 'android') await consumeGooglePurchase(productId, purchaseRef);
    const result = data as { credited: boolean; coins?: number; balance?: number };
    return json({ status: 'credited', newlyCredited: result.credited, coins: result.coins ?? null, balance: result.balance ?? null });
  }),
);
