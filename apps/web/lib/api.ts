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
  try {
    const res = await fetch(`${API_URL}/streams/live`, { next: { revalidate: 10 } });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    // API unreachable (build-time prerender with no backend running, or a
    // transient outage) — degrade to an empty feed instead of a 500 page.
    return [];
  }
}
