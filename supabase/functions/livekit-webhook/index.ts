// LiveKit webhook → viewer counts, viewer records, and stream end.
import { WebhookReceiver } from 'npm:livekit-server-sdk@2';

import { json, requireEnv } from '../_shared/cors.ts';
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
