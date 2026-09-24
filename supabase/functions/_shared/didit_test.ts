// deno test supabase/functions/_shared/didit_test.ts
// Vectors generated with Didit's reference Python implementation (see docs/HOST_VERIFICATION.md).
import { canonicalJson, verifyWebhook } from './didit.ts';

const SECRET = 'whsec_test_secret';
const NOW = 1790270000;

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const VECTORS = JSON.parse(await Deno.readTextFile(new URL('./didit_vectors.json', import.meta.url)));

Deno.test('canonical JSON matches Python json.dumps(sort_keys, ensure_ascii=False, compact)', () => {
  for (const v of VECTORS) assert(canonicalJson(JSON.parse(v.raw)) === v.canonical, `canonical mismatch for ${v.raw}`);
});

Deno.test('accepts valid X-Signature and X-Signature-Simple', async () => {
  for (const v of VECTORS) {
    const h = new Headers({ 'x-timestamp': String(NOW), 'x-signature': v.signature });
    assert(await verifyWebhook(h, v.raw, SECRET, NOW), 'X-Signature rejected');
    const s = new Headers({ 'x-timestamp': String(NOW), 'x-signature-simple': v.simple });
    assert(await verifyWebhook(s, v.raw, SECRET, NOW), 'X-Signature-Simple rejected');
  }
});

Deno.test('rejects tampered body, wrong secret and stale timestamp', async () => {
  const v = VECTORS[0];
  const h = new Headers({ 'x-timestamp': String(NOW), 'x-signature': v.signature });
  assert(!(await verifyWebhook(h, v.raw.replace('Approved', 'Declined'), SECRET, NOW)), 'tampered body accepted');
  assert(!(await verifyWebhook(h, v.raw, 'other', NOW)), 'wrong secret accepted');
  assert(!(await verifyWebhook(h, v.raw, SECRET, NOW + 301)), 'stale timestamp accepted');
  assert(!(await verifyWebhook(new Headers({ 'x-timestamp': String(NOW) }), v.raw, SECRET, NOW)), 'unsigned accepted');
});
