// Pure helpers for live recordings (no SDK import, so they test without env access).

export const RECORDINGS_BUCKET = 'uploads';

/** Object name for a recording: always inside the host's own folder. */
export function recordingPath(hostId: string, startedAt: Date): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(hostId)) throw new Error('invalid_host_id');
  return `${hostId}/rec-${startedAt.toISOString().replace(/[:.]/g, '-')}.mp4`;
}

/** LiveKit server API wants https:// even though clients connect with wss://. */
export function livekitApiHost(url: string): string {
  return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}
