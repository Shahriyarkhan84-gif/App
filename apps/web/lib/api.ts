const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type LiveRoom = {
  id: string;
  title: string;
  category: string;
  coverUrl: string | null;
  viewerCount: number;
  host: { user: { displayName: string | null; username: string | null } };
};

export async function fetchLiveRooms(): Promise<LiveRoom[]> {
  const res = await fetch(`${API_URL}/streams/live`, { next: { revalidate: 10 } });
  if (!res.ok) return [];
  return res.json();
}
