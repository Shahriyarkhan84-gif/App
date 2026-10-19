// Applies a room moderation decision to LiveKit at once. Tokens last 2 hours, so without this a
// kicked viewer kept watching and a guest removed from a seat kept their microphone until they
// reconnected. Called by the app right after room_moderate / remove_from_seat, and after an owner
// ban (the room is no longer live, so the LiveKit room is closed for everyone).
// It only ever takes access away, and only what the database already says (_shared/livekit_enforce.ts),
// so any signed-in caller is safe; it can never grant anything.
import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json, readJson } from '../_shared/cors.ts';
import { enforceParticipant } from '../_shared/livekit_enforce.ts';
import { rateLimit } from '../_shared/redis.ts';
import { adminClient } from '../_shared/supabase.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(
  handler(async (req) => {
    const { userId: caller } = await requireUser(req);
    await rateLimit('livekit-enforce', caller, 30, '1 m');
    const { roomId, userId } = await readJson<{ roomId: string; userId: string }>(req);
    if (!roomId || !UUID_RE.test(roomId) || typeof userId !== 'string' || !userId) throw new HttpError(400, 'invalid_request');

    // Every answer is the same ({ ok: true }), so the call can't be used to find out whether
    // someone is kicked or muted.
    const db = adminClient();
    const { data: room } = await db.from('rooms').select('id,host_id,status,livekit_room').eq('id', roomId).maybeSingle();
    if (!room) throw new HttpError(404, 'room_not_found');
    await enforceParticipant(db, room, userId);
    return json({ ok: true });
  }),
);
