// "Because you watched X": finds titles semantically similar to the user's most
// recently watched video via Pinecone. Similar-title lists are cached in Upstash.
import { requireUser } from '../_shared/auth.ts';
import { handler, json } from '../_shared/cors.ts';
import { searchText, videoToText } from '../_shared/pinecone.ts';
import { getRedis, rateLimit } from '../_shared/redis.ts';
import { adminClient, userClient, VIDEO_COLUMNS } from '../_shared/supabase.ts';
import { videosByIds } from '../_shared/videos.ts';

Deno.serve(
  handler(async (req) => {
    const { userId, token } = await requireUser(req);
    await rateLimit('recs', userId, 30, '1 m');

    const { data: last, error } = await userClient(token)
      .from('watch_progress')
      .select(`video_id, videos(${VIDEO_COLUMNS})`)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    // deno-lint-ignore no-explicit-any
    const basedOn = (last?.videos ?? null) as any;
    if (!basedOn) return json({ basedOn: null, videos: [] });

    const redis = getRedis();
    const cacheKey = `similar:${basedOn.id}`;
    let ids = (await redis?.get<string[]>(cacheKey)) ?? null;
    if (!ids) {
      ids = await searchText(videoToText(basedOn), 12, [basedOn.id]);
      await redis?.set(cacheKey, ids, { ex: 3600 });
    }

    return json({
      basedOn: { id: basedOn.id, title: basedOn.title },
      videos: await videosByIds(adminClient(), ids),
    });
  }),
);
