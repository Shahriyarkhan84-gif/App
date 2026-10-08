import { useAuth } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatPanel } from '@/components/ChatPanel';
import { GiftToasts } from '@/components/GiftSheet';
import { LiveStage } from '@/components/LiveStage';
import { endBattleIfExpired, PkBattleBar, PkBattleStage, usePkBattleState } from '@/components/PkBattle';
import { StateView, type ViewState } from '@/components/StateView';
import { Avatar, Button, IconButton, LiveBadge, Row, Sheet, Text } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { useAnalytics } from '@/lib/analytics';
import { getLiveKitToken, rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useAsync, useFocusedAsync, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { liveColors as c } from '@/lib/theme';
import { displayName, normalizeRooms, ROOM_SELECT, type Room } from '@/lib/types';

export default function HostLiveScreen() {
  const supabase = useSupabase();
  // Camera picked with Flip on the Go-live screen.
  const facing = useLocalSearchParams<{ facing?: string }>().facing === 'environment' ? 'environment' : 'user';
  const { userId } = useAuth();
  const track = useAnalytics();
  const insets = useSafeAreaInsets();
  const [viewers, setViewers] = useState<number | null>(null);
  const [coins, setCoins] = useState(0);
  const [battleId, setBattleId] = useState<string | null | undefined>(undefined);
  const [ending, setEnding] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);

  const session = useAsync(async () => {
    const { data: room, error } = await supabase.from('rooms')
      .select('id,title,status,viewer_count,current_stream_id,current_battle_id').eq('host_id', userId!).single();
    if (error) throw error;
    if (room.status !== 'live') return { room, token: null };
    return { room, token: await getLiveKitToken(supabase, room.id, 'host') };
  }, [userId]);

  const roomId = session.data?.room.id;
  // Set once the live is ending, so the summary opens once and Back no longer asks.
  const leaving = useRef(false);
  const endRef = useRef(endNow);
  useEffect(() => {
    endRef.current = endNow;
  });
  // Android Back (or any navigation away) would drop the broadcast while viewers still see "live":
  // ask whether to end it instead.
  const navigation = useNavigation();
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (leaving.current || !session.data?.token) return;
    e.preventDefault();
    Alert.alert('End your stream?', 'Leaving this screen ends your live.', [
      { text: 'Keep streaming', style: 'cancel' },
      { text: 'End', style: 'destructive', onPress: () => void endRef.current() },
    ]);
  }), [navigation, session.data?.token]);
  useRealtime('rooms', `id=eq.${roomId}`, (p) => {
    const next = p.new as { viewer_count: number; current_battle_id: string | null; status?: string; current_stream_id?: string | null };
    // Ended elsewhere (LiveKit room closed, or another device): go to the summary.
    if (next.status && next.status !== 'live') {
      if (leaving.current) return; // end() is already navigating
      leaving.current = true;
      const streamId = session.data?.room.current_stream_id;
      if (streamId) router.replace({ pathname: '/host/summary', params: { streamId } });
      else router.dismissTo('/create');
      return;
    }
    setViewers(next.viewer_count);
    setBattleId(next.current_battle_id);
  }, !!roomId);
  useRealtime('gifts', `room_id=eq.${roomId}`, (p) => {
    if (p.eventType === 'INSERT') setCoins((n) => n + Number((p.new as { host_share: number }).host_share));
  }, !!roomId);

  const effectiveBattleId = battleId !== undefined ? battleId : (session.data?.room.current_battle_id ?? null);
  const { battle, opponentRoom, mySide, secondsLeft } = usePkBattleState(roomId, effectiveBattleId);
  // End an expired battle once per battle (not on every render).
  const endedBattle = useRef<string | null>(null);
  const endRetry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    // ceil() means 0 only once ends_at has passed; the time check keeps the guard from being
    // spent on a call endBattleIfExpired would skip.
    if (secondsLeft === 0 && battle?.ends_at && endedBattle.current !== battle.id && new Date(battle.ends_at).getTime() <= Date.now()) {
      endedBattle.current = battle.id;
      const attempt = (left: number) => void endBattleIfExpired(supabase, battle).then((ok) => {
        // A failed call (e.g. network) is retried a few times instead of leaving the battle live.
        if (!ok && left > 0) endRetry.current = setTimeout(() => attempt(left - 1), 3000);
      });
      attempt(3);
    }
  }, [secondsLeft, battle, supabase]);
  useEffect(() => () => clearTimeout(endRetry.current), []);

  const opponents = useFocusedAsync<Room[]>(async () => {
    if (!inviteOpen) return [];
    const { data, error } = await supabase.from('rooms').select(ROOM_SELECT)
      .eq('status', 'live').is('current_battle_id', null).neq('host_id', userId!).order('viewer_count', { ascending: false }).limit(30);
    if (error) throw error;
    return normalizeRooms(data);
  }, [inviteOpen]);

  const invite = async (targetRoomId: string) => {
    setInviting(targetRoomId);
    try {
      await rpc(supabase, 'invite_pk_battle', { p_target_room_id: targetRoomId });
      track('pk_battle_invited', { room_id: roomId!, target_room_id: targetRoomId });
      setInviteOpen(false);
    } catch (e) {
      Alert.alert('Could not invite', friendlyError(e));
    } finally {
      setInviting(null);
    }
  };

  const respond = async (accept: boolean) => {
    if (!battle) return;
    try {
      await rpc(supabase, 'respond_pk_battle', { p_battle_id: battle.id, p_accept: accept });
      track(accept ? 'pk_battle_accepted' : 'pk_battle_declined', { battle_id: battle.id });
    } catch (e) {
      Alert.alert('Could not respond', friendlyError(e));
    }
  };

  const endBattle = async () => {
    if (!battle) return;
    try {
      await rpc(supabase, 'end_pk_battle', { p_battle_id: battle.id });
      track('pk_battle_ended', { battle_id: battle.id });
    } catch (e) {
      Alert.alert('Could not end battle', friendlyError(e));
    }
  };

  const shareRoom = () => {
    if (!roomId) return;
    void Share.share({ message: `I'm live on Zynalive: zynalive://live/${roomId}` });
    track('room_shared', { room_id: roomId });
  };

  async function endNow() {
    setEnding(true);
    leaving.current = true;
    try {
      await rpc(supabase, 'end_live');
      track('live_ended', { room_id: roomId! });
      const streamId = session.data?.room.current_stream_id;
      if (streamId) router.replace({ pathname: '/host/summary', params: { streamId } });
      else router.dismissTo('/create');
    } catch (e) {
      leaving.current = false;
      Alert.alert('Could not end stream', friendlyError(e));
      setEnding(false);
    }
  }
  const end = () =>
    Alert.alert('End your stream?', undefined, [
      { text: 'Keep streaming', style: 'cancel' },
      { text: 'End', style: 'destructive', onPress: () => void endNow() },
    ]);

  // Stable per token: inline callbacks would make LiveKit reconnect (and re-alert) on every
  // re-render. One alert per token; a dropped connection shows Reconnect (and End stays reachable).
  const stageToken = session.data?.token?.token ?? null;
  const reloadSession = session.reload;
  const [dropped, setDropped] = useState<string | null>(null);
  const alerted = useRef<string | null>(null);
  const onStageDisconnected = useCallback(() => setDropped(stageToken), [stageToken]);
  const onStageError = useCallback((e: Error) => {
    if (alerted.current === stageToken) return;
    alerted.current = stageToken;
    Alert.alert('Camera or connection problem', friendlyError(e), [
      { text: 'OK', style: 'cancel' },
      { text: 'Reconnect', onPress: () => reloadSession() },
    ]);
  }, [stageToken, reloadSession]);

  let state: ViewState = { kind: 'success' };
  if (session.error) state = { kind: 'error', error: session.error, onRetry: session.reload };
  else if (dropped && dropped === stageToken) state = { kind: 'error', error: new Error('connection_lost'), onRetry: () => { setDropped(null); session.reload(); } };
  else if (!session.data) state = { kind: 'loading' };
  else if (!session.data.token) state = { kind: 'empty', title: "You're not live", action: { title: 'Back', onPress: () => router.back() } };

  const iAmChallenger = battle?.status === 'invited' && mySide === 'a';
  const iAmChallenged = battle?.status === 'invited' && mySide === 'b';
  const battleLive = battle?.status === 'live' && !!opponentRoom;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" />
      <StateView state={state}>
        {session.data?.token && roomId && (
          <>
            {battleLive ? (
              <>
                <PkBattleStage
                  mySide={mySide}
                  myStage={<LiveStage key={session.data.token.token} token={session.data.token.token} url={session.data.token.url} role="host" facing={facing} onError={onStageError} onDisconnected={onStageDisconnected} />}
                  opponentRoom={opponentRoom!}
                  mySideLabel="You"
                  opponentSideLabel={displayName(opponentRoom!.host)}
                />
                <PkBattleBar battle={battle!} mySide={mySide} secondsLeft={secondsLeft} timerBelow={false} />
              </>
            ) : (
              <LiveStage key={session.data.token.token} token={session.data.token.token} url={session.data.token.url} role="host" facing={facing} onError={onStageError} onDisconnected={onStageDisconnected} />
            )}
            {/* Two rows so every control fits on small phones (End stays on screen at 360 dp). */}
            <View style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, gap: 8 }}>
              <Row gap={8}>
                <LiveBadge viewers={viewers ?? session.data.room.viewer_count} />
                <Text variant="label" color={c.text} style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>{session.data.room.title}</Text>
                <Button title="End" variant="danger" size="sm" onPress={end} loading={ending} />
              </Row>
              <Row gap={8}>
                <View accessible accessibilityLabel={`${coins.toLocaleString()} diamonds this live`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)' }}>
                  <Ionicons name="diamond" size={14} color="#CFC8FF" />
                  <Text variant="label" color={c.text}>{coins.toLocaleString()}</Text>
                </View>
                <View style={{ flex: 1 }} />
                <IconButton icon="share-social-outline" label="Share this stream" onPress={shareRoom} bg="rgba(0,0,0,0.45)" color="#fff" />
                {!battle && (
                  <Button title="Battle" size="sm" variant="gold" onPress={() => setInviteOpen(true)}
                    icon={<Ionicons name="flash" size={14} color={c.onGold} />} />
                )}
                {battleLive && <Button title="End battle" size="sm" variant="secondary" onPress={endBattle} />}
              </Row>
            </View>

            {iAmChallenger && (
              <View style={{ position: 'absolute', top: insets.top + 104, left: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 16, padding: 14, gap: 8 }}>
                <Text variant="label" color={c.text}>Waiting for {displayName(opponentRoom?.host)} to respond…</Text>
                <Button title="Cancel invite" variant="secondary" size="sm" onPress={() => respond(false)} />
              </View>
            )}
            {iAmChallenged && (
              <View style={{ position: 'absolute', top: insets.top + 104, left: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 16, padding: 14, gap: 10 }}>
                <Row gap={10}>
                  <Avatar uri={opponentRoom?.host?.avatar_url} name={displayName(opponentRoom?.host)} size={36} />
                  <Text variant="label" color={c.text} style={{ flex: 1 }}>{displayName(opponentRoom?.host)} wants to PK battle</Text>
                </Row>
                <Row gap={10}>
                  <Button title="Decline" variant="secondary" size="sm" onPress={() => respond(false)} style={{ flex: 1 }} />
                  <Button title="Accept" variant="gold" size="sm" onPress={() => respond(true)} style={{ flex: 1 }} />
                </Row>
              </View>
            )}

            <View style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 12, gap: 10 }}>
              <GiftToasts roomId={roomId} />
              <ChatPanel roomId={roomId} hostId={userId!} isHost canModerate />
            </View>
          </>
        )}
      </StateView>
      {state.kind === 'error' && (
        // A live that can't connect must still be endable, or the room stays "live" for viewers.
        <View style={{ position: 'absolute', left: 24, right: 24, bottom: insets.bottom + 24 }}>
          <Button title="End live" variant="danger" onPress={end} loading={ending} />
        </View>
      )}

      <Sheet visible={inviteOpen} onClose={() => setInviteOpen(false)} title="PK battle a live host">
        <FlatList
          data={opponents.data ?? []}
          keyExtractor={(r) => r.id}
          ListEmptyComponent={<Text muted style={{ textAlign: 'center', paddingVertical: 20 }}>{opponents.loading ? 'Loading…' : 'No other hosts are live right now.'}</Text>}
          renderItem={({ item }) => (
            <Row style={{ paddingVertical: 10, justifyContent: 'space-between' }}>
              <Row gap={10} style={{ flex: 1 }}>
                <Avatar uri={item.host?.avatar_url} name={displayName(item.host)} size={40} />
                <View style={{ flex: 1 }}>
                  <Text variant="label" numberOfLines={1}>{displayName(item.host)}</Text>
                  <Text variant="caption" muted numberOfLines={1}>{item.title}</Text>
                </View>
              </Row>
              <Button title="Invite" size="sm" loading={inviting === item.id} disabled={inviting !== null} onPress={() => invite(item.id)} />
            </Row>
          )}
        />
      </Sheet>
    </View>
  );
}
