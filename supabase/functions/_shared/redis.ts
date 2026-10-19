import { Ratelimit } from 'npm:@upstash/ratelimit@2';
import { Redis } from 'npm:@upstash/redis@1';

import { HttpError } from './cors.ts';
import { adminClient } from './supabase.ts';

let redis: Redis | null | undefined;

/** Upstash Redis over REST, or null when UPSTASH_* env vars aren't set. */
export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = Deno.env.get('UPSTASH_REDIS_REST_URL');
  const token = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

const limiters = new Map<string, Ratelimit>();

type Window = `${number} ${'s' | 'm' | 'h'}`;

/** "5 m" -> 300 */
export function windowSeconds(window: Window): number {
  const [n, unit] = window.split(' ');
  return Number(n) * (unit === 'h' ? 3600 : unit === 'm' ? 60 : 1);
}

/**
 * Sliding-window rate limit per user + action (Upstash). Without Upstash it falls back to a
 * fixed-window counter in Postgres (`internal_rate_limit`), so limits never silently switch off.
 */
export async function rateLimit(action: string, userId: string, limit: number, window: Window) {
  const r = getRedis();
  if (!r) {
    const { data, error } = await adminClient().rpc('internal_rate_limit', {
      p_key: `${action}:${userId}`, p_limit: limit, p_window_seconds: windowSeconds(window),
    });
    // If the counter itself fails (e.g. before its migration is applied), don't block real users.
    if (error) console.error('rate limit fallback failed', error.message);
    else if (data === false) throw new HttpError(429, 'rate_limited', 'Too many requests, slow down');
    return;
  }
  const key = `${action}:${limit}:${window}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new Ratelimit({ redis: r, limiter: Ratelimit.slidingWindow(limit, window), prefix: `rl:${action}` });
    limiters.set(key, limiter);
  }
  const { success } = await limiter.limit(userId);
  if (!success) throw new HttpError(429, 'rate_limited', 'Too many requests, slow down');
}
