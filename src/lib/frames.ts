import { useAsync } from './hooks';
import { useSupabase } from './supabase';

/** A profile frame for sale (frame_catalog). Prices come from the server, never from the app. */
export type Frame = {
  id: string;
  name: string;
  style: { colors: string[]; glow: string; icon: string | null };
  coin_price: number;
  /** null = permanent; otherwise each purchase adds this many days. */
  duration_days: number | null;
};

/** The frame catalog, cached app-wide (it rarely changes). */
export function useFrameCatalog(enabled = true) {
  const supabase = useSupabase();
  return useAsync(async () => {
    if (!enabled) return [] as Frame[];
    const { data, error } = await supabase.from('frame_catalog').select('id,name,style,coin_price,duration_days').eq('active', true).order('sort');
    if (error) throw error;
    return data as Frame[];
  }, [enabled], enabled ? 'frame-catalog' : undefined);
}

/** "30 days" / "Forever". */
export function frameDuration(f: Pick<Frame, 'duration_days'>): string {
  return f.duration_days == null ? 'Forever' : `${f.duration_days} days`;
}
