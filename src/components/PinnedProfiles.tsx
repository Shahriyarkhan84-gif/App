import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { useFocusedAsync } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { displayName } from '@/lib/types';

import { LiveAvatar } from './FollowingLive';
import { PressScale } from './Motion';
import { Avatar, Row, Text } from './ui';

export type Pinned = {
  id: string;
  user_number: number | null;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  room: { id: string; mode: string | null } | null;
};

/**
 * Verified IDs the owner pinned to Home. Shown whether or not they're live: tapping opens their
 * live room when they're live, otherwise their profile. Hidden when nothing is pinned.
 */
export function PinnedProfiles({ refreshKey }: { refreshKey?: unknown }) {
  const supabase = useSupabase();
  // refreshKey: Home's pull-to-refresh and live-room updates also refresh this row.
  const { data } = useFocusedAsync<Pinned[]>(async () => {
    const { data: pins, error } = await supabase.from('pinned_profiles').select('user_id,position').order('position').order('created_at');
    if (error) throw error;
    const ids = (pins ?? []).map((p) => p.user_id);
    if (!ids.length) return [];
    const [profiles, rooms] = await Promise.all([
      supabase.from('profiles').select('id,user_number,display_name,username,avatar_url,owner_verified_at').in('id', ids),
      supabase.from('rooms').select('id,host_id,mode').in('host_id', ids).eq('status', 'live'),
    ]);
    if (profiles.error) throw profiles.error;
    if (rooms.error) throw rooms.error;
    const live = new Map(((rooms.data ?? []) as { id: string; host_id: string; mode: string | null }[]).map((r) => [r.host_id, r]));
    const byId = new Map((profiles.data ?? []).map((p) => [p.id, p]));
    return ids.flatMap((id) => {
      const p = byId.get(id);
      // Only owner-verified accounts show, even if a pin outlived its verification.
      if (!p?.owner_verified_at) return [];
      const r = live.get(id);
      return [{ ...p, room: r ? { id: r.id, mode: r.mode } : null }];
    });
  }, [refreshKey]);

  if (!data?.length) return null;
  return <PinnedRow items={data} />;
}

/** The Verified row itself (also used by previews with sample data). */
export function PinnedRow({ items }: { items: Pinned[] }) {
  const { c } = useTheme();
  const open = (p: Pinned) => {
    if (p.room) {
      if (p.room.mode === 'voice' || p.room.mode === 'video') router.push({ pathname: '/party/[roomId]', params: { roomId: p.room.id } });
      else router.push({ pathname: '/live/[roomId]', params: { roomId: p.room.id } });
    } else {
      router.push({ pathname: '/user/[id]', params: { id: p.id } });
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <Row gap={6}>
        <Ionicons name="pin" size={14} color={c.primary} />
        <Text variant="label">Verified</Text>
      </Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
        {items.map((p) => {
          const name = displayName(p);
          return (
            <PressScale
              key={p.id}
              scaleTo={0.95}
              onPress={() => open(p)}
              accessibilityRole="button"
              accessibilityLabel={`${name}, verified${p.room ? ', live now' : ''}`}
              style={{ width: 112, alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 16, backgroundColor: c.surface }}
            >
              {p.room ? <LiveAvatar uri={p.avatar_url} name={name} size={64} /> : <Avatar uri={p.avatar_url} name={name} size={64} ring={c.primary} />}
              <Row gap={3} style={{ maxWidth: '100%', marginTop: p.room ? 4 : 0 }}>
                <Text variant="label" numberOfLines={1} style={{ flexShrink: 1, fontSize: 13 }}>{name}</Text>
                <Ionicons name="checkmark-circle" size={14} color={c.primary} accessibilityLabel="Verified" />
              </Row>
              {p.user_number != null && <Text variant="caption" faint>ID {p.user_number}</Text>}
            </PressScale>
          );
        })}
      </ScrollView>
    </View>
  );
}
