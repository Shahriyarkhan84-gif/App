// Applies the database's room decisions to LiveKit. It only ever takes access away, and only what
// the database already says, so callers can't use it to grant anything:
// - the room isn't live (ended, or the host was banned): close the LiveKit room for everyone;
// - an active kick or block: disconnect the person;
// - no seat, or a mute: remove their publish rights (they can still watch).
import { RoomServiceClient, TrackSource } from 'npm:livekit-server-sdk@2';

import { requireEnv } from './cors.ts';
import { livekitApiHost } from './recording.ts';
import type { adminClient } from './supabase.ts';

type Db = ReturnType<typeof adminClient>;
export type EnforceRoom = { id: string; host_id: string; status: string; livekit_room: string };

export function roomService() {
  return new RoomServiceClient(livekitApiHost(requireEnv('LIVEKIT_URL')), requireEnv('LIVEKIT_API_KEY'), requireEnv('LIVEKIT_API_SECRET'));
}

const notFound = (err: unknown) => /not found|not_found|404/i.test(String((err as Error)?.message ?? err));

/** What LiveKit should do with `userId` in `room`, from the database alone (exported for tests). */
export function decide(
  room: Pick<EnforceRoom, 'host_id' | 'status'>,
  userId: string,
  bans: { kind: string; expires_at: string | null }[],
  seated: boolean,
  now = new Date(),
): 'close_room' | 'remove' | 'listener' | 'none' {
  if (room.status !== 'live') return 'close_room';
  if (room.host_id === userId) return 'none';
  const active = bans.filter((b) => !b.expires_at || new Date(b.expires_at) > now).map((b) => b.kind);
  if (active.includes('kick') || active.includes('block')) return 'remove';
  if (!seated || active.includes('mute')) return 'listener';
  return 'none';
}

/**
 * Looks up the person's bans and seat and applies `decide` in LiveKit. Missing participants are
 * fine. Pass `canPublish: false` when it's known they can't publish (a plain viewer joining), to
 * skip a pointless LiveKit call.
 */
export async function enforceParticipant(db: Db, room: EnforceRoom, userId: string, canPublish?: boolean) {
  const [{ data: bans }, { data: seat }] = await Promise.all([
    db.from('room_bans').select('kind,expires_at').eq('room_id', room.id).eq('user_id', userId).in('kind', ['kick', 'block', 'mute']),
    db.from('room_seats').select('seat').eq('room_id', room.id).eq('user_id', userId).maybeSingle(),
  ]);
  const action = decide(room, userId, bans ?? [], !!seat);
  const lk = roomService();
  try {
    if (action === 'close_room') await lk.deleteRoom(room.livekit_room);
    else if (action === 'remove') await lk.removeParticipant(room.livekit_room, userId);
    else if (action === 'listener' && canPublish !== false) {
      await lk.updateParticipant(room.livekit_room, userId, undefined, {
        canSubscribe: true,
        canPublish: false,
        canPublishData: false,
        canPublishSources: [] as TrackSource[],
      });
    }
  } catch (err) {
    // Not in the LiveKit room (already left, or the room is already gone): nothing to take away.
    if (!notFound(err)) throw err;
  }
  return action;
}
