// Sends phone notifications through the Expo push service. The database calls this (pg_net) with
// { kind, id } and its shared secret; what to send and to which phones comes back from
// internal_push_messages(), which checks that secret, so this function decides nothing itself.
import { handler, HttpError, json, readJson } from '../_shared/cors.ts';
import { chunk, type PushMessage, unregisteredTokens } from '../_shared/push.ts';
import { adminClient } from '../_shared/supabase.ts';

Deno.serve(
  handler(async (req) => {
    const secret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const { kind, id } = await readJson<{ kind: string; id: string }>(req);
    if (!secret || typeof kind !== 'string' || typeof id !== 'string') throw new HttpError(400, 'invalid_request');

    const db = adminClient();
    const { data, error } = await db.rpc('internal_push_messages', { p_kind: kind, p_id: id, p_secret: secret });
    if (error) throw new HttpError(error.message === 'forbidden' ? 403 : 400, error.message === 'forbidden' ? 'forbidden' : 'invalid_request');
    const messages = (data ?? []) as PushMessage[];

    const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN'); // only if "enhanced push security" is on
    let sent = 0;
    const dead: string[] = [];
    for (const batch of chunk(messages, 100)) {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(batch.map((m) => ({ to: m.token, title: m.title, body: m.body, data: m.data, sound: 'default', channelId: 'default' }))),
      });
      if (!res.ok) {
        console.error('expo push failed', res.status, await res.text());
        continue;
      }
      const tickets = ((await res.json()) as { data?: { status: string; details?: { error?: string } }[] }).data ?? [];
      sent += tickets.filter((t) => t.status === 'ok').length;
      dead.push(...unregisteredTokens(batch, tickets));
    }
    if (dead.length) await db.rpc('internal_remove_push_tokens', { p_tokens: dead, p_secret: secret });
    return json({ sent, removed: dead.length });
  }),
);
