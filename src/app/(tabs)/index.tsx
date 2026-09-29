import { useAuth } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import { RoomCard } from '@/components/RoomCard';
import { FeaturedHost } from '@/components/FeaturedHost';
import { FollowingLive, LiveBell } from '@/components/FollowingLive';
import { FadeIn, PressScale, stagger } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Chip, IconButton, Row, Screen, Text, TextTabs, Wordmark } from '@/components/ui';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';
import { CATEGORIES, categoryLabel, normalizeRooms, ROOM_SELECT, type Room } from '@/lib/types';

type Feed = 'following' | 'popular' | 'nearby' | 'new';
const FEEDS: { id: Feed; label: string }[] = [
  { id: 'following', label: 'Following' },
  { id: 'popular', label: 'Popular' },
  { id: 'nearby', label: 'Nearby' },
  { id: 'new', label: 'New' },
];
const CHIPS = ['all', ...CATEGORIES] as const;

type HomeData = { live: Room[]; followed: Set<string>; recommended: Map<string, { reason: string | null; score: number }> };

export default function HomeScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { profile } = useProfile();
  const { c, hPadding } = useTheme();
  const offline = useOffline();
  const { width } = useWindowDimensions();
  const [feed, setFeed] = useState<Feed>('popular');
  const [category, setCategory] = useState<(typeof CHIPS)[number]>('all');
  // 2 columns on every phone width (compact through xlarge) — only widens past that on tablet/web.
  const columns = width > 700 ? 4 : 2;
  const cardWidth = (Math.min(width, 1100) - hPadding * 2 - 10 * (columns - 1)) / columns;

  const { data, error, loading, reload } = useFocusedAsync<HomeData>(async () => {
    const [live, follows, recs] = await Promise.all([
      supabase.from('rooms').select(ROOM_SELECT).eq('status', 'live').order('viewer_count', { ascending: false }).limit(60),
      supabase.from('follows').select('followee_id').eq('follower_id', userId!),
      // Written by the Recommendations agent (LangGraph worker).
      supabase.from('user_recommendations').select('room_id,reason,score').eq('user_id', userId!).order('score', { ascending: false }).limit(10),
    ]);
    if (live.error) throw live.error;
    return {
      live: normalizeRooms(live.data),
      followed: new Set((follows.data ?? []).map((f) => f.followee_id)),
      recommended: new Map((recs.data ?? []).map((r) => [r.room_id, { reason: r.reason, score: r.score }])),
    };
  }, [userId]);

  // Rooms going live/offline update the feed in real time.
  useRealtime('rooms', undefined, (p) => {
    const before = (p.old as { status?: string }).status;
    const after = (p.new as { status?: string }).status;
    if (before !== after) reload();
  });

  const rooms = data ? pickFeed(data, feed, profile?.country ?? null).filter((r) => category === 'all' || r.category === category) : [];
  // Highest-viewed live room currently in a PK battle, if any — the Home screen's entry point into that fight.
  const battleRoom = data?.live.find((r) => r.current_battle_id) ?? null;
  const emptyCopy = {
    following: { title: 'No one you follow is live', body: 'Follow hosts you like and they will show up here.' },
    popular: { title: 'No one is live right now', body: 'Be the first — tap Go live.' },
    nearby: { title: 'No one nearby is live', body: profile?.country ? 'Try Popular to see everyone.' : 'Add your country in Edit profile to see hosts near you.' },
    new: { title: 'No new lives yet', body: 'Check back soon, or go live yourself.' },
  }[feed];

  const state = resolveState({
    offline, loading, error, data, onRetry: reload,
    isEmpty: () => rooms.length === 0,
    empty: category === 'all' ? emptyCopy : { title: `No ${categoryLabel(category)} lives`, body: 'Try another category.' },
  });

  return (
    <Screen>
      <View style={{ paddingHorizontal: hPadding, paddingTop: 4, gap: 4, maxWidth: 1100, width: '100%', alignSelf: 'center' }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Wordmark />
          <Row gap={8}>
            <IconButton icon="trophy-outline" label="Rankings" color={c.gold} onPress={() => router.push('/rankings')} />
            <IconButton icon="search" label="Search" onPress={() => router.push('/party')} />
            <LiveBell rooms={data ? data.live.filter((r) => data.followed.has(r.host_id)) : []} />
          </Row>
        </Row>
        <TextTabs options={FEEDS} value={feed} onChange={setFeed} />
      </View>
      {data && data.live.some((r) => data.followed.has(r.host_id)) && feed !== 'following' && (
        <FollowingLive rooms={data.live.filter((r) => data.followed.has(r.host_id))} />
      )}
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: hPadding, paddingVertical: 12 }}>
          {CHIPS.map((k) => <Chip key={k} label={k === 'all' ? 'All' : categoryLabel(k)} selected={category === k} onPress={() => setCategory(k)} />)}
        </ScrollView>
      </View>
      <StateView state={state}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: hPadding, paddingBottom: 32, maxWidth: 1100, width: '100%', alignSelf: 'center' }}
          refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={c.text} />}
        >
          {feed === 'popular' && category === 'all' && rooms[0] && (
            <FadeIn style={{ marginBottom: 10 }}>
              <FeaturedHost room={rooms[0]} following={data!.followed.has(rooms[0].host_id)} />
            </FadeIn>
          )}
          {feed === 'popular' && category === 'all' && battleRoom && (
            <FadeIn style={{ marginBottom: 10 }}>
              <PkBattleBanner room={battleRoom} />
            </FadeIn>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {rooms.map((r, i) => (
              <FadeIn key={`${feed}-${category}-${r.id}`} delay={stagger(i)} from={24}>
                <RoomCard
                  room={r}
                  width={cardWidth}
                  reason={feed === 'popular' ? data?.recommended.get(r.id)?.reason : null}
                  rank={feed === 'popular' && category === 'all' && i > 0 && i <= 3 ? i + 1 : undefined}
                />
              </FadeIn>
            ))}
          </View>
          {feed === 'popular' && rooms.length > 0 && <Text variant="caption" faint style={{ marginTop: 16, textAlign: 'center' }}>Picks for you come first.</Text>}
        </ScrollView>
      </StateView>
    </Screen>
  );
}

function PkBattleBanner({ room }: { room: Room }) {
  const { c, radius } = useTheme();
  return (
    <PressScale
      onPress={() => router.push({ pathname: '/live/[roomId]', params: { roomId: room.id } })}
      accessibilityRole="button"
      accessibilityLabel="Watch the live PK battle"
      scaleTo={0.98}
    >
      <Row style={{ padding: 16, borderRadius: radius[16] + 2, backgroundColor: c.surface, borderWidth: 1, borderColor: c.divider }}>
        <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.display, fontSize: 20, color: c.onGold }}>PK</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="h3">PK Battle Night</Text>
          <Text variant="bodySmall" muted>Hosts go head-to-head — gifts decide the winner</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={c.textFaint} />
      </Row>
    </PressScale>
  );
}

function pickFeed(data: HomeData, feed: Feed, country: string | null): Room[] {
  switch (feed) {
    case 'following':
      return data.live.filter((r) => data.followed.has(r.host_id));
    case 'nearby':
      return country ? data.live.filter((r) => r.host?.country === country) : [];
    case 'new':
      return [...data.live].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
    default: {
      // Recommended rooms (AI) first, then by viewers.
      const rec = (r: Room) => data.recommended.get(r.id)?.score ?? -1;
      return [...data.live].sort((a, b) => rec(b) - rec(a) || b.viewer_count - a.viewer_count);
    }
  }
}
