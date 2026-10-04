import { useAuth } from '@clerk/clerk-expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatPanel } from '@/components/ChatPanel';
import { GiftSheet, GiftToasts } from '@/components/GiftSheet';
import type { PartyMode, Seat } from '@/components/PartySeats';
import { PartyStage } from '@/components/PartyStage';
import { StateView, type ViewState } from '@/components/StateView';
import { Avatar, Button, Row, Sheet, Text, ViewerCount } from '@/components/ui';
import { getLiveKitToken, rpc } from '@/lib/api';
import { errorCode, friendlyError } from '@/lib/errors';
import { useAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { liveColors as c } from '@/lib/theme';
import { displayName, normalizeRoom, ROOM_SELECT, type Profile, type Room } from '@/lib/types';

const CAPACITY: Record<PartyMode, number> = { voice: 8, video: 6 };

type Person = Pick<Profile, 'id' | 'display_name' | 'username' | 'avatar_url'>;
type SeatRow = { seat: number; user_id: string; muted: boolean };
type Party = {
  room: Room;
  mode: PartyMode;
  seats: SeatRow[];
  requests: string[];
  people: Map<string, Person>;
  isAdmin: boolean;
};

/** Voice / video party room (design canvas): host + guest seats, seat requests, chat and gifts. */
export default function PartyRoomScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const supabase = useSupabase();
  const { userId } = useAuth();
  const offline = useOffline();
  const insets = useSafeAreaInsets();
  const [micOn, setMicOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);

  const party = useAsync<Party>(async () => {
    const [room, mode, seats, requests, admin] = await Promise.all([
      supabase.from('rooms').select(ROOM_SELECT).eq('id', roomId).single(),
      supabase.from('rooms').select('mode').eq('id', roomId).single(),
      supabase.from('room_seats').select('seat,user_id,muted').eq('room_id', roomId).order('seat'),
      // RLS returns the whole queue to the host/admins and only your own request to everyone else.
      supabase.from('seat_requests').select('user_id,created_at').eq('room_id', roomId).order('created_at'),
      supabase.from('room_admins').select('user_id').eq('room_id', roomId).eq('user_id', userId!).maybeSingle(),
    ]);
    if (room.error) throw room.error;
    if (mode.error) throw mode.error;
    const ids = [...new Set([...(seats.data ?? []).map((s) => s.user_id), ...(requests.data ?? []).map((r) => r.user_id)])];
    const { data: people } = ids.length ? await supabase.from('profiles').select('id,display_name,username,avatar_url').in('id', ids) : { data: [] as Person[] };
    return {
      room: normalizeRoom(room.data as never),
      mode: (mode.data.mode === 'video' ? 'video' : 'voice') as PartyMode,
      seats: (seats.data ?? []) as SeatRow[],
      requests: (requests.data ?? []).map((r) => r.user_id),
      people: new Map((people ?? []).map((p) => [p.id, p as Person])),
      isAdmin: !!admin.data,
    };
  }, [roomId, userId]);

  useRealtime('room_seats', `room_id=eq.${roomId}`, () => party.reload());
  useRealtime('seat_requests', `room_id=eq.${roomId}`, () => party.reload());
  useRealtime('rooms', `id=eq.${roomId}`, () => party.reload());

  const p = party.data;
  const isHost = !!p && p.room.host_id === userId;
  const mySeat = p?.seats.find((s) => s.user_id === userId) ?? null;
  const role: 'host' | 'guest' | 'viewer' = isHost ? 'host' : mySeat ? 'guest' : 'viewer';
  const canManage = isHost || !!p?.isAdmin;
  const requested = !!p && !isHost && p.requests.includes(userId!);
  const queue = canManage && p ? p.requests : [];

  // A new token whenever your role changes (taking or leaving a seat changes what you may publish).
  const token = useAsync(async () => {
    if (p?.room.status !== 'live') return null;
    return getLiveKitToken(supabase, roomId, role);
  }, [roomId, p?.room.status, role]);

  const act = async (fn: () => Promise<unknown>, failTitle: string) => {
    setBusy(true);
    try {
      await fn();
      party.reload();
    } catch (e) {
      Alert.alert(failTitle, friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const requestSeat = () => act(() => rpc(supabase, 'request_seat', { p_room: roomId }), 'Could not ask for a seat');
  const leaveSeat = () => act(() => rpc(supabase, 'leave_seat', { p_room: roomId }), 'Could not leave the seat');
  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    if (role === 'guest') void rpc(supabase, 'set_seat_muted', { p_room: roomId, p_muted: !next }).catch(() => undefined);
  };
  const endParty = () =>
    Alert.alert('End the party?', 'Everyone leaves their seat.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: () => act(async () => {
          await rpc(supabase, 'end_live');
          router.replace('/host/dashboard');
        }, 'Could not end the party'),
      },
    ]);

  const person = (id: string) => p?.people.get(id);
  const seats: Seat[] = p
    ? [
        { seat: 0, user: { id: p.room.host_id, name: displayName(p.room.host), avatar_url: p.room.host?.avatar_url }, muted: isHost && !micOn },
        ...Array.from({ length: CAPACITY[p.mode] }, (_, i) => {
          const s = p.seats.find((x) => x.seat === i + 1);
          const who = s ? person(s.user_id) : undefined;
          return {
            seat: i + 1,
            user: s ? { id: s.user_id, name: displayName(who), avatar_url: who?.avatar_url } : null,
            muted: s ? (s.user_id === userId ? !micOn : s.muted) : false,
          };
        }),
      ]
    : [];

  const onSeatPress = (s: Seat) => {
    if (!s.user) {
      if (role === 'viewer' && !requested) void requestSeat();
      return;
    }
    if (canManage && s.seat > 0 && s.user.id !== userId) {
      const guest = s.user;
      Alert.alert(guest.name, undefined, [
        { text: 'View profile', onPress: () => router.push({ pathname: '/user/[id]', params: { id: guest.id } }) },
        { text: 'Remove from seat', style: 'destructive', onPress: () => act(() => rpc(supabase, 'remove_from_seat', { p_room: roomId, p_user: guest.id }), 'Could not remove') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    if (s.user.id !== userId) router.push({ pathname: '/user/[id]', params: { id: s.user.id } });
  };

  let state: ViewState = { kind: 'success' };
  if (!p) state = offline ? { kind: 'offline', onRetry: party.reload } : party.error ? { kind: 'error', error: party.error, onRetry: party.reload } : { kind: 'loading' };
  else if (p.room.status !== 'live') state = { kind: 'empty', title: 'This party has ended', body: `Follow ${displayName(p.room.host)} to know when they're live next.`, action: { title: 'Back to Party', onPress: () => router.replace('/party') } };
  else if (token.error) state = errorCode(token.error) === 'banned_from_room' || errorCode(token.error) === 'account_restricted'
    ? { kind: 'disabled', title: "You can't join this party", body: friendlyError(token.error) }
    : { kind: 'error', error: token.error, onRetry: token.reload };
  else if (!token.data) state = { kind: 'loading' };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <StatusBar style="light" />
      <StateView state={state}>
        {p && token.data && (
          <View style={{ flex: 1, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12, paddingHorizontal: 12, gap: 12 }}>
            <Row gap={8}>
              <Avatar uri={p.room.host?.avatar_url} name={displayName(p.room.host)} size={36} />
              <View style={{ flex: 1 }}>
                <Text variant="label" color={c.text} numberOfLines={1}>{p.room.title}</Text>
                <Text variant="caption" color={c.textMuted}>{p.mode === 'video' ? 'Video party' : 'Voice party'} · {p.seats.length}/{CAPACITY[p.mode]} seats</Text>
              </View>
              <ViewerCount count={p.room.viewer_count ?? 0} />
              <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Leave party" style={round('rgba(255,255,255,0.1)')}>
                <Ionicons name="close" size={22} color={c.text} />
              </Pressable>
            </Row>

            <ScrollView style={{ flexGrow: 0, maxHeight: p.mode === 'video' ? '58%' : '48%' }} contentContainerStyle={{ paddingVertical: 8 }}>
              <PartyStage
                key={role}
                token={token.data.token}
                url={token.data.url}
                mode={p.mode}
                seats={seats}
                publishing={role !== 'viewer'}
                micOn={micOn}
                onSeatPress={onSeatPress}
                onError={() => token.reload()}
              />
            </ScrollView>

            <View style={{ flex: 1, justifyContent: 'flex-end', gap: 10 }}>
              <GiftToasts roomId={roomId} />
              <ChatPanel
                roomId={roomId}
                hostId={p.room.host_id}
                isHost={isHost}
                canModerate={canManage}
                onUserPress={(id) => router.push({ pathname: '/user/[id]', params: { id } })}
                actions={
                  <>
                    {role !== 'viewer' && (
                      <Pressable onPress={toggleMic} accessibilityRole="button" accessibilityLabel={micOn ? 'Mute your mic' : 'Unmute your mic'} style={round(micOn ? 'rgba(255,255,255,0.12)' : c.danger)}>
                        <Ionicons name={micOn ? 'mic' : 'mic-off'} size={20} color={c.text} />
                      </Pressable>
                    )}
                    {!isHost && (
                      <Pressable onPress={() => setGiftOpen(true)} accessibilityRole="button" accessibilityLabel="Send a gift" style={round(c.gold)}>
                        <Ionicons name="gift" size={20} color={c.onGold} />
                      </Pressable>
                    )}
                  </>
                }
              />
              <Row gap={8}>
                {role === 'viewer' && (
                  <Button
                    title={requested ? 'Requested · Cancel' : 'Ask for a seat'}
                    variant={requested ? 'secondary' : 'primary'}
                    loading={busy}
                    onPress={requested ? leaveSeat : requestSeat}
                    style={{ flex: 1 }}
                  />
                )}
                {role === 'guest' && <Button title="Leave seat" variant="secondary" loading={busy} onPress={leaveSeat} style={{ flex: 1 }} />}
                {canManage && (
                  <Button title={`Requests${queue.length ? ` (${queue.length})` : ''}`} variant="secondary" onPress={() => setQueueOpen(true)} style={{ flex: 1 }} />
                )}
                {isHost && <Button title="End party" variant="danger" loading={busy} onPress={endParty} style={{ flex: 1 }} />}
              </Row>
            </View>
          </View>
        )}
      </StateView>

      <Sheet visible={queueOpen} onClose={() => setQueueOpen(false)} title="Seat requests">
        {queue.length === 0 ? (
          <Text muted>No one is waiting for a seat.</Text>
        ) : (
          <ScrollView style={{ maxHeight: 360 }}>
            {queue.map((id) => {
              const who = person(id);
              return (
                <Row key={id} gap={10} style={{ paddingVertical: 8 }}>
                  <Avatar uri={who?.avatar_url} name={displayName(who)} size={36} />
                  <Text style={{ flex: 1 }} numberOfLines={1}>{displayName(who)}</Text>
                  <Button title="Decline" variant="ghost" size="sm" onPress={() => act(() => rpc(supabase, 'remove_from_seat', { p_room: roomId, p_user: id }), 'Could not decline')} />
                  <Button title="Approve" size="sm" loading={busy} onPress={() => act(() => rpc(supabase, 'approve_seat', { p_room: roomId, p_user: id }), 'Could not approve')} />
                </Row>
              );
            })}
          </ScrollView>
        )}
      </Sheet>
      <GiftSheet roomId={roomId} visible={giftOpen} onClose={() => setGiftOpen(false)} />
    </View>
  );
}

function round(backgroundColor: string) {
  return { width: 44, height: 44, borderRadius: 22, backgroundColor, alignItems: 'center', justifyContent: 'center' } as const;
}
