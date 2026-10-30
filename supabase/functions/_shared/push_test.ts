// deno test supabase/functions/_shared/push_test.ts
import { chunk, unregisteredTokens } from './push.ts';

function assertEquals(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

const msg = (token: string) => ({ token, title: 't', body: 'b', data: {} });

Deno.test('messages go out in batches of at most 100', () => {
  assertEquals(chunk(Array.from({ length: 250 }, (_, i) => i), 100).map((b) => b.length), [100, 100, 50]);
  assertEquals(chunk([], 100), []);
});

Deno.test('only tokens Expo reports as no longer registered are removed', () => {
  const batch = [msg('a'), msg('b'), msg('c')];
  const tickets = [
    { status: 'ok' },
    { status: 'error', details: { error: 'DeviceNotRegistered' } },
    { status: 'error', details: { error: 'MessageRateExceeded' } },
  ];
  assertEquals(unregisteredTokens(batch, tickets), ['b']);
});
