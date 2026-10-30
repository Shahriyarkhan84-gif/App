import type { StoreBilling } from './storeBilling';

/** The website sells diamonds with Stripe checkout; there is no app store on the web. */
export function useStoreBilling(_opts: unknown): StoreBilling {
  return { available: false, prices: {}, busy: null, pending: false, buy: async () => {} };
}
