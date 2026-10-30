import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { SupabaseClient } from '@supabase/supabase-js';

import { invokeFn } from './api';
import { storeAccountTags } from './iapTags';

type Iap = typeof import('expo-iap');
type Purchase = import('expo-iap').Purchase;

let iapModule: Iap | null | undefined;
/** expo-iap, or null in a build without its native module (Expo Go, older dev builds). */
function iap(): Iap | null {
  if (iapModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      iapModule = require('expo-iap') as Iap;
    } catch {
      iapModule = null;
    }
  }
  return iapModule;
}

export type StoreBilling = {
  /** True when this build sells through Google Play / the App Store (otherwise use web checkout). */
  available: boolean;
  /** The store's own price for each product, in the buyer's currency ("Rs 299.00"). */
  prices: Record<string, string>;
  /** Product being bought, while the store sheet is open or the server is checking it. */
  busy: string | null;
  /** A purchase the store hasn't finished charging (e.g. pay-at-shop on Play); credited when it is. */
  pending: boolean;
  buy: (productId: string) => Promise<void>;
};

/**
 * Buying diamonds through Google Play Billing or the App Store. The app never credits anything:
 * each purchase goes to the iap-verify function, which asks Google or Apple and credits on the
 * server; only then is the store transaction finished. Unfinished purchases (app closed mid-way)
 * are picked up again the next time this runs.
 */
export function useStoreBilling(opts: {
  supabase: SupabaseClient;
  userId: string | null | undefined;
  productIds: string[];
  onCredited: () => void;
  onError: (e: unknown) => void;
}): StoreBilling {
  const { supabase, userId, productIds } = opts;
  const mod = Platform.OS === 'web' ? null : iap();
  const [connected, setConnected] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(new Set<string>());
  // Latest callbacks for the store listeners, without re-subscribing on every render.
  const cb = useRef(opts);
  useEffect(() => {
    cb.current = opts;
  });

  const settle = useCallback(async (p: Purchase) => {
    if (!mod) return;
    const key = p.purchaseToken ?? p.id;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      const r = await invokeFn<{ status: 'credited' | 'pending' }>(supabase, 'iap-verify', {
        platform: Platform.OS,
        productId: p.productId,
        purchaseToken: Platform.OS === 'android' ? p.purchaseToken : undefined,
        transactionId: Platform.OS === 'ios' && 'transactionId' in p ? p.transactionId : undefined,
      });
      if (r.status === 'pending') {
        setPending(true);
        return;
      }
      setPending(false);
      // On Android the server already consumed it; finishing again just fails quietly.
      await mod.finishTransaction({ purchase: p, isConsumable: true }).catch(() => {});
      cb.current.onCredited();
    } catch (e) {
      cb.current.onError(e);
    } finally {
      inFlight.current.delete(key);
      setBusy(null);
    }
  }, [mod, supabase]);

  useEffect(() => {
    if (!mod || !userId) return;
    let alive = true;
    const subs = [
      mod.purchaseUpdatedListener((p) => void settle(p)),
      mod.purchaseErrorListener((e) => {
        setBusy(null);
        if (!mod.isUserCancelledError(e)) cb.current.onError(new Error(e.message || 'store_error'));
      }),
    ];
    void (async () => {
      try {
        await mod.initConnection();
        if (!alive) return;
        setConnected(true);
        // Purchases paid but never confirmed (app killed, no network) are credited now.
        const open = await mod.getAvailablePurchases();
        for (const p of open ?? []) void settle(p);
      } catch {
        if (alive) setConnected(false);
      }
    })();
    return () => {
      alive = false;
      subs.forEach((s) => s.remove());
      void mod.endConnection().catch(() => {});
    };
  }, [mod, userId, settle]);

  const skus = productIds.join(',');
  useEffect(() => {
    if (!mod || !connected || !skus) return;
    void mod.fetchProducts({ skus: skus.split(','), type: 'in-app' })
      .then((list) => setPrices(Object.fromEntries((list ?? []).map((p) => [p.id, p.displayPrice]))))
      .catch(() => {});
  }, [mod, connected, skus]);

  const buy = useCallback(async (productId: string) => {
    if (!mod || !userId) return;
    setBusy(productId);
    try {
      const tags = await storeAccountTags(userId);
      // The result arrives through purchaseUpdatedListener (or purchaseErrorListener).
      await mod.requestPurchase({
        type: 'in-app',
        request: {
          apple: { sku: productId, appAccountToken: tags.apple },
          google: { skus: [productId], obfuscatedAccountId: tags.google },
        },
      });
    } catch (e) {
      setBusy(null);
      if (!mod.isUserCancelledError(e)) cb.current.onError(e);
    }
  }, [mod, userId]);

  return { available: !!mod && connected, prices, busy, pending, buy };
}
