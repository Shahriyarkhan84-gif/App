// Smart search: live rooms by meaning ("cricket talk" finds "Pakistan vs India match chat"), in
// English, Urdu, Hindi or Roman Urdu, and "similar lives" for a room. Returns ranked room ids only;
// the app loads the rooms itself through RLS. The Pinecone key never leaves the backend.
import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json, readJson } from '../_shared/cors.ts';
import { rateLimit } from '../_shared/redis.ts';
import { NAMESPACE, parseHits, PINECONE_API_VERSION, searchBody, type SearchRequest } from '../_shared/search.ts';

let indexHost: string | null = Deno.env.get('PINECONE_INDEX_HOST') ?? null;

async function host(apiKey: string): Promise<string> {
  if (indexHost) return indexHost.startsWith('https://') ? indexHost : `https://${indexHost}`;
  const name = Deno.env.get('PINECONE_INDEX') ?? 'zynalive-live';
  const res = await fetch(`https://api.pinecone.io/indexes/${encodeURIComponent(name)}`, {
    headers: { 'Api-Key': apiKey, 'X-Pinecone-Api-Version': PINECONE_API_VERSION },
  });
  // The worker creates the index on its first sync; until then search is simply "not ready".
  if (res.status === 404) throw new HttpError(503, 'not_configured');
  if (!res.ok) throw new Error(`pinecone describe ${res.status}`);
  const info = (await res.json()) as { host: string };
  indexHost = `https://${info.host.replace(/^https:\/\//, '')}`;
  return indexHost;
}

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    await rateLimit('smart-search', userId, 30, '1 m');
    const apiKey = Deno.env.get('PINECONE_API_KEY');
    if (!apiKey) throw new HttpError(503, 'not_configured');

    const input = await readJson<SearchRequest>(req);
    const body = searchBody(input);
    if (!body) throw new HttpError(400, 'invalid_request');
    const res = await fetch(`${await host(apiKey)}/records/namespaces/${NAMESPACE}/search`, {
      method: 'POST',
      headers: { 'Api-Key': apiKey, 'X-Pinecone-Api-Version': PINECONE_API_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // "Similar lives" for a room that isn't indexed (just went live) has nothing to compare yet.
    if (res.status === 404) return json({ results: [] });
    if (!res.ok) throw new Error(`pinecone search ${res.status}`);
    return json({ results: parseHits(await res.json(), input.similarTo, Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 50)) });
  }),
);
