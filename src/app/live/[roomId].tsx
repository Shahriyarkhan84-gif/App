import { useAuth } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatPanel } from '@/components/ChatPanel';
import { GiftSheet, GiftToasts } from '@/components/GiftSheet';
import { LiveStage } from '@/components/LiveStage';
import { StateView, type ViewState } from '@/components/StateView';
import { Avatar, Button, LiveBadge, Row, Text } from '@/components/ui';
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
            <LiveStage token={token.data.token} url={token.data.url} role="viewer" onError={() => token.reload()} />
            <View style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12 }}>
              <Row>
                <Pressable onPress={() => router.push({ pathname: '/user/[id]', params: { id: r.host_id } })}>
                  <Row gap={8} style={{ backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 24, paddingRight: 12 }}>
                    <Avatar uri={r.host?.avatar_url} name={displayName(r.host)} size={36} />
                    <View>
                      <Text variant="label" color={c.text} numberOfLines={1}>{displayName(r.host)}</Text>
                      <Text variant="caption" color={c.textMuted} numberOfLines={1}>{r.title}</Text>
                    </View>
                  </Row>
                </Pressable>
                {r.host_id !== userId && <Button title={isFollowing ? 'Following' : 'Follow'} size="sm" variant={isFollowing ? 'secondary' : 'primary'} onPress={toggleFollow} />}
                <View style={{ flex: 1 }} />
                <LiveBadge viewers={r.viewer_count} />
                <Pressable onPress={() => router.back()} accessibilityLabel="Leave room" hitSlop={12}>
                  <Ionicons name="close" size={28} color={c.text} />
                </Pressable>
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
              />
              <Row gap={8}>
                <Button title="🎁 Gift" onPress={() => setGiftOpen(true)} style={{ flex: 1 }} />
                <Button title="Report" variant="secondary" size="sm" onPress={reportRoom} />
              </Row>
            </View>
            <GiftSheet roomId={roomId} visible={giftOpen} onClose={() => setGiftOpen(false)} />
          </>
        )}
      </StateView>
    </View>
  );
}
