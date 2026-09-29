import type { SupabaseClient } from '@supabase/supabase-js';

// Regional variants + engagement events (see docs/ARCHITECTURE.md → Engagement & regions).

export type Region = {
  code: string;
  name: string;
  currency: string;
  default_language: string;
  languages: string[];
  timezone: string;
  features: Record<string, boolean>;
};

export type EventReward = { role: 'host' | 'gifter'; rank_from: number; rank_to: number; reward: string };

export type AppEvent = {
  id: string;
  title: string;
  description: string | null;
  kind: 'gifting' | 'pk_battle';
  region: string | null;
  starts_at: string;
  ends_at: string;
  gift_ids: number[] | null;
  rewards: EventReward[];
  status: 'draft' | 'scheduled' | 'cancelled' | 'finalized';
};

export type LeaderRow = { rank: number; user_id: string; display_name: string | null; username: string | null; avatar_url: string | null; score: number; reward: string | null };

export const EVENT_SELECT = 'id,title,description,kind,region,starts_at,ends_at,gift_ids,rewards,status';

export type EventPhase = 'upcoming' | 'live' | 'ended';

export function eventPhase(e: Pick<AppEvent, 'starts_at' | 'ends_at' | 'status'>, now = Date.now()): EventPhase {
  if (e.status === 'finalized' || new Date(e.ends_at).getTime() <= now) return 'ended';
  return new Date(e.starts_at).getTime() > now ? 'upcoming' : 'live';
}

/** "2d 4h" / "3h 12m" / "8m" until a time. */
export function timeLeft(to: string, now = Date.now()): string {
  const ms = Math.max(0, new Date(to).getTime() - now);
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${Math.max(1, m)}m`;
}

export async function fetchMyRegion(supabase: SupabaseClient): Promise<Region | null> {
  const { data, error } = await supabase.rpc('my_region');
  if (error) throw error;
  return (data as Region | null)?.code ? (data as Region) : null;
}

/** Published events for the caller's region (plus global ones). */
export async function fetchEvents(supabase: SupabaseClient, region: string | null): Promise<AppEvent[]> {
  let q = supabase.from('events').select(EVENT_SELECT).in('status', ['scheduled', 'finalized']).order('ends_at', { ascending: false }).limit(50);
  q = region ? q.or(`region.is.null,region.eq.${region}`) : q.is('region', null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AppEvent[];
}

export const scoreLabel = (kind: AppEvent['kind']) => (kind === 'pk_battle' ? 'pts' : 'coins');
