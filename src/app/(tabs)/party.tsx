import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Avatar, Button, compactNumber, Row, Screen, Text } from '@/components/ui';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';
import { categoryLabel, displayName, normalizeRooms, ROOM_SELECT, type Profile, type Room } from '@/lib/types';

type Person = Pick<Profile, 'id' | 'user_number' | 'display_name' | 'username' | 'avatar_url' | 'country'> & { host_code?: string };

/** Party: find live rooms, hosts and Host IDs. Multi-guest voice/video parties plug in here next. */
export default function PartyScreen() {
  const supabase = useSupabase();
  const { c, radius } = useTheme();
  const offline = useOffline();
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<{ q: string; rows: Person[] } | null>(null);

  const rooms = useFocusedAsync<Room[]>(async () => {
    const { data, error } = await supabase.from('rooms').select(ROOM_SELECT).eq('status', 'live').order('viewer_count', { ascending: false }).limit(60);
    if (error) throw error;
    return normalizeRooms(data);
  }, []);

  // People search by name, @username, or permanent Host ID (HOST-00018452).
  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      let rows: Person[] = [];
      if (/^\d{11}$/.test(q)) {
        const { data } = await supabase.from('profiles').select('id,user_number,display_name,username,avatar_url,country').eq('user_number', Number(q)).limit(1);
        rows = (data ?? []) as Person[];
      } else if (/^host-\d+$/i.test(q)) {
        const { data } = await supabase.from('hosts').select('host_code,profile:profiles(id,user_number,display_name,username,avatar_url,country)').eq('host_code', q.toUpperCase()).limit(1);
        rows = (data ?? []).flatMap((h) => {
          const p = h.profile as unknown as Person | null;
          return p ? [{ ...p, host_code: h.host_code }] : [];
        });
      } else {
        const term = q.replace(/[%_,()@]/g, ' ').trim();
        const { data } = await supabase.from('profiles').select('id,user_number,display_name,username,avatar_url,country')
          .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`).limit(10);
        rows = (data ?? []) as Person[];
      }
      if (!cancelled) setPeople({ q, rows });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, supabase]);

  const searching = q.length >= 2;
  const needle = q.toLowerCase();
  const matchingRooms = (rooms.data ?? []).filter((r) =>
    !searching || [r.title, r.category, displayName(r.host)].some((s) => s.toLowerCase().includes(needle)),
  );
  const matchingPeople = searching && people?.q === q ? people.rows : [];

  const state = resolveState({
    offline, loading: rooms.loading, error: rooms.error, data: rooms.data, onRetry: rooms.reload,
    isEmpty: () => matchingRooms.length === 0 && matchingPeople.length === 0 && !(searching && people?.q !== q),
    empty: searching
      ? { title: 'No matches', body: 'Try another name, an 11-digit ID, or a Host ID like HOST-00000001.' }
      : { title: 'No rooms are live', body: 'Start your own and invite your fans.' },
  });

  return (
    <Screen>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 14 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="h1">Party</Text>
          <Button title="Start a party" size="sm" icon={<Ionicons name="add" size={18} color={c.primaryText} />} onPress={() => router.push('/create')} />
        </Row>
        <View style={{ justifyContent: 'center' }}>
          <Ionicons name="search" size={18} color={c.textFaint} style={{ position: 'absolute', left: 14 }} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search rooms, people, ID or HOST-ID"
            placeholderTextColor={c.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search rooms, hosts or Host ID"
            style={{ height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, color: c.text, paddingLeft: 42, paddingRight: 16, fontSize: 15, fontFamily: fonts.regular }}
          />
        </View>
      </View>

      <StateView state={state}>
        <FlatList
          data={matchingRooms}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={rooms.loading && !!rooms.data} onRefresh={rooms.reload} tintColor={c.text} />}
          ListHeaderComponent={
            matchingPeople.length > 0 ? (
              <View style={{ gap: 4, marginBottom: 8 }}>
                <Text variant="h3">People</Text>
                {matchingPeople.map((p) => (
                  <Pressable key={p.id} onPress={() => router.push({ pathname: '/user/[id]', params: { id: p.id } })} accessibilityRole="button">
                    <Row style={{ paddingVertical: 8 }}>
                      <Avatar uri={p.avatar_url} name={displayName(p)} />
                      <View style={{ flex: 1 }}>
                        <Text variant="label">{displayName(p)}</Text>
                        <Text variant="caption" faint>{[`ID ${p.user_number}`, p.username && `@${p.username}`, p.host_code, p.country].filter(Boolean).join(' · ')}</Text>
                      </View>
                    </Row>
                  </Pressable>
                ))}
                {matchingRooms.length > 0 && <Text variant="h3" style={{ marginTop: 8 }}>Rooms</Text>}
              </View>
            ) : null
          }
          renderItem={({ item }) => <PartyRow room={item} />}
        />
      </StateView>
    </Screen>
  );
}

function PartyRow({ room }: { room: Room }) {
  const { c, radius } = useTheme();
  const cover = room.cover_url ?? room.host?.avatar_url;
  const host = displayName(room.host);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/live/[roomId]', params: { roomId: room.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Join ${room.title}, hosted by ${host}, ${room.viewer_count} watching`}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 12, padding: 10, borderRadius: radius[16] + 2, backgroundColor: c.surface, borderWidth: 1, borderColor: c.divider, opacity: pressed ? 0.85 : 1 })}
    >
      <View style={{ width: 92, height: 92, borderRadius: radius[12] + 2, backgroundColor: c.surfaceRaised, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        {cover ? <Image source={cover} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <Text variant="display" color="rgba(255,255,255,0.2)" style={{ fontSize: 44, lineHeight: 50 }}>{host.slice(0, 1).toUpperCase()}</Text>}
        <View style={{ position: 'absolute', left: 6, top: 6, backgroundColor: c.live, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text variant="caption" color="#fff" style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>LIVE</Text>
        </View>
      </View>
      <View style={{ flex: 1, justifyContent: 'center', gap: 5 }}>
        <Text variant="h3" numberOfLines={1} style={{ fontSize: 16 }}>{room.title}</Text>
        <Text variant="bodySmall" muted numberOfLines={1}>Host <Text variant="bodySmall" style={{ fontWeight: '500' }}>{host}</Text> · {categoryLabel(room.category)}</Text>
        <Text variant="caption" faint>{compactNumber(room.viewer_count)} watching</Text>
      </View>
    </Pressable>
  );
}
