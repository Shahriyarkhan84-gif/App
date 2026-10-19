// deno test supabase/functions/_shared/livekit_enforce_test.ts
import { decide } from './livekit_enforce.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`expected ${expected}, got ${actual}`);
}

const live = { host_id: 'host', status: 'live' };
const now = new Date('2026-10-19T12:00:00Z');

Deno.test('a room that is no longer live is closed for everyone', () => {
  assertEquals(decide({ host_id: 'host', status: 'offline' }, 'host', [], false, now), 'close_room');
  assertEquals(decide({ host_id: 'host', status: 'offline' }, 'fan', [], false, now), 'close_room');
});

Deno.test('the host of a live room keeps access', () => {
  assertEquals(decide(live, 'host', [{ kind: 'block', expires_at: null }], false, now), 'none');
});

Deno.test('an active kick or block removes the person', () => {
  assertEquals(decide(live, 'fan', [{ kind: 'kick', expires_at: '2026-10-19T13:00:00Z' }], false, now), 'remove');
  assertEquals(decide(live, 'fan', [{ kind: 'block', expires_at: null }], true, now), 'remove');
});

Deno.test('an expired kick no longer applies', () => {
  assertEquals(decide(live, 'fan', [{ kind: 'kick', expires_at: '2026-10-19T11:00:00Z' }], true, now), 'none');
});

Deno.test('no seat or a mute means listen only', () => {
  assertEquals(decide(live, 'fan', [], false, now), 'listener');
  assertEquals(decide(live, 'guest', [{ kind: 'mute', expires_at: null }], true, now), 'listener');
  assertEquals(decide(live, 'guest', [], true, now), 'none');
});
