import { useAuth } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatPanel } from '@/components/ChatPanel';
import { GiftSheet, GiftToasts } from '@/components/GiftSheet';
import { LiveStage } from '@/components/LiveStage';
import { PkBattleBar, PkBattleStage, usePkBattleState } from '@/components/PkBattle';
import { StateView, type ViewState } from '@/components/StateView';
import { FramedAvatar } from '@/components/FramedAvatar';
import { Avatar, Button, Coin, compactNumber, LiveBadge, Row, Sheet, Text } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { useAnalytics } from '@/lib/analytics';
import { getLiveKitToken, rpc } from '@/lib/api';
import { errorCode, friendlyError } from '@/lib/errors';
import { useAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { liveColors as c } from '@/lib/theme';
import { displayName, normalizeRoom, ROOM_SELECT, type Room } from '@/lib/types';
import { shareMessage } from '@/lib/share';

type Gifter = { user_id: string; display_name: string | null; username: string | null; avatar_url: string | null; coins: number };

export default function LiveRoomScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const supabase = useSupabase();
  const { userId } = useAuth();
  const track = useAnalytics();
  const offline = useOffline();
  const insets = useSafeAreaInsets();
  const [giftOpen, setGiftOpen] = useState(false);
  const [following, setFollowing] = useState<boolean | null>(null);
  const [live, setLive] = useState<Partial<Room>>({});

  // One round trip for what the screen needs; the follow state and the LiveKit token load alongside
  // (each extra sequential request costs ~0.5 s from Pakistan to the us-east-1 server).
  const room = useAsync(async () => {
    const [res, admin] = await Promise.all([
      supabase.from('rooms').select(ROOM_SELECT).eq('id', roomId).single(),
      supabase.from('room_admins').select('user_id').eq('room_id', roomId).eq('user_id', userId!).maybeSingle(),
    ]);
    if (res.error) throw res.error;
    const r = normalizeRoom(res.data as never);
    // Party rooms have their own screen (seats).
    if (r.mode === 'voice' || r.mode === 'video') router.replace({ pathname: '/party/[roomId]', params: { roomId } });
    return { room: r, isRoomAdmin: !!admin.data };
  }, [roomId, userId]);
  const hostId = room.data?.room.host_id;
  const followRow = useAsync(async () => {
    if (!hostId) return false;
    const { data } = await supabase.from('follows').select('followee_id').eq('follower_id', userId!).eq('followee_id', hostId).maybeSingle();
    return !!data;
  }, [hostId, userId]);

  // Your own room opens the host screen: a viewer connection with your identity would kick your broadcast.
  const ownRoom = !!room.data && room.data.room.host_id === userId;
  useEffect(() => {
    if (ownRoom) router.replace('/host/live');
  }, [ownRoom]);

  // Status from realtime wins over the first fetch, so a host going live again reconnects viewers.
  // The token is requested at once (in parallel with the room); the server refuses it if the room
  // isn't live, and it's only used once the room is loaded and isn't your own.
  const liveStatus = live.status ?? room.data?.room.status;
  const mayBeLive = liveStatus === undefined || liveStatus === 'live';
  const token = useAsync(async () => {
    if (!mayBeLive) return null;
    return getLiveKitToken(supabase, roomId, 'viewer');
  }, [roomId, mayBeLive]);
  // The token says the room isn't live (we missed the end event): refresh the room → "ended" screen.
  const tokenCode = token.error ? errorCode(token.error) : null;
  const reloadRoom = room.reload;
  useEffect(() => {
    if (tokenCode === 'room_not_live') reloadRoom();
  }, [tokenCode, reloadRoom]);
  // Removed or blocked by the host while watching: show it and drop the connection.
  const [removed, setRemoved] = useState(false);
  useRealtime('room_bans', userId ? `user_id=eq.${userId}` : undefined, (p) => {
    const b = p.new as { room_id?: string; kind?: string; expires_at?: string | null };
    if (b.room_id === roomId && (b.kind === 'kick' || b.kind === 'block') && (!b.expires_at || new Date(b.expires_at) > new Date())) setRemoved(true);
  }, !!userId);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // Stable per token: inline callbacks would make LiveKit reconnect on every re-render (each
  // viewer-count update). A failed or dropped connection shows a Reconnect state instead.
  const [dropped, setDropped] = useState<string | null>(null);
  const stageToken = token.data?.token ?? null;
  const onStageDisconnected = useCallback(() => setDropped(stageToken), [stageToken]);
  const onStageError = useCallback(() => setDropped(stageToken), [stageToken]);
  const reconnect = () => { setDropped(null); room.reload(); token.reload(); };

  useEffect(() => {
    if (token.data) track('room_joined', { room_id: roomId });
  }, [token.data, roomId, track]);

  // Viewer count + end-of-stream in real time.
  useRealtime('rooms', `id=eq.${roomId}`, (p) => setLive(p.new as Partial<Room>));

  const r = room.data ? { ...room.data.room, ...live } : null;
  const isFollowing = following ?? followRow.data ?? false;
  const { battle, opponentRoom, mySide, secondsLeft } = usePkBattleState(r?.id, r?.current_battle_id);
  const battleLive = battle?.status === 'live' && !!opponentRoom;
  const { height: windowHeight } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);

  // Coins the host has received this live and today's top 3 gifters (with their frames). Gifts
  // refresh them, at most once every 2 s however fast gifts arrive.
  const [giftTick, setGiftTick] = useState(0);
  const giftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime('gifts', `room_id=eq.${roomId}`, () => {
    if (giftTimer.current) return;
    giftTimer.current = setTimeout(() => { giftTimer.current = null; setGiftTick((t) => t + 1); }, 2000);
  });
  useEffect(() => () => { if (giftTimer.current) clearTimeout(giftTimer.current); }, []);
  const hostIdForExtras = r?.host_id;
  const streamId = r?.current_stream_id ?? null;
  const extras = useAsync(async () => {
    if (!hostIdForExtras) return null;
    const [stream, top] = await Promise.all([
      streamId ? supabase.from('streams').select('gift_coins').eq('id', streamId).maybeSingle() : Promise.resolve({ data: null }),
      supabase.rpc('host_contributions', { p_host: hostIdForExtras, p_period: 'day' }),
    ]);
    const list = ((top.data ?? []) as Gifter[]).slice(0, 3);
    let frames: Record<string, string | null> = {};
    if (list.length) {
      // Frames are optional decoration: a failed lookup just shows plain photos.
      const { data, error } = await supabase.from('profiles').select('id,active_frame_id').in('id', list.map((g) => g.user_id));
      if (!error) frames = Object.fromEntries(((data ?? []) as { id: string; active_frame_id: string | null }[]).map((p) => [p.id, p.active_frame_id]));
    }
    return {
      coins: Number((stream.data as { gift_coins?: number } | null)?.gift_coins ?? 0),
      gifters: list.map((g) => ({ ...g, frame: frames[g.user_id] ?? null })),
    };
  }, [hostIdForExtras, streamId, giftTick]);

  const followBusy = useRef(false);
  const toggleFollow = async () => {
    if (!r || followBusy.current) return;
    followBusy.current = true;
    const next = !isFollowing;
    setFollowing(next);
    const { error } = next
      ? await supabase.from('follows').insert({ followee_id: r.host_id })
      : await supabase.from('follows').delete().eq('follower_id', userId!).eq('followee_id', r.host_id);
    followBusy.current = false;
    if (error) setFollowing(!next);
    else track('follow_toggled', { user_id: r.host_id, following: next });
  };

  const shareRoom = () => {
    void shareMessage(`Watch ${displayName(r?.host)} live on Zynalive: zynalive://live/${roomId}`);
    track('room_shared', { room_id: roomId });
  };

  const reportRoom = () =>
    Alert.alert('Report this stream?', 'Our moderators will review it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: async () => {
          try {
            await rpc(supabase, 'report_content', { p_target_type: 'room', p_target_id: roomId, p_reason: 'Reported from live room' });
            track('report_submitted', { target_type: 'room' });
          } catch (e) {
            Alert.alert('Report failed', friendlyError(e));
          }
        },
      },
    ]);

  let state: ViewState = { kind: 'success' };
  if (!r) state = offline ? { kind: 'offline', onRetry: room.reload } : room.error ? { kind: 'error', error: room.error, onRetry: room.reload } : { kind: 'loading' };
  else if (ownRoom) state = { kind: 'loading' };
  else if (removed) state = { kind: 'disabled', title: "You can't join this room", body: 'The host removed you from this live.' };
  else if (r.status !== 'live') state = { kind: 'empty', title: 'This stream has ended', body: `Follow ${displayName(r.host)} to know when they're live next.`, action: { title: 'View profile', onPress: () => router.replace({ pathname: '/user/[id]', params: { id: r.host_id } }) } };
  else if (token.error) state = errorCode(token.error) === 'banned_from_room' || errorCode(token.error) === 'account_restricted'
    ? { kind: 'disabled', title: "You can't join this room", body: friendlyError(token.error) }
    : { kind: 'error', error: token.error, onRetry: token.reload };
  else if (!token.data) state = { kind: 'loading' };
  else if (dropped && dropped === stageToken) state = { kind: 'error', error: new Error('connection_lost'), onRetry: reconnect };

  const viewers = r?.viewer_count ?? 0;
  const coins = extras.data?.coins ?? 0;
  const gifters = extras.data?.gifters ?? [];

  // Bigo-style top bar: host pill (photo, name, coins this stream, + to follow), today's top 3
  // gifters in their frames, viewer count, close.
  const topBar = r && (
    <Row gap={8} style={{ paddingHorizontal: 12 }}>
      <Row gap={8} style={{ backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 26, padding: 4, paddingRight: isFollowing || r.host_id === userId ? 14 : 4, flexShrink: 1 }}>
        <Pressable onPress={() => router.push({ pathname: '/user/[id]', params: { id: r.host_id } })} accessibilityRole="button" accessibilityLabel={`${displayName(r.host)} profile, ${coins} coins this live`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          <Avatar uri={r.host?.avatar_url} name={displayName(r.host)} size={40} />
          <View style={{ flexShrink: 1 }}>
            <Text variant="label" color={c.text} numberOfLines={1} style={{ maxWidth: 120 }}>{displayName(r.host)}</Text>
            <Row gap={4}>
              <Coin size={12} />
              <Text variant="caption" color={c.goldText} style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>{coins.toLocaleString()}</Text>
            </Row>
          </View>
        </Pressable>
        {r.host_id !== userId && !isFollowing && (
          <Pressable onPress={toggleFollow} accessibilityRole="button" accessibilityLabel={`Follow ${displayName(r.host)}`} hitSlop={6}
            style={{ width: 40, height: 34, borderRadius: 17, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={24} color={c.primaryText} />
          </Pressable>
        )}
      </Row>
      <View style={{ flex: 1 }} />
      <Row gap={2}>
        {gifters.map((g, i) => (
          <Pressable key={g.user_id} onPress={() => router.push({ pathname: '/contributions/[id]', params: { id: r.host_id } })} accessibilityRole="button" accessibilityLabel={`Top gifter ${i + 1}: ${g.display_name ?? g.username ?? ''}`}>
            <FramedAvatar uri={g.avatar_url} name={g.display_name ?? g.username} size={30} frameId={g.frame} ring={RANK_RINGS[i]} />
          </Pressable>
        ))}
      </Row>
      <View accessibilityLabel={`${viewers} watching`} style={{ minWidth: 38, height: 38, paddingHorizontal: 6, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="label" color={c.text} style={{ fontSize: 13, fontVariant: ['tabular-nums'] }}>{compactNumber(viewers)}</Text>
      </View>
      <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Leave live room" hitSlop={8} style={{ width: 38, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="close" size={30} color={c.text} />
      </Pressable>
    </Row>
  );

  const chat = r && (
    <ChatPanel
      roomId={roomId}
      hostId={r.host_id}
      isHost={false}
      canModerate={!!room.data?.isRoomAdmin}
      placeholder="Say Hi…"
      fill={battleLive}
      onUserPress={(id) => router.push({ pathname: '/user/[id]', params: { id } })}
      actions={
        <>
          <Pressable onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="More: message, share, report" style={roundButton('rgba(20,24,30,0.78)')}>
            <Ionicons name="menu" size={24} color={c.text} />
          </Pressable>
          <Pressable onPress={() => setGiftOpen(true)} accessibilityRole="button" accessibilityLabel="Send a gift" style={roundButton(c.gold)}>
            <Ionicons name="gift" size={22} color={c.onGold} />
          </Pressable>
        </>
      }
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" />
      <StateView state={state}>
        {r && token.data && (
          battleLive ? (
            // PK: top bar, score bar, the two videos side by side, chat underneath on black.
            <View style={{ flex: 1, paddingTop: insets.top + 6 }}>
              {topBar}
              <View style={{ marginTop: 14, zIndex: 2 }}>
                <PkBattleBar battle={battle!} mySide={mySide} secondsLeft={secondsLeft} />
              </View>
              <PkBattleStage
                height={Math.round(windowHeight * 0.42)}
                mySide={mySide}
                myStage={<LiveStage token={token.data.token} url={token.data.url} role="viewer" onError={onStageError} onDisconnected={onStageDisconnected} />}
                opponentRoom={opponentRoom!}
                mySideLabel={displayName(r.host)}
                opponentSideLabel={displayName(opponentRoom!.host)}
              />
              <View style={{ flex: 1, paddingHorizontal: 12, paddingTop: 10, paddingBottom: insets.bottom + 10, gap: 8 }}>
                <GiftToasts roomId={roomId} />
                {chat}
              </View>
            </View>
          ) : (
            <>
              <LiveStage token={token.data.token} url={token.data.url} role="viewer" onError={onStageError} onDisconnected={onStageDisconnected} />
              <View style={{ position: 'absolute', top: insets.top + 6, left: 0, right: 0, gap: 10 }}>
                {topBar}
                <Row gap={6} style={{ paddingHorizontal: 12 }}><LiveBadge /></Row>
              </View>
              <View style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 10, gap: 10 }}>
                <GiftToasts roomId={roomId} />
                {chat}
              </View>
            </>
          )
        )}
        <GiftSheet roomId={roomId} visible={giftOpen} onClose={() => setGiftOpen(false)} />
        <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="More">
          {r && (
            <View style={{ gap: 8 }}>
              <Button title={`Message ${displayName(r.host)}`} variant="secondary" onPress={() => { setMenuOpen(false); router.push({ pathname: '/chat/[userId]', params: { userId: r.host_id } }); }} />
              <Button title="Share this live" variant="secondary" onPress={() => { setMenuOpen(false); shareRoom(); }} />
              {r.host_id !== userId && isFollowing && <Button title={`Unfollow ${displayName(r.host)}`} variant="ghost" onPress={() => { setMenuOpen(false); void toggleFollow(); }} />}
              <Button title="Report this live" variant="ghost" onPress={() => { setMenuOpen(false); reportRoom(); }} />
            </View>
          )}
        </Sheet>
      </StateView>
    </View>
  );
}

const RANK_RINGS = ['#FFC24B', '#C9D3DE', '#D99A5B'];

function roundButton(backgroundColor: string) {
  return { width: 46, height: 46, borderRadius: 23, backgroundColor, alignItems: 'center', justifyContent: 'center' } as const;
}
