import type { SupabaseClient } from '@supabase/supabase-js';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { randomUUID } from 'expo-crypto';

type ErrorBody = { error?: { code?: string; message?: string } };

/** Calls a Supabase Edge Function and surfaces its `{ error: { code } }` shape as Error(code). */
export async function invokeFn<T>(supabase: SupabaseClient, name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = (await error.context.json().catch(() => ({}))) as ErrorBody;
      throw new Error(payload.error?.code ?? 'unknown');
    }
    throw error;
  }
  return data as T;
}

/** Calls a Postgres RPC; throws Error(<exception code>) on failure. */
export async function rpc<T = unknown>(supabase: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export function getLiveKitToken(supabase: SupabaseClient, roomId: string, as: 'viewer' | 'host') {
  return invokeFn<{ token: string; url: string }>(supabase, 'livekit-token', { roomId, as });
}

export function startCoinCheckout(supabase: SupabaseClient, packageId: number, returnTo: string) {
  return invokeFn<{ url: string }>(supabase, 'coins-checkout', { packageId, returnTo });
}

/** Starts Didit identity verification for the signed-in host; returns the hosted URL. */
export function startHostVerification(supabase: SupabaseClient, returnTo: string, language?: string) {
  return invokeFn<{ url: string }>(supabase, 'didit-session', { returnTo, language });
}

/** Random idempotency key for money-moving requests (gifts). */
export function idempotencyKey() {
  return randomUUID();
}
