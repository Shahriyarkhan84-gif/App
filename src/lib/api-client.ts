// Client for the new NestJS backend (apps/api) — see docs/MIGRATION_PLAN.md,
// Phase 8. Additive and unused by any screen yet: screens move off
// useSupabase()/Clerk onto this one at a time, not in one cutover.
import * as SecureStore from 'expo-secure-store';

import { env } from './env';

const ACCESS_TOKEN_KEY = 'zynalive_access_token';
const REFRESH_TOKEN_KEY = 'zynalive_refresh_token';

export type TokenPair = { accessToken: string; refreshToken: string };

export async function getStoredTokens(): Promise<TokenPair | null> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

export async function storeTokens(tokens: TokenPair): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY), SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)]);
}

/** Thrown message matches the API's error codes, same as Supabase RPC errors — friendlyError() already maps them. */
class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

let refreshInFlight: Promise<TokenPair> | null = null;

async function refresh(refreshToken: string): Promise<TokenPair> {
  const res = await fetch(`${env.apiUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) throw new ApiClientError('not_authenticated', res.status);
  const tokens = (await res.json()) as TokenPair;
  await storeTokens(tokens);
  return tokens;
}

/**
 * Authenticated fetch against apps/api. Retries once on a 401 by refreshing
 * the access token — mirrors the retry that @supabase/supabase-js does
 * internally, since nothing else in the app expects a 401 to be fatal.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let tokens = await getStoredTokens();

  const doFetch = async (accessToken: string | undefined) =>
    fetch(`${env.apiUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init?.headers,
      },
    });

  let res = await doFetch(tokens?.accessToken);

  if (res.status === 401 && tokens?.refreshToken) {
    refreshInFlight ??= refresh(tokens.refreshToken).finally(() => {
      refreshInFlight = null;
    });
    try {
      tokens = await refreshInFlight;
      res = await doFetch(tokens.accessToken);
    } catch {
      await clearTokens();
      throw new ApiClientError('not_authenticated', 401);
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiClientError(body?.message ?? 'unknown', res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
