import { useAuth } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatPanel } from '@/components/ChatPanel';
import { GiftSheet, GiftToasts } from '@/components/GiftSheet';
import { LiveStage } from '@/components/LiveStage';
import { PkBattleBar, PkBattleStage, usePkBattleState } from '@/components/PkBattle';
import { StateView, type ViewState } from '@/components/StateView';
import { Avatar, LiveBadge, RoleBadges, Row, Text, ViewerCount } from '@/components/ui';
import { useAnalytics } from '@/lib/analytics';
import { getLiveKitToken, rpc } from '@/lib/api';
import { errorCode, friendlyError } from '@/lib/errors';
import { useAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { liveColors as c } from '@/lib/theme';
import { displayName, normalizeRoom, ROOM_SELECT, type Room } from '@/lib/types';

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

  const room = useAsync(async () => {
    const { data, error } = await supabase.from('rooms').select(ROOM_SELECT).eq('id', roomId).single();
    if (error) throw error;
    const r = normalizeRoom(data as never);
    const [admin, follow] = await Promise.all([
      supabase.from('room_admins').select('user_id').eq('room_id', roomId).eq('user_id', userId!).maybeSingle(),
      supabase.from('follows').select('followee_id').eq('follower_id', userId!).eq('followee_id', r.host_id).maybeSingle(),
    ]);
    return { room: r, isRoomAdmin: !!admin.data, follows: !!follow.data };
  }, [roomId, userId]);

  const token = useAsync(async () => {
    if (room.data?.room.status !== 'live') return null;
    return getLiveKitToken(supabase, roomId, 'viewer');
  }, [roomId, room.data?.room.status]);

  useEffect(() => {
    if (token.data) track('room_joined', { room_id: roomId });
  }, [token.data, roomId, track]);

  // Viewer count + end-of-stream in real time.
  useRealtime('rooms', `id=eq.${roomId}`, (p) => setLive(p.new as Partial<Room>));

  const r = room.data ? { ...room.data.room, ...live } : null;
  const isFollowing = following ?? room.data?.follows ?? false;
  const { battle, opponentRoom, mySide, secondsLeft } = usePkBattleState(r?.id, r?.current_battle_id);
  const battleLive = battle?.status === 'live' && !!opponentRoom;

  const toggleFollow = async () => {
    if (!r) return;
    const next = !isFollowing;
    setFollowing(next);
    const { error } = next
      ? await supabase.from('follows').insert({ followee_id: r.host_id })
      : await supabase.from('follows').delete().eq('follower_id', userId!).eq('followee_id', r.host_id);
    if (error) setFollowing(!next);
    else track('follow_toggled', { user_id: r.host_id, following: next });
  };

  const shareRoom = () => {
    void Share.share({ message: `Watch ${displayName(r?.host)} live on Zynalive: zynalive://live/${roomId}` });
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
  else if (r.status !== 'live') state = { kind: 'empty', title: 'This stream has ended', body: `Follow ${displayName(r.host)} to know when they're live next.`, action: { title: 'View profile', onPress: () => router.replace({ pathname: '/user/[id]', params: { id: r.host_id } }) } };
  else if (token.error) state = errorCode(token.error) === 'banned_from_room' || errorCode(token.error) === 'account_restricted'
    ? { kind: 'disabled', title: "You can't join this room", body: friendlyError(token.error) }
    : { kind: 'error', error: token.error, onRetry: token.reload };
  else if (!token.data) state = { kind: 'loading' };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StateView state={state}>
        {r && token.data && (
          <>
            {battleLive ? (
              <>
                <PkBattleStage
                  mySide={mySide}
                  myStage={<LiveStage token={token.data.token} url={token.data.url} role="viewer" onError={() => token.reload()} />}
                  opponentRoom={opponentRoom!}
                  mySideLabel={displayName(r.host)}
                  opponentSideLabel={displayName(opponentRoom!.host)}
                />
                <PkBattleBar battle={battle!} mySide={mySide} secondsLeft={secondsLeft} />
              </>
            ) : (
              <LiveStage token={token.data.token} url={token.data.url} role="viewer" onError={() => token.reload()} />
            )}
            <View style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, gap: 10 }}>
              <Row gap={8}>
                <Row gap={8} style={{ backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 24, padding: 4, flexShrink: 1 }}>
                  <Pressable onPress={() => router.push({ pathname: '/user/[id]', params: { id: r.host_id } })} accessibilityRole="button" accessibilityLabel={`${displayName(r.host)} profile`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
                    <Avatar uri={r.host?.avatar_url} name={displayName(r.host)} size={36} />
                    <View style={{ flexShrink: 1, paddingRight: 4 }}>
                      <Row gap={6}>
                        <Text variant="label" color={c.text} numberOfLines={1} style={{ flexShrink: 1 }}>{displayName(r.host)}</Text>
                        <RoleBadges profile={r.host} small />
                      </Row>
                      <Text variant="caption" color="#E4DFEC" numberOfLines={1}>{r.title}</Text>
                    </View>
                  </Pressable>
                  {r.host_id !== userId && (
                    <Pressable
                      onPress={toggleFollow}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isFollowing }}
                      style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', backgroundColor: isFollowing ? 'rgba(255,255,255,0.18)' : c.primary }}
                    >
                      <Text variant="label" color="#fff" style={{ fontSize: 13 }}>{isFollowing ? 'Following' : 'Follow'}</Text>
                    </Pressable>
                  )}
                </Row>
                <View style={{ flex: 1 }} />
                <ViewerCount count={r.viewer_count ?? 0} />
                <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Leave live room" style={roundButton('rgba(0,0,0,0.45)')}>
                  <Ionicons name="close" size={22} color={c.text} />
                </Pressable>
              </Row>
              <Row gap={6}>
                <LiveBadge />
              </Row>
            </View>
            <View style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 12, gap: 10 }}>
              <GiftToasts roomId={roomId} />
              <ChatPanel
                roomId={roomId}
                hostId={r.host_id}
                isHost={false}
                canModerate={!!room.data?.isRoomAdmin}
                onUserPress={(id) => router.push({ pathname: '/user/[id]', params: { id } })}
                actions={
                  <>
                    <Pressable onPress={() => setGiftOpen(true)} accessibilityRole="button" accessibilityLabel="Send a gift" style={roundButton(c.gold)}>
                      <Ionicons name="gift" size={20} color={c.onGold} />
                    </Pressable>
                    <Pressable onPress={shareRoom} accessibilityRole="button" accessibilityLabel="Share this stream" style={roundButton('rgba(0,0,0,0.5)')}>
                      <Ionicons name="share-social-outline" size={18} color={c.text} />
                    </Pressable>
                    <Pressable onPress={reportRoom} accessibilityRole="button" accessibilityLabel="Report this stream" style={roundButton('rgba(0,0,0,0.5)')}>
                      <Ionicons name="flag-outline" size={18} color={c.text} />
                    </Pressable>
                  </>
                }
              />
              <Row gap={10}>
                <Pressable
                  onPress={() => router.push({ pathname: '/chat/[userId]', params: { userId: r.host_id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${displayName(r.host)}`}
                  style={{ flex: 1, height: 46, borderRadius: 23, backgroundColor: 'rgba(0,0,0,0.5)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }}
                >
                  <Ionicons name="chatbubble-outline" size={17} color={c.text} />
                  <Text variant="label" color={c.text} style={{ fontSize: 14 }}>Message</Text>
                </Pressable>
                <Pressable
                  onPress={() => setGiftOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Send a free gift"
                  style={{ flex: 1, borderRadius: 23, overflow: 'hidden' }}
                >
                  <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <Ionicons name="gift-outline" size={17} color="#fff" />
                    <Text variant="label" color="#fff" style={{ fontSize: 14 }}>Send gift</Text>
                  </LinearGradient>
                </Pressable>
              </Row>
            </View>
            <GiftSheet roomId={roomId} visible={giftOpen} onClose={() => setGiftOpen(false)} />
          </>
        )}
      </StateView>
    </View>
  );
}

function roundButton(backgroundColor: string) {
  return { width: 44, height: 44, borderRadius: 22, backgroundColor, alignItems: 'center', justifyContent: 'center' } as const;
}
