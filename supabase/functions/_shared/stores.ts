// Google Play and Apple App Store purchase checks, shared by iap-verify (credit) and
// store-notifications (refunds). Every decision uses what Google or Apple returned to this server
// over their own APIs, never what the app says.
import { importPKCS8, SignJWT } from 'npm:jose@5';

import { HttpError, requireEnv } from './cors.ts';

// --- account binding -------------------------------------------------------------------------
// The app tags each purchase with a value derived from the buyer's account, so a purchase token
// copied from someone else's phone can't be claimed. The app computes the same values (src/lib/iap.ts).

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Google obfuscatedAccountId: hex SHA-256 of the user id (64 chars, Google's limit). */
export async function googleAccountTag(userId: string): Promise<string> {
  return [...(await sha256(`zynalive:${userId}`))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Apple appAccountToken: the first 16 bytes of the same hash as a version-4-shaped UUID. */
export async function appleAccountToken(userId: string): Promise<string> {
  const b = (await sha256(`zynalive:${userId}`)).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// --- decisions (pure, tested in stores_test.ts) ------------------------------------------------

/** Fields of Google's purchases.products resource this needs. */
export type GooglePurchase = {
  purchaseState?: number; // 0 purchased · 1 cancelled · 2 pending
  consumptionState?: number; // 0 not yet consumed · 1 consumed
  orderId?: string;
  purchaseType?: number; // 0 test (licence tester) · 1 promo · 2 rewarded; absent for real purchases
  obfuscatedExternalAccountId?: string;
};

export type Outcome = { action: 'credit'; orderRef: string } | { action: 'pending' } | { action: 'reject'; reason: string };

export function googleOutcome(p: GooglePurchase, accountTag: string, allowTest: boolean): Outcome {
  if (p.purchaseState === 2) return { action: 'pending' };
  if (p.purchaseState !== 0) return { action: 'reject', reason: 'purchase_not_paid' };
  if (p.purchaseType !== undefined && p.purchaseType !== null && !(allowTest && p.purchaseType === 0)) {
    return { action: 'reject', reason: 'test_purchase' };
  }
  if (p.obfuscatedExternalAccountId !== accountTag) return { action: 'reject', reason: 'purchase_not_yours' };
  if (!p.orderId) return { action: 'reject', reason: 'purchase_not_paid' };
  return { action: 'credit', orderRef: p.orderId };
}

/** Fields of Apple's JWSTransactionDecodedPayload this needs. */
export type AppleTransaction = {
  transactionId?: string;
  bundleId?: string;
  productId?: string;
  type?: string;
  appAccountToken?: string;
  revocationDate?: number;
  environment?: string; // Production | Sandbox
};

export function appleOutcome(
  t: AppleTransaction,
  expected: { bundleId: string; productId: string; accountToken: string },
  allowTest: boolean,
): Outcome {
  if (t.bundleId !== expected.bundleId || t.productId !== expected.productId) return { action: 'reject', reason: 'invalid_purchase' };
  if (t.type !== 'Consumable') return { action: 'reject', reason: 'invalid_purchase' };
  if (t.revocationDate) return { action: 'reject', reason: 'purchase_not_paid' };
  if (t.environment !== 'Production' && !allowTest) return { action: 'reject', reason: 'test_purchase' };
  if (t.appAccountToken?.toLowerCase() !== expected.accountToken) return { action: 'reject', reason: 'purchase_not_yours' };
  if (!t.transactionId) return { action: 'reject', reason: 'invalid_purchase' };
  return { action: 'credit', orderRef: t.transactionId };
}

/** Payload of a JWS (header.payload.signature) without checking the signature. Only for data this
 * server fetched from Apple itself over TLS, or to read an id that is then re-checked with Apple. */
export function jwsPayload<T>(jws: string): T {
  const part = jws.split('.')[1];
  if (!part) throw new HttpError(400, 'invalid_purchase');
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))) as T;
}

export const allowTestPurchases = () => Deno.env.get('IAP_ALLOW_TEST_PURCHASES') === 'true';

// --- Google Play Developer API ----------------------------------------------------------------

let googleToken: { value: string; expires: number } | undefined;

/** OAuth token for the Play Developer API from the service account in GOOGLE_PLAY_SERVICE_ACCOUNT (JSON). */
async function googleAccessToken(): Promise<string> {
  if (googleToken && googleToken.expires > Date.now() + 60_000) return googleToken.value;
  const sa = JSON.parse(requireEnv('GOOGLE_PLAY_SERVICE_ACCOUNT')) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/androidpublisher' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(await importPKCS8(sa.private_key, 'RS256'));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`Google token failed: ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  googleToken = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

const playBase = () =>
  `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(requireEnv('GOOGLE_PLAY_PACKAGE_NAME'))}`;

async function play(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${playBase()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await googleAccessToken()}`, ...(init.headers ?? {}) },
  });
}

export async function getGooglePurchase(productId: string, token: string): Promise<GooglePurchase> {
  const res = await play(`/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`);
  if (res.status === 400 || res.status === 404 || res.status === 410) throw new HttpError(400, 'invalid_purchase');
  if (!res.ok) throw new Error(`Play purchase lookup failed: ${res.status}`);
  return (await res.json()) as GooglePurchase;
}

/** Marks a consumable used up so the buyer can buy it again. Unconsumed, unacknowledged Play
 * purchases are refunded by Google after 3 days, so this runs right after crediting. */
export async function consumeGooglePurchase(productId: string, token: string): Promise<void> {
  const res = await play(`/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:consume`, { method: 'POST' });
  if (!res.ok && res.status !== 400) throw new Error(`Play consume failed: ${res.status}`); // 400: already consumed
}

/** True when Google lists this order as voided (refunded or charged back) in the last 30 days. */
export async function isGoogleOrderVoided(orderId: string): Promise<boolean> {
  let pageToken: string | undefined;
  const start = Date.now() - 30 * 24 * 3600 * 1000;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ startTime: String(start), maxResults: '1000', type: '0' });
    if (pageToken) q.set('token', pageToken);
    const res = await play(`/purchases/voidedpurchases?${q}`);
    if (!res.ok) throw new Error(`Play voided purchases failed: ${res.status}`);
    const body = (await res.json()) as { voidedPurchases?: { orderId?: string }[]; tokenPagination?: { nextPageToken?: string } };
    if (body.voidedPurchases?.some((v) => v.orderId === orderId)) return true;
    pageToken = body.tokenPagination?.nextPageToken;
    if (!pageToken) return false;
  }
  return false;
}

// --- App Store Server API ----------------------------------------------------------------------

/** Short-lived token for the App Store Server API (key from App Store Connect → Users and Access → Integrations). */
async function appleToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ bid: requireEnv('APPLE_BUNDLE_ID') })
    .setProtectedHeader({ alg: 'ES256', kid: requireEnv('APPLE_IAP_KEY_ID'), typ: 'JWT' })
    .setIssuer(requireEnv('APPLE_IAP_ISSUER_ID'))
    .setAudience('appstoreconnect-v1')
    .setIssuedAt(now)
    .setExpirationTime(now + 20 * 60)
    .sign(await importPKCS8(requireEnv('APPLE_IAP_PRIVATE_KEY').replace(/\\n/g, '\n'), 'ES256'));
}

/** Transaction info straight from Apple (production first, then the sandbox for TestFlight). */
export async function getAppleTransaction(transactionId: string): Promise<AppleTransaction> {
  if (!/^\d{1,30}$/.test(transactionId)) throw new HttpError(400, 'invalid_purchase');
  const token = await appleToken();
  const hosts = ['https://api.storekit.itunes.apple.com', ...(allowTestPurchases() ? ['https://api.storekit-sandbox.itunes.apple.com'] : [])];
  for (const host of hosts) {
    const res = await fetch(`${host}/inApps/v1/transactions/${transactionId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`App Store lookup failed: ${res.status}`);
    const { signedTransactionInfo } = (await res.json()) as { signedTransactionInfo: string };
    return jwsPayload<AppleTransaction>(signedTransactionInfo);
  }
  throw new HttpError(400, 'invalid_purchase');
}
