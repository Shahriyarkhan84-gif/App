import { FACE_PAUSE_AFTER_MS, FACE_WARN_AFTER_MS, faceStatus } from '../faceRule';

describe('faceStatus', () => {
  it('is fine while a face was seen recently', () => {
    expect(faceStatus(10_000, 9_000, 0)).toEqual({ kind: 'ok' });
  });
  it('warns, counting down, after the warning time', () => {
    expect(faceStatus(FACE_WARN_AFTER_MS, null, 0)).toEqual({ kind: 'warn', pauseInSeconds: (FACE_PAUSE_AFTER_MS - FACE_WARN_AFTER_MS) / 1000 });
  });
  it('pauses after the pause time', () => {
    expect(faceStatus(100_000, 100_000 - FACE_PAUSE_AFTER_MS, 0)).toEqual({ kind: 'pause' });
  });
});
