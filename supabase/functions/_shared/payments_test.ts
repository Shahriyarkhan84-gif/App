// deno test supabase/functions/_shared/payments_test.ts
import { sessionOutcome } from './payments.ts';

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
