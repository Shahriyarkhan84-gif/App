// LiveKit webhook → viewer counts, viewer records, stream end, and live
// recordings (host egress → media pipeline, when media.record_live is on).
import { EgressStatus, WebhookReceiver } from 'npm:livekit-server-sdk@2';

import { json, requireEnv } from '../_shared/cors.ts';
import { startHostRecording } from '../_shared/egress.ts';
import { adminClient, alreadyProcessed, markEventProcessed } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const receiver = new WebhookReceiver(requireEnv('LIVEKIT_API_KEY'), requireEnv('LIVEKIT_API_SECRET'));
  let event;
  try {
    event = await receiver.receive(await req.text(), req.headers.get('Authorization') ?? undefined);
  } catch {
    return json({ error: { code: 'invalid_signature', message: 'Invalid signature' } }, 401);
  }

  if (event.id && (await alreadyProcessed('livekit', event.id))) return json({ duplicate: true });

  const db = adminClient();
  const roomName = event.room?.name;
  try {
    if (roomName && (event.event === 'participant_joined' || event.event === 'participant_left')) {
      // numParticipants includes the host.
      const count = Math.max(0, (event.room?.numParticipants ?? 1) - 1);
      const { error } = await db.rpc('internal_viewer_event', {
        p_livekit_room: roomName,
        p_user: event.participant?.identity ?? null,
        p_joined: event.event === 'participant_joined',
        p_count: count,
      });
      if (error) throw error;
      if (event.event === 'participant_joined' && event.participant?.identity) {
        await maybeRecordHost(db, roomName, event.participant.identity);
      }
    } else if (event.event === 'egress_ended' && event.egressInfo) {
      const info = event.egressInfo;
      const file = info.fileResults?.[0]?.filename;
      if (info.status === EgressStatus.EGRESS_COMPLETE && file) {
        const { error } = await db.rpc('internal_register_live_recording', {
          p_livekit_room: info.roomName,
          p_egress_id: info.egressId,
          p_path: file,
        });
        if (error) throw error;
      }
    } else if (roomName && event.event === 'room_finished') {
      const { error } = await db.rpc('internal_end_stream_by_livekit_room', { p_livekit_room: roomName });
      if (error) throw error;
    }
  } catch (err) {
    console.error('livekit webhook failed', err);
    return json({ error: { code: 'internal', message: 'Handler failed' } }, 500);
  }

  if (event.id) await markEventProcessed('livekit', event.id);
  return json({ ok: true });
});

// Starts a recording when the room's own host joins, if live recording is enabled.
async function maybeRecordHost(db: ReturnType<typeof adminClient>, livekitRoom: string, identity: string) {
  const [{ data: room }, { data: setting }] = await Promise.all([
    db.from('rooms').select('host_id,status').eq('livekit_room', livekitRoom).maybeSingle(),
    db.from('platform_settings').select('value').eq('key', 'media').maybeSingle(),
  ]);
  if (!room || room.host_id !== identity || room.status !== 'live') return;
  if (setting?.value?.record_live !== true) return;
  // A recording problem must not fail the webhook (and so viewer counting): log it and move on.
  try {
    const egressId = await startHostRecording(livekitRoom, identity);
    console.log('recording host', identity, 'egress', egressId);
  } catch (err) {
    console.error('could not start recording for', identity, err);
  }
}
