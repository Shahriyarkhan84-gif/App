// deno test supabase/functions/_shared/search_test.ts
import { parseHits, searchBody } from './search.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
const ROOM = '0b7c2c1e-8f3a-4d6b-9a52-1f2e3d4c5b6a';
const OTHER = '9a52b7c2-0b7c-4d6b-8f3a-1f2e3d4c5b6a';

Deno.test('text search trims, bounds the length and caps results', () => {
  const body = searchBody({ q: '  cricket   talk ', limit: 500 }) as { query: { inputs: { text: string }; top_k: number } };
  assert(body.query.inputs.text === 'cricket talk', 'collapses spaces');
  assert(body.query.top_k === 50, 'caps at 50');
  assert(searchBody({ q: 'a' }) === null, 'too short');
  assert(searchBody({ q: 'x'.repeat(101) }) === null, 'too long');
});

Deno.test('similar lives search by the room vector and drop the room itself', () => {
  const body = searchBody({ similarTo: ROOM, limit: 6 }) as { query: { id: string; top_k: number } };
  assert(body.query.id === ROOM && body.query.top_k === 7, 'one extra for the source room');
  assert(searchBody({ similarTo: 'not-a-uuid' }) === null, 'rejects non-uuid ids');
  const hits = parseHits({ result: { hits: [{ _id: ROOM, _score: 1 }, { _id: OTHER, _score: 0.8 }, { _id: 'junk', _score: 0.5 }] } }, ROOM, 6);
  assert(hits.length === 1 && hits[0].id === OTHER && hits[0].score === 0.8, 'source room and junk ids removed');
  assert(parseHits(null).length === 0, 'tolerates an empty body');
});
