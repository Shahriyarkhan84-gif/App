// deno test supabase/functions/_shared/stores_test.ts
import { appleAccountToken, appleOutcome, googleAccountTag, googleOutcome, jwsPayload } from './stores.ts';

function assertEquals(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

const tag = 'a'.repeat(64);

Deno.test('a paid Play purchase tagged with the buyer is credited with its order id', () => {
  assertEquals(googleOutcome({ purchaseState: 0, orderId: 'GPA.1', obfuscatedExternalAccountId: tag }, tag, false), { action: 'credit', orderRef: 'GPA.1' });
});

Deno.test('a pending Play purchase waits', () => {
  assertEquals(googleOutcome({ purchaseState: 2, obfuscatedExternalAccountId: tag }, tag, false), { action: 'pending' });
});

Deno.test('a cancelled Play purchase is refused', () => {
  assertEquals(googleOutcome({ purchaseState: 1, orderId: 'GPA.1', obfuscatedExternalAccountId: tag }, tag, false).action, 'reject');
});

Deno.test('someone else\'s Play purchase is refused', () => {
  assertEquals(googleOutcome({ purchaseState: 0, orderId: 'GPA.1', obfuscatedExternalAccountId: 'b'.repeat(64) }, tag, false), { action: 'reject', reason: 'purchase_not_yours' });
  assertEquals(googleOutcome({ purchaseState: 0, orderId: 'GPA.1' }, tag, false), { action: 'reject', reason: 'purchase_not_yours' });
});

Deno.test('Play test purchases only credit when test purchases are allowed', () => {
  const p = { purchaseState: 0, purchaseType: 0, orderId: 'GPA.1', obfuscatedExternalAccountId: tag };
  assertEquals(googleOutcome(p, tag, false), { action: 'reject', reason: 'test_purchase' });
  assertEquals(googleOutcome(p, tag, true).action, 'credit');
  assertEquals(googleOutcome({ ...p, purchaseType: 1 }, tag, true), { action: 'reject', reason: 'test_purchase' });
});

const expected = { bundleId: 'com.zynalive.app', productId: 'zynalive_diamonds_350', accountToken: '0f0e0d0c-0b0a-4908-8706-050403020100' };
const apple = { transactionId: '2000001', bundleId: 'com.zynalive.app', productId: 'zynalive_diamonds_350', type: 'Consumable', appAccountToken: expected.accountToken, environment: 'Production' };

Deno.test('a production App Store purchase tagged with the buyer is credited', () => {
  assertEquals(appleOutcome(apple, expected, false), { action: 'credit', orderRef: '2000001' });
});

Deno.test('App Store purchases for another app, product or account are refused', () => {
  assertEquals(appleOutcome({ ...apple, bundleId: 'com.other' }, expected, false).action, 'reject');
  assertEquals(appleOutcome({ ...apple, productId: 'zynalive_diamonds_7000' }, expected, false).action, 'reject');
  assertEquals(appleOutcome({ ...apple, appAccountToken: undefined }, expected, false), { action: 'reject', reason: 'purchase_not_yours' });
});

Deno.test('refunded or sandbox App Store purchases are refused', () => {
  assertEquals(appleOutcome({ ...apple, revocationDate: 1 }, expected, false), { action: 'reject', reason: 'purchase_not_paid' });
  assertEquals(appleOutcome({ ...apple, environment: 'Sandbox' }, expected, false), { action: 'reject', reason: 'test_purchase' });
  assertEquals(appleOutcome({ ...apple, environment: 'Sandbox' }, expected, true).action, 'credit');
});

Deno.test('account tags are stable, per user, and in the format each store needs', async () => {
  const a = await googleAccountTag('user_1');
  assertEquals(a === (await googleAccountTag('user_1')), true);
  assertEquals(a === (await googleAccountTag('user_2')), false);
  assertEquals(/^[0-9a-f]{64}$/.test(a), true);
  assertEquals(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(await appleAccountToken('user_1')), true);
});

Deno.test('account tags match the reference values the app is tested against', async () => {
  // Same values as src/lib/__tests__/iap.test.ts, so app and server always agree.
  assertEquals(await googleAccountTag('user_test'), '1df4da597cb708f791ba0a7ddf367358a648d735f1241e1896da4066d63fe486');
  assertEquals(await appleAccountToken('user_test'), '1df4da59-7cb7-48f7-91ba-0a7ddf367358');
});

Deno.test('a JWS payload is decoded', () => {
  const payload = btoa(JSON.stringify({ transactionId: '7' })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  assertEquals(jwsPayload<{ transactionId: string }>(`h.${payload}.s`).transactionId, '7');
});
