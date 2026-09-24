// Admin-only: (re)indexes every video into Pinecone for semantic search.
// curl -X POST "$SUPABASE_URL/functions/v1/index-catalog" -H "x-admin-secret: $ADMIN_SECRET"
import { handler, HttpError, json, requireEnv } from '../_shared/cors.ts';
import { upsertRecords, videoToText } from '../_shared/pinecone.ts';
import { adminClient, VIDEO_COLUMNS } from '../_shared/supabase.ts';

Deno.serve(
  handler(async (req) => {
    const secret = requireEnv('ADMIN_SECRET');
    if (req.headers.get('x-admin-secret') !== secret) throw new HttpError(401, 'Unauthorized');

    const { data, error } = await adminClient().from('videos').select(VIDEO_COLUMNS);
    if (error) throw error;

    await upsertRecords(
      (data ?? []).map((v) => ({
        _id: v.id,
        text: videoToText(v),
        title: v.title,
        genres: v.genres,
        is_premium: v.is_premium,
      })),
    );
    return json({ indexed: data?.length ?? 0 });
  }),
);
