import { shortTime } from '../time';

const now = new Date('2026-10-03T15:00:00');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('shortTime', () => {
  it('says "now" under a minute, and for clock skew into the future', () => {
    expect(shortTime(ago(20_000), now)).toBe('now');
    expect(shortTime(ago(-5 * MIN), now)).toBe('now');
  });

  it('uses minutes, then hours, within a day', () => {
    expect(shortTime(ago(5 * MIN), now)).toBe('5m');
    expect(shortTime(ago(59 * MIN), now)).toBe('59m');
    expect(shortTime(ago(3 * HOUR), now)).toBe('3h');
  });

  it('says "Yesterday" for the previous calendar day beyond 24 hours', () => {
    expect(shortTime(new Date('2026-10-02T09:00:00').toISOString(), now)).toBe('Yesterday');
  });

  it('falls back to a short date for older items', () => {
    const out = shortTime(new Date('2026-09-12T10:00:00').toISOString(), now);
    expect(out).toMatch(/12/);
    expect(out).toMatch(/Sep/);
  });
});
