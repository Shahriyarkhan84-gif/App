// deno test supabase/functions/_shared/recharge_test.ts
import { parseAgency, parseId } from './recharge.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`expected ${expected}, got ${actual}`);
}
function assertThrows(fn: () => unknown, code: string) {
  try { fn(); } catch (e) { assertEquals((e as { code?: string }).code, code); return; }
  throw new Error('expected an error');
}

Deno.test('an 8-digit ID is accepted with or without spaces', () => {
  assertEquals(parseId('48217730'), 48217730);
  assertEquals(parseId('4821 7730'), 48217730);
});

Deno.test('anything else is not an ID', () => {
  for (const bad of ['1234567', '123456789', 'abcdefgh', '', undefined, 48217730]) assertThrows(() => parseId(bad), 'user_not_found');
});

Deno.test('the agency code is optional and must look like a code', () => {
  assertEquals(parseAgency(undefined), null);
  assertEquals(parseAgency(''), null);
  assertEquals(parseAgency('4821'), '4821');
  assertThrows(() => parseAgency('<script>'), 'invalid_agency_code');
});
