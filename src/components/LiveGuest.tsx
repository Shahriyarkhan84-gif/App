import { FlatList, View } from 'react-native';

import { Alert } from '@/lib/alert';
import { enforceInRoom, rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useAsync, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { liveColors as c } from '@/lib/theme';
import { displayName, type Profile } from '@/lib/types';

import { Avatar, Button, Row, Sheet, Text } from './ui';

type Person = Pick<Profile, 'id' | 'display_name' | 'username' | 'avatar_url'>;
const PERSON = 'id,display_name,username,avatar_url';

/**
 * The one guest seat of a solo live (same seat_requests / room_seats as party rooms).
 * The host sees the whole queue; a viewer only their own request (RLS).
 */
export function useLiveGuest(roomId: string | undefined, userId: string | null | undefined) {
  const supabase = useSupabase();
  const state = useAsync(async () => {
    if (!roomId) return null;
    const [seat, requests] = await Promise.all([
      supabase.from('room_seats').select(`user_id,profile:profiles(${PERSON})`).eq('room_id', roomId).maybeSingle(),
      supabase.from('seat_requests').select(`user_id,profile:profiles(${PERSON})`).eq('room_id', roomId).order('created_at'),
    ]);
    const one = (p: unknown) => (Array.isArray(p) ? p[0] : p) as Person | null;
    return {
      guest: seat.data ? { id: seat.data.user_id as string, profile: one(seat.data.profile) } : null,
      requests: (requests.data ?? []).map((r) => ({ id: r.user_id as string, profile: one(r.profile) })),
    };
  }, [roomId]);
  // Realtime skips the filter on DELETE, so check the room in both new and old rows.
  const reload = state.reload;
  const mine = (e: { new: Record<string, unknown>; old: Record<string, unknown> }) => (e.new?.room_id ?? e.old?.room_id) === roomId;
  useRealtime('room_seats', roomId ? `room_id=eq.${roomId}` : undefined, (e) => { if (mine(e)) reload(); }, !!roomId);
  useRealtime('seat_requests', roomId ? `room_id=eq.${roomId}` : undefined, (e) => { if (mine(e)) reload(); }, !!roomId);

  const guest = state.data?.guest ?? null;
  const requests = state.data?.requests ?? [];
  return {
    guest,
    requests,
    isGuest: !!userId && guest?.id === userId,
    requested: !!userId && requests.some((r) => r.id === userId),
    reload,
  };
}

/** Host: people asking to join, Accept / Decline, and the current guest with Remove. */
export function GuestRequestsSheet({ roomId, visible, onClose, guest, requests, onChange }: {
  roomId: string;
  visible: boolean;
  onClose: () => void;
  guest: { id: string; profile: Person | null } | null;
  requests: { id: string; profile: Person | null }[];
  onChange: () => void;
}) {
  const supabase = useSupabase();
  const act = async (fn: 'approve_seat' | 'remove_from_seat', user: string) => {
    try {
      await rpc(supabase, fn, { p_room: roomId, p_user: user });
      // A removed guest's camera and mic are switched off in LiveKit at once (their token lasts 2 h).
      if (fn === 'remove_from_seat') void enforceInRoom(supabase, roomId, user);
    } catch (e) {
      Alert.alert(fn === 'approve_seat' ? "Couldn't bring them on" : "Couldn't remove them", friendlyError(e));
    }
    onChange();
  };
  const row = (p: { id: string; profile: Person | null }, actions: React.ReactNode) => (
    <Row style={{ paddingVertical: 8 }}>
      <Avatar uri={p.profile?.avatar_url} name={displayName(p.profile)} size={40} />
      <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>{displayName(p.profile)}</Text>
      {actions}
    </Row>
  );
  return (
    <Sheet visible={visible} onClose={onClose} title="Guests" tone="live">
      <View style={{ gap: 6 }}>
        {guest && (
          <>
            <Text variant="caption" color={c.textMuted}>On with you now</Text>
            {row(guest, <Button title="Remove" size="sm" variant="secondary" onPress={() => void act('remove_from_seat', guest.id)} />)}
          </>
        )}
        <Text variant="caption" color={c.textMuted}>{requests.length ? 'Asking to join' : 'No one is asking to join yet.'}</Text>
        <FlatList
          data={requests}
          keyExtractor={(r) => r.id}
          style={{ maxHeight: 320 }}
          renderItem={({ item }) => row(item, (
            <Row gap={6}>
              <Button title="Decline" size="sm" variant="ghost" onPress={() => void act('remove_from_seat', item.id)} />
              <Button title={guest ? 'Swap in' : 'Accept'} size="sm" onPress={() => void (async () => {
                // One guest at a time: accepting someone new replaces the current guest.
                if (guest) {
                  await rpc(supabase, 'remove_from_seat', { p_room: roomId, p_user: guest.id }).catch(() => {});
                  void enforceInRoom(supabase, roomId, guest.id);
                }
                await act('approve_seat', item.id);
              })()} />
            </Row>
          ))}
        />
        <Text variant="caption" color={c.textMuted}>Your guest appears in the corner with camera and mic. Viewers see you both.</Text>
      </View>
    </Sheet>
  );
}
