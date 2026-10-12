// Smart search over the Pinecone index the AI worker keeps of live rooms
// (agents/zynalive_agents/search_sync.py). Pinecone embeds the query text itself
// (multilingual-e5-large), so English, Urdu, Hindi and Roman Urdu match by meaning.
export const PINECONE_API_VERSION = '2026-07'; // same as the worker
export const NAMESPACE = 'live';

export type SearchRequest = { q?: string; similarTo?: string; limit?: number };
export type SearchHit = { id: string; score: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates the request and builds Pinecone's search body; null = nothing to search. */
export function searchBody(req: SearchRequest): Record<string, unknown> | null {
  const limit = Math.min(Math.max(Math.trunc(req.limit ?? 20), 1), 50);
  if (req.similarTo !== undefined) {
    if (!UUID_RE.test(req.similarTo)) return null;
    // "Similar lives": search with the room's own stored vector; one extra to drop the room itself.
    return { query: { id: req.similarTo, top_k: limit + 1 }, fields: ['host_id'] };
  }
  const q = (req.q ?? '').trim().replace(/\s+/g, ' ');
  if (q.length < 2 || q.length > 100) return null;
  return { query: { inputs: { text: q }, top_k: limit }, fields: ['host_id'] };
}

/** Pinecone's `{ result: { hits: [{ _id, _score }] } }` → ranked room ids (without the source room). */
export function parseHits(body: unknown, excludeId?: string, limit = 20): SearchHit[] {
  const hits = (body as { result?: { hits?: { _id?: unknown; _score?: unknown }[] } })?.result?.hits ?? [];
  return hits
    .filter((h) => typeof h._id === 'string' && UUID_RE.test(h._id) && h._id !== excludeId)
    .map((h) => ({ id: h._id as string, score: typeof h._score === 'number' ? h._score : 0 }))
    .slice(0, limit);
}
