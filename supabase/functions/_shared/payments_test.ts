// deno test supabase/functions/_shared/payments_test.ts
import { payPageUrl, sessionOutcome } from './payments.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`expected ${expected}, got ${actual}`);
}

Deno.test('a paid, complete session is credited', () => {
  assertEquals(sessionOutcome({ mode: 'payment', status: 'complete', payment_status: 'paid' }), 'credit');
});

Deno.test('an expired session is failed', () => {
  assertEquals(sessionOutcome({ mode: 'payment', status: 'expired', payment_status: 'unpaid' }), 'fail');
});

Deno.test('open or still-processing sessions wait', () => {
  assertEquals(sessionOutcome({ mode: 'payment', status: 'open', payment_status: 'unpaid' }), 'wait');
  assertEquals(sessionOutcome({ mode: 'payment', status: 'complete', payment_status: 'unpaid' }), 'wait');
});

Deno.test('non-payment sessions are ignored', () => {
  assertEquals(sessionOutcome({ mode: 'subscription', status: 'complete', payment_status: 'paid' }), 'wait');
});

Deno.test('the pay page gets its details in the URL fragment only', () => {
  const url = new URL(payPageUrl('https://zynalive.com/', {
    clientSecret: 'cs_test_a1_secret_b2',
    publishableKey: 'pk_test_123',
    returnUrl: 'https://zynalive.com/checkout-return?status=success',
    backUrl: 'https://zynalive.com/checkout-return?status=cancelled',
  }));
  assertEquals(url.origin + url.pathname, 'https://zynalive.com/pay');
  assertEquals(url.search, '');
  const hash = new URLSearchParams(url.hash.slice(1));
  assertEquals(hash.get('cs'), 'cs_test_a1_secret_b2');
  assertEquals(hash.get('pk'), 'pk_test_123');
  assertEquals(hash.get('ret'), 'https://zynalive.com/checkout-return?status=success');
  assertEquals(hash.get('back'), 'https://zynalive.com/checkout-return?status=cancelled');
});
