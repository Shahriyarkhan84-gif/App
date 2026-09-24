// Top titles by views over the last 7 days (daily Upstash sorted sets).
import { requireUser } from '../_shared/auth.ts';
import { handler, json } from '../_shared/cors.ts';
import { getRedis, TRENDING_KEY } from '../_shared/redis.ts';
import { adminClient } from '../_shared/supabase.ts';
import { videosByIds } from '../_shared/videos.ts';

Deno.serve(
  handler(async (req) => {
    await requireUser(req);
    const redis = getRedis();
    if (!redis) return json({ videos: [] });

    const cached = await redis.get<string[]>(`${TRENDING_KEY}:top`);
    let ids = cached;
    if (!ids) {
      const pipeline = redis.pipeline();
      for (let i = 0; i < 7; i++) {
        const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        pipeline.zrange(`${TRENDING_KEY}:${day}`, 0, 99, { rev: true, withScores: true });
      }
      const totals = new Map<string, number>();
      for (const flat of (await pipeline.exec()) as (string | number)[][]) {
        for (let j = 0; j < flat.length; j += 2) {
          const id = String(flat[j]);
          totals.set(id, (totals.get(id) ?? 0) + Number(flat[j + 1]));
        }
      }
      ids = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id]) => id);
      await redis.set(`${TRENDING_KEY}:top`, ids, { ex: 300 });
    }

    return json({ videos: await videosByIds(adminClient(), ids) });
  }),
);
