import { svipProgress } from '../svip';
import { liveMinutes, startOfToday } from '../tasks';

describe('svipProgress', () => {
  it('starts at no level, half way to SVIP 1 after 500 diamonds', () => {
    const p = svipProgress(500);
    expect(p.level).toBe(0);
    expect(p.next?.level).toBe(1);
    expect(p.progress).toBeCloseTo(0.5);
    expect(p.toNext).toBe(500);
  });
  it('reaches a level exactly at its threshold', () => {
    expect(svipProgress(5_000).level).toBe(2);
  });
  it('tops out at the last level', () => {
    const p = svipProgress(1_000_000);
    expect(p.level).toBe(6);
    expect(p.next).toBeNull();
    expect(p.progress).toBe(1);
  });
});

describe('liveMinutes', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const since = '2026-10-26T00:00:00.000Z';
  it('counts finished and running streams, only from the start of today', () => {
    expect(liveMinutes([
      { started_at: '2026-10-25T23:50:00Z', ended_at: '2026-10-26T00:05:00Z' }, // 5 min today
      { started_at: '2026-10-26T11:45:00Z', ended_at: null }, // 15 min, still live
    ], since, now)).toBe(20);
  });
  it('gives a midnight timestamp for today', () => {
    expect(new Date(startOfToday(new Date(2026, 9, 26, 15, 30))).getHours()).toBe(0);
  });
});
