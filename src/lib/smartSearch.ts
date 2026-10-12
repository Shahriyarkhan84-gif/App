import type { SupabaseClient } from '@supabase/supabase-js';

import { smartSearch } from './api';
import { normalizeRooms, ROOM_SELECT, type Room } from './types';

/** Live rooms for these ids, in the given (ranked) order; rooms that ended since are dropped. */
export async function liveRoomsByIds(supabase: SupabaseClient, ids: string[]): Promise<Room[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('rooms').select(ROOM_SELECT).in('id', ids).eq('status', 'live');
  if (error) throw error;
  const byId = new Map(normalizeRooms(data).map((r) => [r.id, r]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/**
 * Lives like `seed` (by meaning, via Pinecone). Without smart search (not set up yet, or it failed)
 * falls back to the most-watched lives in the same category, so the row is never broken.
 */
export async function similarLives(supabase: SupabaseClient, seed: { roomId: string; title: string; category: string }, limit = 8): Promise<Room[]> {
  try {
    const { results } = await smartSearch(supabase, { q: `${seed.title} ${seed.category}`.trim(), limit: limit + 1 });
    const rooms = await liveRoomsByIds(supabase, results.map((r) => r.id).filter((id) => id !== seed.roomId));
    if (rooms.length > 0) return rooms.slice(0, limit);
  } catch {
    // fall through to the category fallback
  }
  const { data, error } = await supabase.from('rooms').select(ROOM_SELECT).eq('status', 'live').eq('category', seed.category)
    .neq('id', seed.roomId).order('viewer_count', { ascending: false }).limit(limit);
  if (error) throw error;
  return normalizeRooms(data);
}
