// Daily tasks: progress is counted from what you actually did today (local day).
// Rewards aren't paid yet: diamonds only come from real payments, so tasks show "coming soon".

export type TaskId = 'follow' | 'chat' | 'gift' | 'live';
export type DailyTask = { id: TaskId; title: string; body: string; goal: number; unit?: string };

export const DAILY_TASKS: DailyTask[] = [
  { id: 'follow', title: 'Follow someone', body: 'Follow a host or a friend.', goal: 1 },
  { id: 'chat', title: 'Say hello in a live', body: 'Send 3 messages in live chat.', goal: 3 },
  { id: 'gift', title: 'Send a gift', body: 'Support a host with any gift.', goal: 1 },
  { id: 'live', title: 'Go live', body: 'Stream for 10 minutes.', goal: 10, unit: 'min' },
];

/** Start of today in the phone's time zone, as an ISO string for database filters. */
export function startOfToday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Minutes streamed today from stream rows (an unfinished stream counts up to now). */
export function liveMinutes(streams: { started_at: string; ended_at: string | null }[], since: string, now = new Date()) {
  const from = new Date(since).getTime();
  let ms = 0;
  for (const s of streams) {
    const start = Math.max(new Date(s.started_at).getTime(), from);
    const end = s.ended_at ? new Date(s.ended_at).getTime() : now.getTime();
    if (end > start) ms += end - start;
  }
  return Math.floor(ms / 60_000);
}
