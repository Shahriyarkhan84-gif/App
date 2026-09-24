import type { SupabaseClient } from '@supabase/supabase-js';

import type { Video } from './types';

/**
 * Thin wrappers around Supabase Edge Functions (supabase/functions/*).
 * The Supabase client attaches the Clerk session token automatically.
 */
async function invoke<T>(supabase: SupabaseClient, name: string, body?: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body ?? {} });
  if (error) throw error;
  return data as T;
}

/** Pinecone semantic search, falling back to a Postgres keyword search. */
export async function searchVideos(supabase: SupabaseClient, query: string) {
  try {
    const { videos } = await invoke<{ videos: Video[] }>(supabase, 'search', { query });
    return { videos, source: 'semantic' as const };
  } catch {
    const pattern = `%${query.replace(/[%_,()]/g, ' ')}%`;
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .or(`title.ilike.${pattern},description.ilike.${pattern}`)
      .limit(30);
    if (error) throw error;
    return { videos: (data ?? []) as Video[], source: 'keyword' as const };
  }
}

/** "Because you watched" recommendations powered by Pinecone. */
export async function getRecommendations(supabase: SupabaseClient) {
  return invoke<{ basedOn: Pick<Video, 'id' | 'title'> | null; videos: Video[] }>(
    supabase,
    'recommendations',
  );
}

/** Trending titles, ranked by view counts kept in Upstash Redis. */
export async function getTrending(supabase: SupabaseClient) {
  const { videos } = await invoke<{ videos: Video[] }>(supabase, 'trending');
  return videos;
}

/** Records a view in Upstash (deduped per user/video server-side). Fire-and-forget. */
export function trackView(supabase: SupabaseClient, videoId: string) {
  invoke(supabase, 'track-view', { videoId }).catch(() => {});
}

/** Creates a Stripe Checkout session and returns its hosted URL. */
export async function createCheckoutSession(supabase: SupabaseClient, plan: 'monthly' | 'yearly', returnTo?: string) {
  return invoke<{ url: string }>(supabase, 'create-checkout-session', { plan, returnTo });
}

/** Opens the Stripe billing portal so subscribers can manage/cancel. */
export async function createPortalSession(supabase: SupabaseClient, returnTo?: string) {
  return invoke<{ url: string }>(supabase, 'create-portal-session', { returnTo });
}
