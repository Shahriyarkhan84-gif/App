// deno test supabase/functions/_shared/payouts_test.ts
import { type PayoutProvider, payoutProvider, sendPayout, toPayoutRequest } from './payouts.ts';

function assertEquals(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

const row = (type: string, account: string, amount = 50000) => ({
  id: 'w1', host_id: 'bob', amount_minor: amount, currency: 'pkr', payout_method: { type, account },
});
const fixed = (send: PayoutProvider['send']): PayoutProvider => ({ name: 'test', send });

Deno.test('wallet and bank accounts become provider requests', () => {
  assertEquals(toPayoutRequest(row('jazzcash', '0300 123-4567')), {
    id: 'w1', amountMinor: 50000, currency: 'PKR', method: 'jazzcash', account: '03001234567', hostId: 'bob',
  });
  assertEquals(toPayoutRequest(row('easypaisa', '+923001234567'))?.account, '+923001234567');
  assertEquals(toPayoutRequest(row('bank', 'PK36 SCBL 0000 0011 2345 6702'))?.account, 'PK36SCBL0000001123456702');
});

Deno.test('bad payout details are never sent', () => {
  assertEquals(toPayoutRequest(row('jazzcash', '12345')), null);
  assertEquals(toPayoutRequest(row('bank', '03001234567')), null);
  assertEquals(toPayoutRequest(row('crypto', '03001234567')), null);
  assertEquals(toPayoutRequest(row('easypaisa', '03001234567', 0)), null);
});

Deno.test('outcomes: sent, refused, unknown', async () => {
  assertEquals(await sendPayout(fixed(async (p) => ({ ok: true, ref: 'prov-' + p.id })), row('easypaisa', '03001234567')), { ok: true, ref: 'prov-w1' });
  assertEquals(await sendPayout(fixed(async () => ({ ok: false, retry: false, error: 'account_closed' })), row('easypaisa', '03001234567')),
    { ok: false, retry: false, error: 'account_closed' });
  // A crash or timeout: maybe paid, so retried with the same id, never treated as refused.
  const crashed = await sendPayout(fixed(async () => { throw new Error('timeout'); }), row('easypaisa', '03001234567'));
  assertEquals(crashed.ok === false && crashed.retry, true);
  const noRef = await sendPayout(fixed(async () => ({ ok: true, ref: ' ' })), row('easypaisa', '03001234567'));
  assertEquals(noRef.ok === false && noRef.retry, true);
  assertEquals(await sendPayout(fixed(async () => ({ ok: true, ref: 'x' })), row('easypaisa', '1')), { ok: false, retry: false, error: 'invalid_payout_details' });
});

Deno.test('no provider until one is connected', () => {
  assertEquals(payoutProvider('dlocal'), null);
  assertEquals(payoutProvider(''), null);
});
