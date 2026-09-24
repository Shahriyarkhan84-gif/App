// Natural-language search over the catalog using Pinecone (integrated embeddings).
// Results are cached in Upstash for 10 minutes.
import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json } from '../_shared/cors.ts';
import { searchText } from '../_shared/pinecone.ts';
import { getRedis, rateLimit } from '../_shared/redis.ts';
import { adminClient } from '../_shared/supabase.ts';
import { videosByIds } from '../_shared/videos.ts';

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    await rateLimit('search', userId, 30, '1 m');

    const { query } = (await req.json().catch(() => ({}))) as { query?: string };
    const q = query?.trim().toLowerCase().slice(0, 200);
    if (!q || q.length < 2) throw new HttpError(400, 'Query too short');

    const redis = getRedis();
    const cacheKey = `search:${q}`;
    let ids = (await redis?.get<string[]>(cacheKey)) ?? null;
    if (!ids) {
      ids = await searchText(q, 20);
      await redis?.set(cacheKey, ids, { ex: 600 });
    }

    return json({ videos: await videosByIds(adminClient(), ids) });
  }),
);
