// API-backed equivalent of the Home feed's Supabase queries in
// src/app/(tabs)/index.tsx — see docs/MIGRATION_PLAN.md, Phase 8.
// Additive: no screen calls this yet. Normalizes apps/api's camelCase
// response into the existing `Room` type (src/lib/types.ts) so downstream
// components (RoomCard, FeaturedHost, ...) need zero changes at cutover —
// same trick normalizeRoom() already does for Supabase's raw shape.
import { apiFetch } from './api-client';
import type { AppRole, Room } from './types';

type ApiHostUser = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  country: string | null;
  role: string;
};
type ApiRoom = {
  id: string;
  hostId: string;
  title: string;
  category: string;
  coverUrl: string | null;
  status: 'offline' | 'live';
  viewerCount: number;
  currentStreamId: string | null;
  currentBattleId: string | null;
  updatedAt: string;
  host: { userId: string; hostCode: string; user: ApiHostUser };
};

// Known gap, not fabricated: apps/api's User model has no verified_at
// (host-verification badge — see api-profile.tsx's own gap note), so
// `host.verified_at` is always null here until that's built.
function normalizeApiRoom(raw: ApiRoom): Room {
  return {
    id: raw.id,
    host_id: raw.hostId,
    title: raw.title,
    category: raw.category,
    cover_url: raw.coverUrl,
    status: raw.status,
    updated_at: raw.updatedAt,
    viewer_count: raw.viewerCount,
    current_stream_id: raw.currentStreamId,
    current_battle_id: raw.currentBattleId,
    host: {
      id: raw.host.user.id,
      display_name: raw.host.user.displayName,
      username: raw.host.user.username,
      avatar_url: raw.host.user.avatarUrl,
      country: raw.host.user.country,
      verified_at: null,
      role: raw.host.user.role as AppRole,
    },
  };
}

export type ApiHomeData = {
  live: Room[];
  followed: Set<string>;
  recommended: Map<string, { reason: string | null; score: number }>;
};

/** Compatible with useFocusedAsync<ApiHomeData>(fetchApiHomeFeed, [...]). */
export async function fetchApiHomeFeed(): Promise<ApiHomeData> {
  const [liveRooms, following, recommendations] = await Promise.all([
    apiFetch<ApiRoom[]>('/streams/live'),
    apiFetch<string[]>('/users/me/following'),
    apiFetch<{ roomId: string; reason: string | null; score: number }[]>('/recommendations/me'),
  ]);
  return {
    live: liveRooms.map(normalizeApiRoom),
    followed: new Set(following),
    recommended: new Map(recommendations.map((r) => [r.roomId, { reason: r.reason, score: r.score }])),
  };
}
