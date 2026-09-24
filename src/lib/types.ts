export type AppRole = 'USER' | 'HOST' | 'AGENCY_MEMBER' | 'AGENCY_ADMIN' | 'OWNER_ADMIN' | 'SUPER_ADMIN';

export type Profile = {
  id: string;
  /** Public 8-digit ID, assigned by the database at sign-up. */
  user_number: number;
  /** Set by the database when the user passes host verification (Host badge). */
  verified_at: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  country: string | null;
  language: string;
  role: AppRole;
  status: 'active' | 'restricted' | 'banned';
  status_until: string | null;
};

export type Room = {
  id: string;
  host_id: string;
  title: string;
  category: string;
  cover_url: string | null;
  status: 'offline' | 'live';
  updated_at?: string;
  viewer_count: number;
  current_stream_id: string | null;
  host?: Pick<Profile, 'id' | 'display_name' | 'username' | 'avatar_url' | 'country' | 'verified_at' | 'role'> | null;
};

export type ChatMessage = {
  id: number;
  room_id: string;
  sender_id: string;
  body: string;
  status: 'visible' | 'hidden';
  created_at: string;
  sender?: Pick<Profile, 'display_name' | 'username' | 'avatar_url'> | null;
};

export type GiftItem = { id: number; name: string; icon: string; coin_price: number };

export type CoinPackage = { id: number; name: string; coins: number; price_minor: number; currency: string };

// rooms.host_id -> hosts.user_id -> profiles.id
export const ROOM_SELECT =
  'id,host_id,title,category,cover_url,status,viewer_count,current_stream_id,updated_at,hostRow:hosts(profile:profiles(id,display_name,username,avatar_url,country,verified_at,role))';

type RawRoom = Omit<Room, 'host'> & { hostRow?: { profile: Room['host'] } | null };

export function normalizeRoom(raw: RawRoom): Room {
  const { hostRow, ...room } = raw;
  return { ...room, host: hostRow?.profile ?? null };
}

export function normalizeRooms(raw: unknown): Room[] {
  return ((raw ?? []) as RawRoom[]).map(normalizeRoom);
}

export function displayName(p?: { display_name?: string | null; username?: string | null } | null) {
  return p?.display_name || (p?.username ? `@${p.username}` : 'Zynalive user');
}

export function formatMoney(minor: number, currency: string) {
  return `${currency.toUpperCase() === 'PKR' ? 'Rs' : currency.toUpperCase()} ${(minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export const CATEGORIES = ['chat', 'music', 'gaming', 'talent', 'education', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
export const categoryLabel = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);
