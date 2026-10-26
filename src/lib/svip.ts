// VIP levels (V1–V6) come from the diamonds a person has bought (coin_transactions kind 'purchase',
// minus refunds/chargebacks). Display only for now: privileges are listed but not yet applied anywhere
// (see docs/ECONOMY.md).

export type PrivilegeId = 'medal' | 'name' | 'entrance' | 'frame' | 'gifts' | 'support';
export type Privilege = { id: PrivilegeId; icon: 'diamond' | 'color-palette' | 'rocket' | 'sparkles' | 'gift' | 'headset'; title: string; body: string; from: number };

/** Each privilege unlocks at a level and stays for every level above it. */
export const PRIVILEGES: Privilege[] = [
  { id: 'medal', icon: 'diamond', title: 'VIP Medal', body: 'A VIP medal next to your name on your profile and in live chat.', from: 1 },
  { id: 'name', icon: 'color-palette', title: 'Coloured name', body: 'Your name shows in your VIP colour in live chat.', from: 2 },
  { id: 'entrance', icon: 'rocket', title: 'Entrance effect', body: 'Everyone in the room sees you arrive with a VIP entrance.', from: 3 },
  { id: 'frame', icon: 'sparkles', title: 'VIP frame', body: 'An exclusive profile frame only VIPs can wear.', from: 4 },
  { id: 'gifts', icon: 'gift', title: 'VIP gifts', body: 'Send exclusive gifts other viewers can’t.', from: 5 },
  { id: 'support', icon: 'headset', title: 'Priority support', body: 'Your support messages go to the front of the queue.', from: 6 },
];

export type SvipLevel = { level: number; need: number; tagline: string; colors: [string, string, string]; gem: string };

export const SVIP_LEVELS: SvipLevel[] = [
  { level: 1, need: 1_000, tagline: 'Your first VIP medal and badge', colors: ['#3A2A24', '#6B4A3A', '#2A1F1B'], gem: '#E3B49A' },
  { level: 2, need: 5_000, tagline: 'Stand out with a coloured name', colors: ['#2B3340', '#5A6678', '#1E242E'], gem: '#D5DEEA' },
  { level: 3, need: 20_000, tagline: 'Arrive in style with an entrance effect', colors: ['#3A2E10', '#7A5A14', '#2A200A'], gem: '#FFC24B' },
  { level: 4, need: 50_000, tagline: 'Wear the exclusive VIP frame', colors: ['#0E3540', '#16707F', '#0A262E'], gem: '#67E8F9' },
  { level: 5, need: 100_000, tagline: 'Send gifts only VIPs can send', colors: ['#0F2547', '#1E4E99', '#0A1A33'], gem: '#7DB4FF' },
  { level: 6, need: 300_000, tagline: 'The top tier, with priority support', colors: ['#241A47', '#4B3A99', '#170F33'], gem: '#C4B5FD' },
];

/** Privileges a level includes (everything unlocked at or below it). */
export function privilegesFor(level: number) {
  return PRIVILEGES.filter((p) => p.from <= level);
}

/** Current level (0 = none), the next level and progress (0–1) towards it, from diamonds bought. */
export function svipProgress(bought: number) {
  const current = [...SVIP_LEVELS].reverse().find((l) => bought >= l.need) ?? null;
  const next = SVIP_LEVELS.find((l) => bought < l.need) ?? null;
  const from = current?.need ?? 0;
  const progress = next ? Math.min(1, Math.max(0, (bought - from) / (next.need - from))) : 1;
  return { level: current?.level ?? 0, current, next, progress, toNext: next ? next.need - bought : 0 };
}
