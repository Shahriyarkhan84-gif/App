// The "no face" rule for hosts: how long the camera may show no face before the app warns, then
// pauses the live. Shared by the face check (web) and the host screen.
export const FACE_WARN_AFTER_MS = 15_000;
export const FACE_PAUSE_AFTER_MS = 45_000;
export const FACE_CHECK_EVERY_MS = 1_500;

export type FaceStatus = { kind: 'ok' } | { kind: 'warn'; pauseInSeconds: number } | { kind: 'pause' };

/** What to do, given when a face was last seen (null: never yet, counts from `since`). */
export function faceStatus(now: number, lastFaceAt: number | null, since: number): FaceStatus {
  const missing = now - (lastFaceAt ?? since);
  if (missing >= FACE_PAUSE_AFTER_MS) return { kind: 'pause' };
  if (missing >= FACE_WARN_AFTER_MS) return { kind: 'warn', pauseInSeconds: Math.ceil((FACE_PAUSE_AFTER_MS - missing) / 1000) };
  return { kind: 'ok' };
}
