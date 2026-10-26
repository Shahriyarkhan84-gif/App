// SVIP levels come from the diamonds a person has bought (coin_transactions kind 'purchase').
// Display only for now: perks are listed but not yet applied anywhere (see docs/ECONOMY.md).

export type SvipLevel = { level: number; need: number; perks: string[] };

export const SVIP_LEVELS: SvipLevel[] = [
  { level: 1, need: 1_000, perks: ['SVIP badge on your profile and in chat'] },
  { level: 2, need: 5_000, perks: ['Coloured name in live chat'] },
  { level: 3, need: 20_000, perks: ['Entrance effect when you join a live'] },
  { level: 4, need: 50_000, perks: ['Exclusive SVIP frame'] },
  { level: 5, need: 100_000, perks: ['Exclusive SVIP gifts'] },
  { level: 6, need: 300_000, perks: ['Priority support', 'Can’t be muted by room admins (only by the host)'] },
];

/** Current level (0 = none), the next level and progress (0–1) towards it, from diamonds bought. */
export function svipProgress(bought: number) {
  const current = [...SVIP_LEVELS].reverse().find((l) => bought >= l.need) ?? null;
  const next = SVIP_LEVELS.find((l) => bought < l.need) ?? null;
  const from = current?.need ?? 0;
  const progress = next ? Math.min(1, Math.max(0, (bought - from) / (next.need - from))) : 1;
  return { level: current?.level ?? 0, current, next, progress, toNext: next ? next.need - bought : 0 };
}
