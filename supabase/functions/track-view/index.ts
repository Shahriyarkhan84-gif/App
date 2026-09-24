// Counts a view in Upstash for the trending row. Each user counts at most once
// per video per hour; counts are bucketed by day and expire after 8 days.
import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json } from '../_shared/cors.ts';
import { getRedis, rateLimit, TRENDING_KEY } from '../_shared/redis.ts';
import { UUID_RE } from '../_shared/videos.ts';

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    const { videoId } = (await req.json().catch(() => ({}))) as { videoId?: string };
    if (!videoId || !UUID_RE.test(videoId)) throw new HttpError(400, 'Invalid videoId');

    const redis = getRedis();
    if (!redis) return json({ counted: false });
    await rateLimit('view', userId, 60, '1 m');

    const firstView = await redis.set(`viewed:${userId}:${videoId}`, 1, { nx: true, ex: 3600 });
    if (!firstView) return json({ counted: false });

    const dayKey = `${TRENDING_KEY}:${new Date().toISOString().slice(0, 10)}`;
    await redis.pipeline().zincrby(dayKey, 1, videoId).expire(dayKey, 8 * 24 * 3600).exec();
    return json({ counted: true });
  }),
);
