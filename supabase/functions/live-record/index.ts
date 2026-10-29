// Host tools → Recorder: starts or stops recording the host's own live as a replay (LiveKit
// participant egress into the uploads bucket, then the media pipeline, like media.record_live).
// POST { on: boolean } -> { recording: boolean }. Only the host, only while live.
import { EgressClient } from 'npm:livekit-server-sdk@2';

import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json, readJson, requireEnv } from '../_shared/cors.ts';
import { isRecording, startHostRecording } from '../_shared/egress.ts';
import { livekitApiHost } from '../_shared/recording.ts';
import { rateLimit } from '../_shared/redis.ts';
import { adminClient } from '../_shared/supabase.ts';

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    await rateLimit('live-record', userId, 10, '1 m');
    const { on } = await readJson<{ on: boolean }>(req);
    if (typeof on !== 'boolean') throw new HttpError(400, 'invalid_request');

    const { data: room } = await adminClient().from('rooms').select('status,livekit_room').eq('host_id', userId).maybeSingle();
    if (!room || room.status !== 'live') throw new HttpError(409, 'not_live');
    // Recording needs the storage keys; say so plainly when they aren't set.
    for (const name of ['STORAGE_S3_ENDPOINT', 'STORAGE_S3_ACCESS_KEY', 'STORAGE_S3_SECRET']) requireEnv(name);

    if (on) {
      if (!(await isRecording(room.livekit_room, userId))) await startHostRecording(room.livekit_room, userId);
      return json({ recording: true });
    }
    const client = new EgressClient(livekitApiHost(requireEnv('LIVEKIT_URL')), requireEnv('LIVEKIT_API_KEY'), requireEnv('LIVEKIT_API_SECRET'));
    const active = await client.listEgress({ roomName: room.livekit_room, active: true });
    for (const e of active) if (e.request.case === 'participant' && e.request.value.identity === userId) await client.stopEgress(e.egressId);
    return json({ recording: false });
  }),
);
