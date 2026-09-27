// Pure wrappers around apps/api's /auth/* endpoints — see
// docs/MIGRATION_PLAN.md, Phase 8 step 2. Additive: nothing calls these yet.
// Not a replacement for @clerk/clerk-expo in this commit — see zyna-auth.tsx
// for why the actual cutover has to happen with useSupabase() at the same time.
import { apiFetch, clearTokens, storeTokens, type TokenPair } from './api-client';

export type LoginResult = TokenPair | { twoFactorRequired: true; challenge: string };

export function register(email: string, password: string, displayName: string): Promise<TokenPair> {
  return apiFetch<TokenPair>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, displayName }) });
}

export function login(email: string, password: string): Promise<LoginResult> {
  return apiFetch<LoginResult>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function verifyLoginTwoFactor(challenge: string, code: string): Promise<TokenPair> {
  return apiFetch<TokenPair>('/auth/2fa/verify-login', { method: 'POST', body: JSON.stringify({ challenge, code }) });
}

export function requestOtp(phone: string): Promise<{ ok: true }> {
  return apiFetch('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone }) });
}

export function verifyOtp(phone: string, code: string): Promise<TokenPair> {
  return apiFetch<TokenPair>('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone, code }) });
}

export function loginWithGoogle(idToken: string): Promise<TokenPair> {
  return apiFetch<TokenPair>('/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) });
}

export function loginWithApple(identityToken: string, displayName?: string): Promise<TokenPair> {
  return apiFetch<TokenPair>('/auth/apple', { method: 'POST', body: JSON.stringify({ identityToken, displayName }) });
}

export async function logout(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined); // best-effort server-side revoke
  await clearTokens();
}

/** Called after a successful login()/register()/verify* — persists the pair for apiFetch(). */
export function persistSession(tokens: TokenPair): Promise<void> {
  return storeTokens(tokens);
}
