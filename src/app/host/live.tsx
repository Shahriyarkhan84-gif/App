import { useAuth } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatPanel } from '@/components/ChatPanel';
import { GiftToasts } from '@/components/GiftSheet';
import { LiveStage } from '@/components/LiveStage';
import { StateView, type ViewState } from '@/components/StateView';
import { Button, LiveBadge, Row, Text } from '@/components/ui';
import { useAnalytics } from '@/lib/analytics';
import { getLiveKitToken, rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useAsync, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { liveColors as c } from '@/lib/theme';

export default function HostLiveScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const track = useAnalytics();
  const insets = useSafeAreaInsets();
  const [viewers, setViewers] = useState<number | null>(null);
  const [coins, setCoins] = useState(0);
  const [ending, setEnding] = useState(false);

  const session = useAsync(async () => {
    const { data: room, error } = await supabase.from('rooms').select('id,title,status,viewer_count,current_stream_id').eq('host_id', userId!).single();
    if (error) throw error;
    if (room.status !== 'live') return { room, token: null };
    return { room, token: await getLiveKitToken(supabase, room.id, 'host') };
  }, [userId]);

  const roomId = session.data?.room.id;
  useRealtime('rooms', `id=eq.${roomId}`, (p) => setViewers((p.new as { viewer_count: number }).viewer_count), !!roomId);
  useRealtime('gifts', `room_id=eq.${roomId}`, (p) => {
    if (p.eventType === 'INSERT') setCoins((n) => n + Number((p.new as { host_share: number }).host_share));
  }, !!roomId);

  const end = () =>
    Alert.alert('End your stream?', undefined, [
      { text: 'Keep streaming', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: async () => {
          setEnding(true);
          try {
            await rpc(supabase, 'end_live');
            track('live_ended', { room_id: roomId! });
            router.replace({ pathname: '/host/summary', params: { streamId: session.data?.room.current_stream_id ?? '' } });
          } catch (e) {
            Alert.alert('Could not end stream', friendlyError(e));
            setEnding(false);
          }
        },
      },
    ]);

  let state: ViewState = { kind: 'success' };
  if (session.error) state = { kind: 'error', error: session.error, onRetry: session.reload };
  else if (!session.data) state = { kind: 'loading' };
  else if (!session.data.token) state = { kind: 'empty', title: "You're not live", action: { title: 'Back', onPress: () => router.back() } };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StateView state={state}>
        {session.data?.token && roomId && (
          <>
            <LiveStage token={session.data.token.token} url={session.data.token.url} role="host" onError={(e) => Alert.alert('Connection problem', e.message)} />
            <View style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12 }}>
              <Row>
                <LiveBadge viewers={viewers ?? session.data.room.viewer_count} />
                <Text variant="label" color={c.text} style={{ flex: 1 }} numberOfLines={1}>{session.data.room.title}</Text>
                <Text variant="label" color={c.text}>💎 {coins.toLocaleString()}</Text>
                <Button title="End" variant="danger" size="sm" onPress={end} loading={ending} />
              </Row>
            </View>
            <View style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 12, gap: 10 }}>
              <GiftToasts roomId={roomId} />
              <ChatPanel roomId={roomId} hostId={userId!} isHost canModerate />
            </View>
          </>
        )}
      </StateView>
    </View>
  );
}
