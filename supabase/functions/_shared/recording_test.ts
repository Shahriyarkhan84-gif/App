// deno test supabase/functions/_shared/recording_test.ts
import { livekitApiHost, recordingPath } from './recording.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

Deno.test('recordings land in the host folder with a safe name', () => {
  const path = recordingPath('user_2abc', new Date('2026-09-29T21:05:07.123Z'));
  assert(path === 'user_2abc/rec-2026-09-29T21-05-07-123Z.mp4', `unexpected path ${path}`);
});

Deno.test('host ids that could escape the folder are refused', () => {
  assert(throws(() => recordingPath('../other', new Date())), 'path traversal accepted');
  assert(throws(() => recordingPath('a/b', new Date())), 'nested folder accepted');
});

Deno.test('LiveKit API host uses http(s)', () => {
  assert(livekitApiHost('wss://zyna.livekit.cloud') === 'https://zyna.livekit.cloud', 'wss not mapped');
  assert(livekitApiHost('ws://localhost:7880') === 'http://localhost:7880', 'ws not mapped');
});
