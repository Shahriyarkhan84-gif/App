import { useAuth } from '@clerk/clerk-expo';
import { FlatList, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';

import { RoomCard } from '@/components/RoomCard';
import { resolveState, StateView } from '@/components/StateView';
import { Screen, Text } from '@/components/ui';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { normalizeRooms, ROOM_SELECT, type Room } from '@/lib/types';

type HomeData = { recommended: (Room & { reason: string | null })[]; following: Room[]; live: Room[] };

export default function HomeScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const offline = useOffline();
  const { width } = useWindowDimensions();
  const columns = width > 700 ? 4 : 2;
  const cardWidth = (Math.min(width, 1100) - 16 * 2 - 12 * (columns - 1)) / columns;

  const { data, error, loading, reload } = useFocusedAsync<HomeData>(async () => {
    const [live, follows, recs] = await Promise.all([
      supabase.from('rooms').select(ROOM_SELECT).eq('status', 'live').order('viewer_count', { ascending: false }).limit(60),
      supabase.from('follows').select('followee_id').eq('follower_id', userId!),
      // Written by the Recommendations agent (LangGraph worker).
      supabase.from('user_recommendations').select('room_id,reason,score').eq('user_id', userId!).order('score', { ascending: false }).limit(10),
    ]);
    if (live.error) throw live.error;
    const rooms = normalizeRooms(live.data);
    const followed = new Set((follows.data ?? []).map((f) => f.followee_id));
    const byId = new Map(rooms.map((r) => [r.id, r]));
    const recommended = (recs.data ?? []).flatMap((r) => (byId.has(r.room_id) ? [{ ...byId.get(r.room_id)!, reason: r.reason }] : []));
    return { live: rooms, following: rooms.filter((r) => followed.has(r.host_id)), recommended };
  }, [userId]);

  // Rooms going live/offline update the feed in real time.
  useRealtime('rooms', undefined, (p) => {
    const before = (p.old as { status?: string }).status;
    const after = (p.new as { status?: string }).status;
    if (before !== after) reload();
  });

  const state = resolveState({
    offline, loading, error, data, onRetry: reload,
    isEmpty: (d) => d.live.length === 0,
    empty: { title: 'No one is live right now', body: 'Be the first — tap Create to go live.' },
  });

  return (
    <Screen>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text variant="h1" color={c.primary}>Zynalive</Text>
      </View>
      <StateView state={state}>
        {data && (
          <ScrollView
            contentContainerStyle={{ paddingBottom: 32, gap: 24, maxWidth: 1100, width: '100%', alignSelf: 'center' }}
            refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={c.text} />}
          >
            {data.recommended.length > 0 && (
              <Section title="For you">
                <FlatList
                  horizontal
                  data={data.recommended}
                  keyExtractor={(r) => r.id}
                  contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
                  showsHorizontalScrollIndicator={false}
                  renderItem={({ item }) => <RoomCard room={item} width={150} reason={item.reason} />}
                />
              </Section>
            )}
            {data.following.length > 0 && (
              <Section title="Following">
                <FlatList
                  horizontal
                  data={data.following}
                  keyExtractor={(r) => r.id}
                  contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
                  showsHorizontalScrollIndicator={false}
                  renderItem={({ item }) => <RoomCard room={item} width={150} />}
                />
              </Section>
            )}
            <Section title="Live now">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16 }}>
                {data.live.map((r) => (
                  <RoomCard key={r.id} room={r} width={cardWidth} />
                ))}
              </View>
            </Section>
          </ScrollView>
        )}
      </StateView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <Text variant="h3" style={{ paddingHorizontal: 16 }}>{title}</Text>
      {children}
    </View>
  );
}
