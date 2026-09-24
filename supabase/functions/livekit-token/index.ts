// Issues a LiveKit access token. LIVEKIT_API_SECRET never leaves the backend.
// Hosts may publish only in their own room after calling go_live(); viewers
// may only subscribe, and are refused if banned or kicked/blocked in the room.
import { AccessToken, TrackSource } from 'npm:livekit-server-sdk@2';

import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json, readJson, requireEnv } from '../_shared/cors.ts';
import { rateLimit } from '../_shared/redis.ts';
import { adminClient } from '../_shared/supabase.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    await rateLimit('livekit-token', userId, 30, '1 m');

    const { roomId, as } = await readJson<{ roomId: string; as: 'viewer' | 'host' }>(req);
    if (!roomId || !UUID_RE.test(roomId) || (as !== 'viewer' && as !== 'host')) {
      throw new HttpError(400, 'invalid_request');
    }

    const db = adminClient();
    const [{ data: room }, { data: status }, { data: profile }] = await Promise.all([
      db.from('rooms').select('id,host_id,status,livekit_room').eq('id', roomId).maybeSingle(),
      db.rpc('user_status', { p_user: userId }),
      db.from('profiles').select('display_name,username').eq('id', userId).maybeSingle(),
    ]);
    if (!room) throw new HttpError(404, 'room_not_found');
    if (status === 'banned') throw new HttpError(403, 'account_restricted');
    if (room.status !== 'live') throw new HttpError(409, 'room_not_live');

    const isHost = room.host_id === userId;
    if (as === 'host' && !isHost) throw new HttpError(403, 'forbidden');
    if (!isHost) {
      const { data: bans } = await db
        .from('room_bans')
        .select('kind,expires_at')
        .eq('room_id', roomId)
        .eq('user_id', userId)
        .in('kind', ['kick', 'block']);
      const active = (bans ?? []).some((b) => !b.expires_at || new Date(b.expires_at) > new Date());
      if (active) throw new HttpError(403, 'banned_from_room');
    }

    const token = new AccessToken(requireEnv('LIVEKIT_API_KEY'), requireEnv('LIVEKIT_API_SECRET'), {
      identity: userId,
      name: profile?.display_name ?? profile?.username ?? 'Viewer',
      ttl: '2h',
    });
    token.addGrant({
      roomJoin: true,
      room: room.livekit_room,
      canSubscribe: true,
      canPublish: as === 'host',
      canPublishSources: as === 'host' ? [TrackSource.CAMERA, TrackSource.MICROPHONE] : [],
      canPublishData: false, // chat goes through send_chat_message() for moderation
    });

    return json({ token: await token.toJwt(), url: requireEnv('LIVEKIT_URL') });
  }),
);
