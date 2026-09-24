import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { VIDEO_COLUMNS } from './supabase.ts';

/** Loads videos by id, preserving the given order (e.g. relevance or rank). */
export async function videosByIds(db: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await db.from('videos').select(VIDEO_COLUMNS).in('id', ids);
  if (error) throw error;
  const byId = new Map((data ?? []).map((v) => [v.id as string, v]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
