// Helpers for push-send (Expo push service).

export type PushMessage = { token: string; title: string; body: string; data: Record<string, unknown> };

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Tokens whose ticket says the phone no longer accepts them (uninstalled, notifications off).
 * Expo returns one ticket per message, in the same order. */
export function unregisteredTokens(batch: PushMessage[], tickets: { status: string; details?: { error?: string } }[]): string[] {
  return batch.filter((_, i) => tickets[i]?.status === 'error' && tickets[i]?.details?.error === 'DeviceNotRegistered').map((m) => m.token);
}
