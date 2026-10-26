import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Whether a person chose Settings → Privacy → Hide my location. Read on its own (not in the
 * screen's main query) and treated as "no" on any error, so profiles keep loading even where the
 * privacy columns don't exist yet.
 */
export async function hidesLocation(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('profiles').select('hide_location').eq('id', userId).maybeSingle();
  return !error && !!(data as { hide_location?: boolean } | null)?.hide_location;
}
