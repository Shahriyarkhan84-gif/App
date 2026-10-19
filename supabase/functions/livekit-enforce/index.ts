// Applies a room moderation decision to LiveKit at once. Tokens last 2 hours, so without this a
// kicked viewer kept watching and a guest removed from a seat kept their microphone until they
// reconnected. Called by the app right after room_moderate / remove_from_seat.
// It only ever takes access away, and only what the database already says: an active kick or
// block disconnects the person; no seat (or a mute) removes their publish rights. So any signed-in
// caller is safe; it can never grant anything.
import { RoomServiceClient, TrackSource } from 'npm:livekit-server-sdk@2';

import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json, readJson, requireEnv } from '../_shared/cors.ts';
import { livekitApiHost } from '../_shared/recording.ts';
import { rateLimit } from '../_shared/redis.ts';
import { adminClient } from '../_shared/supabase.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(
  handler(async (req) => {
    const { userId: caller } = await requireUser(req);
    await rateLimit('livekit-enforce', caller, 30, '1 m');
    const { roomId, userId } = await readJson<{ roomId: string; userId: string }>(req);
    if (!roomId || !UUID_RE.test(roomId) || typeof userId !== 'string' || !userId) throw new HttpError(400, 'invalid_request');

    const db = adminClient();
    const [{ data: room }, { data: bans }, { data: seat }] = await Promise.all([
      db.from('rooms').select('host_id,status,livekit_room,mode').eq('id', roomId).maybeSingle(),
      db.from('room_bans').select('kind,expires_at').eq('room_id', roomId).eq('user_id', userId).in('kind', ['kick', 'block', 'mute']),
      db.from('room_seats').select('seat').eq('room_id', roomId).eq('user_id', userId).maybeSingle(),
    ]);
    if (!room) throw new HttpError(404, 'room_not_found');
    if (room.status !== 'live' || room.host_id === userId) return json({ applied: 'none' });

    const active = (bans ?? []).filter((b) => !b.expires_at || new Date(b.expires_at) > new Date()).map((b) => b.kind);
    const lk = new RoomServiceClient(livekitApiHost(requireEnv('LIVEKIT_URL')), requireEnv('LIVEKIT_API_KEY'), requireEnv('LIVEKIT_API_SECRET'));
    try {
      if (active.includes('kick') || active.includes('block')) {
        await lk.removeParticipant(room.livekit_room, userId);
        return json({ applied: 'removed' });
      }
      if (!seat || active.includes('mute')) {
        await lk.updateParticipant(room.livekit_room, userId, undefined, {
          canSubscribe: true,
          canPublish: false,
          canPublishData: false,
          canPublishSources: [] as TrackSource[],
        });
        return json({ applied: 'listener' });
      }
    } catch (err) {
      // Not in the LiveKit room (already left): nothing to take away.
      if (/not found|not_found|404/i.test(String((err as Error)?.message ?? err))) return json({ applied: 'none' });
      throw err;
    }
    return json({ applied: 'none' });
  }),
);
