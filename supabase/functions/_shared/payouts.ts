// Automatic host payouts (payouts-send). The database decides what may be paid and records the
// result (20261030040000_auto_payouts.sql); this file turns a withdrawal into a provider request
// and a provider answer into that result.
//
// A provider is the company that actually moves the money to JazzCash, Easypaisa or a bank
// (e.g. dLocal, Rafiki, Simpaisa). Each one is a `PayoutProvider` in PROVIDERS, chosen with the
// PAYOUT_PROVIDER secret; its keys are Edge Function secrets too. Rule for every provider: send the
// withdrawal id as the provider's idempotency key / reference, so asking twice never pays twice.

export type PayoutMethod = 'jazzcash' | 'easypaisa' | 'bank';

export type PayoutRequest = {
  /** Withdrawal id: the reference and idempotency key sent to the provider. */
  id: string;
  amountMinor: number;
  currency: string;
  method: PayoutMethod;
  /** Mobile account number or IBAN, as the host entered it. */
  account: string;
  hostId: string;
};

/** ok: the provider accepted/sent it (ref = its id). retry: a temporary problem, try again later. */
export type PayoutOutcome = { ok: true; ref: string } | { ok: false; retry: boolean; error: string };

export interface PayoutProvider {
  name: string;
  send(p: PayoutRequest): Promise<PayoutOutcome>;
}

/** Providers by PAYOUT_PROVIDER name. None is connected yet: add one once its account is open. */
export const PROVIDERS: Record<string, () => PayoutProvider> = {};

export function payoutProvider(name = Deno.env.get('PAYOUT_PROVIDER') ?? ''): PayoutProvider | null {
  const make = PROVIDERS[name];
  return make ? make() : null;
}

type WithdrawalRow = {
  id: string;
  host_id: string;
  amount_minor: number;
  currency: string;
  payout_method: { type?: string; account?: string } | null;
};

const METHODS: PayoutMethod[] = ['jazzcash', 'easypaisa', 'bank'];

/** The provider request for a withdrawal row, or null if the row can't be paid as it is. */
export function toPayoutRequest(w: WithdrawalRow): PayoutRequest | null {
  const type = w.payout_method?.type as PayoutMethod | undefined;
  const account = (w.payout_method?.account ?? '').replace(/[\s-]/g, '');
  if (!type || !METHODS.includes(type)) return null;
  if (!Number.isSafeInteger(w.amount_minor) || w.amount_minor <= 0) return null;
  if (type === 'bank' ? !/^PK\d{2}[A-Z]{4}[A-Z0-9]{16}$/i.test(account) : !/^(\+?92|0)3\d{9}$/.test(account)) return null;
  return { id: w.id, amountMinor: w.amount_minor, currency: w.currency.toUpperCase(), method: type, account, hostId: w.host_id };
}

/**
 * Sends one payout and never throws. An exception or timeout means we don't know whether the
 * provider paid, so it's a retry (same id, so the provider won't pay twice); only a clear refusal
 * from the provider is final.
 */
export async function sendPayout(provider: PayoutProvider, w: WithdrawalRow): Promise<PayoutOutcome> {
  const request = toPayoutRequest(w);
  if (!request) return { ok: false, retry: false, error: 'invalid_payout_details' };
  try {
    const outcome = await provider.send(request);
    if (outcome.ok && !outcome.ref.trim()) return { ok: false, retry: true, error: 'provider_gave_no_reference' };
    return outcome;
  } catch (e) {
    return { ok: false, retry: true, error: `provider_error: ${(e as Error).message ?? e}`.slice(0, 300) };
  }
}
