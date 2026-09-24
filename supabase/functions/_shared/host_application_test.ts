// deno test supabase/functions/_shared/host_application_test.ts
import { cnicMatches, nameMatches, normalizeCnic, normalizePkMobile } from './host_application.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.test('phone numbers', () => {
  assert(normalizePkMobile('300 1234567') === '+923001234567', 'plain');
  assert(normalizePkMobile('0300-1234567') === '+923001234567', 'leading 0');
  assert(normalizePkMobile('+92 300 1234567') === '+923001234567', 'with +92');
  assert(normalizePkMobile('4001234567') === null, 'not a mobile');
  assert(normalizePkMobile('30012345') === null, 'too short');
});

Deno.test('CNIC numbers', () => {
  assert(normalizeCnic('35202-1234567-1') === '3520212345671', 'dashed');
  assert(normalizeCnic('352021234567') === null, '12 digits');
  assert(cnicMatches('3520212345671', null, '35202-1234567-1'), 'matches personal number');
  assert(!cnicMatches('3520212345671', 'AB1234567', '35202-1234567-2'), 'different number');
});

Deno.test('names', () => {
  assert(nameMatches('Ayesha Khan', 'AYESHA KHAN'), 'case');
  assert(nameMatches('Muhammad Ali Raza', 'Muhammad Ali'), 'one extra part allowed');
  assert(nameMatches('Ali', 'Muhammad Ali Raza'), 'single name');
  assert(!nameMatches('Sara Ahmed', 'Bilal Khan'), 'different person');
  assert(!nameMatches('Sara Ahmed', null), 'no OCR name');
});
