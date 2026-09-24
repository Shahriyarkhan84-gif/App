import { Ratelimit } from 'npm:@upstash/ratelimit@2';
import { Redis } from 'npm:@upstash/redis@1';

import { HttpError } from './cors.ts';

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

/** Sliding-window rate limit per user + action. No-op without Upstash. */
export async function rateLimit(action: string, userId: string, limit: number, window: `${number} ${'s' | 'm' | 'h'}`) {
  const r = getRedis();
  if (!r) return;
  const key = `${action}:${limit}:${window}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new Ratelimit({ redis: r, limiter: Ratelimit.slidingWindow(limit, window), prefix: `rl:${action}` });
    limiters.set(key, limiter);
  }
  const { success } = await limiter.limit(userId);
  if (!success) throw new HttpError(429, 'Too many requests, slow down');
}

export const TRENDING_KEY = 'trending:views';
