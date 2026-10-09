import { useAuth } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import { LiveEventBanner } from '@/components/EventRow';
import { RoomCard } from '@/components/RoomCard';
import { FollowingLive, LiveBell } from '@/components/FollowingLive';
import { useTabBarSpace } from '@/components/Menus';
import { FadeIn, PressScale, stagger } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { IconButton, Row, Screen, Text } from '@/components/ui';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';
import { CATEGORIES, categoryLabel, normalizeRooms, ROOM_SELECT, type Room, roomHref } from '@/lib/types';

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
/** Bigo-style dense grid: thin outer padding and gaps. */
const GRID_PAD = 8;
const GRID_GAP = 6;

// live: top 60 by viewers (Popular). Following and New load their own lists, so smaller and newer
// rooms still show once more than 60 rooms are live.
type HomeData = { all: Room[]; live: Room[]; followingLive: Room[]; newest: Room[]; followed: Set<string>; recommended: Map<string, { reason: string | null; score: number }> };

export default function HomeScreen() {
  const tabSpace = useTabBarSpace();
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { profile } = useProfile();
  const { c } = useTheme();
  const offline = useOffline();
  const { width } = useWindowDimensions();
  const [feed, setFeed] = useState<Feed>('popular');
  const [category, setCategory] = useState<(typeof CHIPS)[number]>('all');
  // 2 columns on every phone width (compact through xlarge) — only widens past that on tablet/web.
  const columns = width > 700 ? 4 : 2;
  const cardWidth = (Math.min(width, 1100) - GRID_PAD * 2 - GRID_GAP * (columns - 1)) / columns;

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
  // TOP 1–4 follow real viewer order (data.live is sorted by viewers), not AI picks.
  const topRank = (id: string) => {
    const i = data ? data.live.findIndex((r) => r.id === id) : -1;
    return i >= 0 && i <= 3 ? i + 1 : undefined;
  };
  // Highest-viewed live room currently in a PK battle, if any — the Home screen's entry point into that fight.
  const battleRoom = data?.live.find((r) => r.current_battle_id) ?? null;
  const emptyCopy = {
    following: { title: 'No one you follow is live', body: 'Follow hosts you like and they will show up here.' },
    popular: { title: 'No one is live right now', body: 'Be the first — tap Go live.' },
    nearby: { title: 'No one nearby is live', body: profile?.country ? 'Try Popular to see everyone.' : 'Add your country in Edit profile to see hosts near you.' },
    new: { title: 'No new lives yet', body: 'Check back soon, or go live yourself.' },
  }[feed];

  // Empty feeds stay inside the page (below the banners) rather than replacing it.
  const emptyState: { title: string; body?: string } = category === 'all' ? emptyCopy : { title: `No ${categoryLabel(category)} lives`, body: 'Try another category.' };
  const state = resolveState({ offline, loading, error, data, onRetry: reload });

  const showBanners = feed === 'popular' && category === 'all';
  const grid = (list: Room[], offset: number) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }}>
      {list.map((r, j) => (
        <FadeIn key={`${feed}-${category}-${r.id}`} delay={stagger(offset + j, 30, 150)} duration={250} from={12}>
          <RoomCard
            room={r}
            width={cardWidth}
            reason={feed === 'popular' ? data?.recommended.get(r.id)?.reason : null}
            rank={feed === 'popular' && category === 'all' ? topRank(r.id) : undefined}
          />
        </FadeIn>
      ))}
    </View>
  );


  return (
    <Screen>
      <View style={{ paddingHorizontal: GRID_PAD + 4, paddingTop: 4, maxWidth: 1100, width: '100%', alignSelf: 'center' }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <FeedTabs value={feed} onChange={setFeed} />
          <Row gap={0}>
            <IconButton icon="search" label="Search" bg="transparent" onPress={() => router.push('/party')} />
            <LiveBell rooms={data ? data.followingLive : []} />
          </Row>
        </Row>
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: GRID_PAD + 4, paddingTop: 6, paddingBottom: 8 }}>
          {CHIPS.map((k) => <SmallChip key={k} label={k === 'all' ? 'All' : categoryLabel(k)} selected={category === k} onPress={() => setCategory(k)} />)}
        </ScrollView>
      </View>
      <StateView state={state}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: GRID_PAD, paddingBottom: tabSpace + 32, gap: GRID_GAP, maxWidth: 1100, width: '100%', alignSelf: 'center' }}
          refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={c.text} />}
        >
          {showBanners && data && data.followingLive.length > 0 && (
            <FadeIn style={{ marginHorizontal: -GRID_PAD }}>
              <FollowingLive rooms={data.followingLive} inset={GRID_PAD + 4} />
            </FadeIn>
          )}
          {rooms.length === 0 ? (
            <View style={{ paddingVertical: 32, paddingHorizontal: 16, alignItems: 'center', gap: 6, borderRadius: 12, backgroundColor: c.surface }}>
              <Ionicons name="videocam-outline" size={28} color={c.textFaint} />
              <Text variant="label" style={{ textAlign: 'center' }}>{emptyState.title}</Text>
              {emptyState.body && <Text variant="bodySmall" muted style={{ textAlign: 'center' }}>{emptyState.body}</Text>}
            </View>
          ) : (
            <>
              {/* Lives first; the event and PK banners sit after the first two rows instead of above them. */}
              {grid(rooms.slice(0, columns * 2), 0)}
              {showBanners && (
                <>
                  <FadeIn><LiveEventBanner /></FadeIn>
                  <FadeIn><PkBattleBanner room={battleRoom} /></FadeIn>
                </>
              )}
              {rooms.length > columns * 2 && grid(rooms.slice(columns * 2), columns * 2)}
            </>
          )}
          {rooms.length === 0 && showBanners && (
            <>
              <FadeIn><LiveEventBanner /></FadeIn>
              <FadeIn><PkBattleBanner room={battleRoom} /></FadeIn>
            </>
          )}
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
      <Row style={{ padding: 14, borderRadius: radius[12], backgroundColor: c.surface, borderWidth: 1, borderColor: c.divider }}>
        <View style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: c.goldSurface, borderWidth: 1, borderColor: c.goldBorder, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: c.gold }}>PK</Text>
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

/** Big left-aligned feed switcher (Bigo/Tango): the active feed is large and white, the rest smaller and grey. */
function FeedTabs({ value, onChange }: { value: Feed; onChange: (f: Feed) => void }) {
  const { c } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" style={{ flexShrink: 1 }} contentContainerStyle={{ alignItems: 'flex-end', gap: 14, paddingRight: 8 }}>
      {FEEDS.map((f) => {
        const on = f.id === value;
        return (
          <PressScale key={f.id} onPress={() => onChange(f.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} scaleTo={0.95} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontFamily: on ? fonts.bold : fonts.medium, fontSize: on ? 21 : 15, lineHeight: on ? 27 : 21 }} color={on ? c.text : c.textFaint}>{f.label}</Text>
          </PressScale>
        );
      })}
    </ScrollView>
  );
}

/** Compact category chip for the strip under the feed tabs. */
function SmallChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} scaleTo={0.94} hitSlop={{ top: 7, bottom: 7 }}
      style={{ height: 30, paddingHorizontal: 12, borderRadius: 6, justifyContent: 'center', backgroundColor: selected ? c.primary : c.surfaceRaised }}>
      <Text variant="caption" color={selected ? c.primaryText : c.textMuted} style={{ fontSize: 13, fontWeight: selected ? '700' : '500' }}>{label}</Text>
    </PressScale>
  );
}
