import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';

/**
 * Account tags put on every store purchase, so the server can tell the purchase was made from this
 * account (a purchase token copied from another phone is refused). Must match
 * supabase/functions/_shared/stores.ts; both are tested against the same reference values.
 */
export async function storeAccountTags(userId: string): Promise<{ google: string; apple: string }> {
  const hex = await digestStringAsync(CryptoDigestAlgorithm.SHA256, `zynalive:${userId}`);
  return { google: hex, apple: appleTokenFromHex(hex) };
}

/** First 16 bytes of the hash as a version-4-shaped UUID (Apple's appAccountToken must be a UUID). */
export function appleTokenFromHex(hex: string): string {
  const b = hex.slice(0, 32).match(/../g)!.map((x) => parseInt(x, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
