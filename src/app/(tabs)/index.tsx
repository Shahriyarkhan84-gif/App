import { useAuth } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import { LiveEventBanner } from '@/components/EventRow';
import { RoomCard } from '@/components/RoomCard';
import { FeaturedHost } from '@/components/FeaturedHost';
import { LiveBell, LoopStrip } from '@/components/FollowingLive';
import { PinnedProfiles } from '@/components/PinnedProfiles';
import { type MenuItem, SideMenuButton, useTabBarSpace } from '@/components/Menus';
import { FadeIn, PressScale, stagger } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Chip, IconButton, Row, Screen, Text, TextTabs, Wordmark } from '@/components/ui';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';
import { CATEGORIES, categoryLabel, displayName, normalizeRooms, ROOM_SELECT, type Room, roomHref } from '@/lib/types';

/** Live rooms fetched for Home; Popular, Following, Nearby and New are all cut from this list. */
const LIVE_LIMIT = 200;

type Feed = 'following' | 'popular' | 'nearby' | 'new';
const FEEDS: { id: Feed; label: string }[] = [
  { id: 'following', label: 'Following' },
  { id: 'popular', label: 'Popular' },
  { id: 'nearby', label: 'Nearby' },
  { id: 'new', label: 'New' },
];
const CHIPS = ['all', ...CATEGORIES] as const;

// live: top 60 by viewers (Popular). Following and New load their own lists, so smaller and newer
// rooms still show once more than 60 rooms are live.
type HomeData = { all: Room[]; live: Room[]; followingLive: Room[]; newest: Room[]; followed: Set<string>; recommended: Map<string, { reason: string | null; score: number }> };

export default function HomeScreen() {
  const tabSpace = useTabBarSpace();
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { profile } = useProfile();
  const { c, hPadding } = useTheme();
  const offline = useOffline();
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const [feed, setFeed] = useState<Feed>('popular');
  const [category, setCategory] = useState<(typeof CHIPS)[number]>('all');
  // 2 columns on every phone width (compact through xlarge) — only widens past that on tablet/web.
  const columns = width > 700 ? 4 : 2;
  const cardWidth = (Math.min(width, 1100) - hPadding * 2 - 10 * (columns - 1)) / columns;

  const { data, error, loading, reload } = useFocusedAsync<HomeData>(async () => {
    // One round trip: the server is far away (us-east-1), so every sequential request adds ~0.5 s.
    // Popular, Following and New are all cut from the same list of live rooms.
    const [live, follows, recs] = await Promise.all([
      supabase.from('rooms').select(ROOM_SELECT).eq('status', 'live').order('viewer_count', { ascending: false }).limit(LIVE_LIMIT),
      supabase.from('follows').select('followee_id').eq('follower_id', userId!),
      // Written by the Recommendations agent (LangGraph worker).
      supabase.from('user_recommendations').select('room_id,reason,score').eq('user_id', userId!).order('score', { ascending: false }).limit(10),
    ]);
    if (live.error) throw live.error;
    if (follows.error) throw follows.error;
    const all = normalizeRooms(live.data);
    const followedIds = new Set((follows.data ?? []).map((f) => f.followee_id));
    return {
      all,
      live: all.slice(0, 60),
      followingLive: all.filter((r) => followedIds.has(r.host_id)).slice(0, 60),
      newest: [...all].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')).slice(0, 60),
      followed: followedIds,
      recommended: new Map((recs.data ?? []).map((r) => [r.room_id, { reason: r.reason, score: r.score }])),
    };
  }, [userId], `home:${userId}`);

  // Rooms going live/offline update the feed in real time.
  // `rooms` has no full replica identity, so p.old is empty: compare with what the feed shows instead.
  // Viewer-count updates (many per second) must not refetch the feed.
  const liveIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    liveIds.current = new Set((data?.all ?? []).map((r) => r.id));
  }, [data]);
  // Viewer joins/leaves update `rooms` constantly with status still 'live'. Refetch only when a room
  // we show goes offline, or a room we don't show goes live while the list isn't full (LIVE_LIMIT) —
  // debounced, and never before the first load.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  useRealtime('rooms', undefined, (p) => {
    const next = p.new as { id?: string; status?: string };
    if (!next.id || !data) return;
    const shown = liveIds.current.has(next.id);
    const live = next.status === 'live';
    const changed = shown ? !live : live && liveIds.current.size < LIVE_LIMIT;
    if (!changed || pending.current) return;
    pending.current = setTimeout(() => { pending.current = null; reload(); }, 1500);
  });

  const rooms = data ? pickFeed(data, feed, profile?.country ?? null).filter((r) => category === 'all' || r.category === category) : [];
  // Featured and TOP 2–4 follow real viewer order (data.live is sorted by viewers), not AI picks.
  const topRoom = data?.live[0] ?? null;
  const topRank = (id: string) => {
    const i = data ? data.live.findIndex((r) => r.id === id) : -1;
    return i >= 1 && i <= 3 ? i + 1 : undefined;
  };
  // Highest-viewed live room currently in a PK battle, if any — the Home screen's entry point into that fight.
  const battleRoom = data?.live.find((r) => r.current_battle_id) ?? null;
  const emptyCopy = {
    following: { title: 'No one you follow is live', body: 'Follow hosts you like and they will show up here.' },
    popular: { title: 'No one is live right now', body: 'Be the first — tap Go live.' },
    nearby: { title: 'No one nearby is live', body: profile?.country ? 'Try Popular to see everyone.' : 'Add your country in Edit profile to see hosts near you.' },
    new: { title: 'No new lives yet', body: 'Check back soon, or go live yourself.' },
  }[feed];

  // Empty feeds stay inside the page (below the Loop strip and banners) rather than replacing it.
  const emptyState: { title: string; body?: string } = category === 'all' ? emptyCopy : { title: `No ${categoryLabel(category)} lives`, body: 'Try another category.' };
  const state = resolveState({ offline, loading, error, data, onRetry: reload });

  const sideMenu: MenuItem[] = [
    { key: 'videos', icon: 'play-circle-outline', label: t('menu.videos'), onPress: () => router.push('/videos') },
    { key: 'events', icon: 'calendar-outline', label: t('menu.events'), onPress: () => router.push('/events') },
    { key: 'rankings', icon: 'trophy-outline', label: t('menu.rankings'), onPress: () => router.push('/rankings') },
    { key: 'wallet', icon: 'wallet-outline', label: t('menu.wallet'), onPress: () => router.push('/wallet') },
    { key: 'settings', icon: 'settings-outline', label: t('settings.title'), onPress: () => router.push('/settings') },
    { key: 'support', icon: 'help-circle-outline', label: t('menu.support'), onPress: () => router.push('/support') },
  ];

  return (
    <Screen>
      <View style={{ paddingHorizontal: hPadding, paddingTop: 4, gap: 4, maxWidth: 1100, width: '100%', alignSelf: 'center' }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={10}>
            <SideMenuButton items={sideMenu} header={<Wordmark />} />
            <Wordmark />
          </Row>
          <Row gap={8}>
            <IconButton icon="wallet-outline" label="Wallet" color={c.gold} onPress={() => router.push('/wallet')} />
            <IconButton icon="search" label="Search" onPress={() => router.push('/party')} />
            <LiveBell rooms={data ? data.followingLive : []} />
          </Row>
        </Row>
        <TextTabs options={FEEDS} value={feed} onChange={setFeed} />
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: hPadding, paddingVertical: 12 }}>
          {CHIPS.map((k) => <Chip key={k} label={k === 'all' ? 'All' : categoryLabel(k)} selected={category === k} onPress={() => setCategory(k)} />)}
        </ScrollView>
      </View>
      <StateView state={state}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: hPadding, paddingBottom: tabSpace + 32, gap: 12, maxWidth: 1100, width: '100%', alignSelf: 'center' }}
          refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={c.text} />}
        >
          <LoopStrip
            me={{ avatar_url: profile?.avatar_url, name: displayName(profile) }}
            rooms={data ? data.followingLive : []}
          />
          <PinnedProfiles refreshKey={data} />
          {feed === 'popular' && category === 'all' && topRoom && (
            <FadeIn>
              <FeaturedHost key={`${topRoom.host_id}-${data!.followed.has(topRoom.host_id)}`} room={topRoom} following={data!.followed.has(topRoom.host_id)} />
            </FadeIn>
          )}
          {feed === 'popular' && category === 'all' && (
            <FadeIn>
              <LiveEventBanner />
            </FadeIn>
          )}
          {feed === 'popular' && category === 'all' && (
            <FadeIn>
              <PkBattleBanner room={battleRoom} />
            </FadeIn>
          )}
          {rooms.length === 0 ? (
            <View style={{ paddingVertical: 32, paddingHorizontal: 16, alignItems: 'center', gap: 6, borderRadius: 18, backgroundColor: c.surface }}>
              <Ionicons name="videocam-outline" size={28} color={c.textFaint} />
              <Text variant="label" style={{ textAlign: 'center' }}>{emptyState.title}</Text>
              {emptyState.body && <Text variant="bodySmall" muted style={{ textAlign: 'center' }}>{emptyState.body}</Text>}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {rooms.map((r, i) => (
                <FadeIn key={`${feed}-${category}-${r.id}`} delay={stagger(i, 30, 150)} duration={250} from={12}>
                  <RoomCard
                    room={r}
                    width={cardWidth}
                    reason={feed === 'popular' ? data?.recommended.get(r.id)?.reason : null}
                    rank={feed === 'popular' && category === 'all' ? topRank(r.id) : undefined}
                  />
                </FadeIn>
              ))}
            </View>
          )}
          {feed === 'popular' && rooms.length > 0 && <Text variant="caption" faint style={{ textAlign: 'center' }}>Picks for you come first.</Text>}
        </ScrollView>
      </StateView>
    </Screen>
  );
}

/** Always shown on Popular: opens the live battle when there is one, otherwise the rankings. */
function PkBattleBanner({ room }: { room: Room | null }) {
  const { c, radius } = useTheme();
  return (
    <PressScale
      onPress={() => (room ? router.push(roomHref(room)) : router.push('/rankings'))}
      accessibilityRole="button"
      accessibilityLabel={room ? 'Watch the live PK battle' : 'PK Battle Night. See the top hosts'}
      scaleTo={0.98}
    >
      <Row style={{ padding: 16, borderRadius: radius[16] + 2, backgroundColor: c.surface, borderWidth: 1, borderColor: c.divider }}>
        <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.display, fontSize: 20, color: c.onGold }}>PK</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="h3">PK Battle Night</Text>
          <Text variant="bodySmall" muted>{room ? 'Live now — gifts decide the winner' : 'Hosts go head-to-head — gifts decide the winner'}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={c.textFaint} />
      </Row>
    </PressScale>
  );
}

function pickFeed(data: HomeData, feed: Feed, country: string | null): Room[] {
  switch (feed) {
    case 'following':
      return data.followingLive;
    case 'nearby': {
      if (!country) return [];
      const seen = new Set<string>();
      return [...data.live, ...data.newest].filter((r) => r.host?.country === country && !seen.has(r.id) && !!seen.add(r.id));
    }
    case 'new':
      return data.newest;
    default: {
      // Recommended rooms (AI) first, then by viewers.
      const rec = (r: Room) => data.recommended.get(r.id)?.score ?? -1;
      return [...data.live].sort((a, b) => rec(b) - rec(a) || b.viewer_count - a.viewer_count);
    }
  }
}
