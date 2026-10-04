import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';

import { FadeIn, PressScale, stagger } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Avatar, Button, compactNumber, RoleBadges, Row, Screen, Sheet, Text } from '@/components/ui';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';
import { categoryLabel, displayName, normalizeRooms, ROOM_SELECT, type Profile, type Room } from '@/lib/types';

type Mode = 'live' | 'voice' | 'video';

type Person = Pick<Profile, 'id' | 'user_number' | 'display_name' | 'username' | 'avatar_url' | 'country'>;

/** Party: voice and video party rooms first, then every live room; search people and Host IDs. */
export default function PartyScreen() {
  const supabase = useSupabase();
  const { c, radius } = useTheme();
  const offline = useOffline();
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<{ q: string; rows: Person[] } | null>(null);
  const [starting, setStarting] = useState(false);
  const [modes, setModes] = useState<Map<string, Mode>>(new Map());

  const rooms = useFocusedAsync<Room[]>(async () => {
    const [{ data, error }, modeRows] = await Promise.all([
      supabase.from('rooms').select(ROOM_SELECT).eq('status', 'live').order('viewer_count', { ascending: false }).limit(60),
      // Party mode is fetched on its own so the list still loads before the party migration is applied.
      supabase.from('rooms').select('id,mode').eq('status', 'live').limit(60),
    ]);
    if (error) throw error;
    const byId = new Map(((modeRows.data ?? []) as { id: string; mode: Mode }[]).map((r) => [r.id, r.mode]));
    setModes(byId);
    const list = normalizeRooms(data);
    // Parties first, then the rest by viewers.
    return [...list].sort((a, b) => Number((byId.get(b.id) ?? 'live') !== 'live') - Number((byId.get(a.id) ?? 'live') !== 'live'));
  }, []);

  // Pick the party type, then finish the usual Go live steps (title, cover, verification).
  const startParty = async (mode: Mode) => {
    setStarting(false);
    try {
      await rpc(supabase, 'set_room_mode', { p_mode: mode });
      router.push('/create');
    } catch (e) {
      Alert.alert('Could not start a party', friendlyError(e));
    }
  };

  // People search by name, @username, or 8-digit ID (the same number is their Host ID).
  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      let rows: Person[] = [];
      if (/^\d{8}$/.test(q)) {
        const { data } = await supabase.from('profiles').select('id,user_number,display_name,username,avatar_url,country').eq('user_number', Number(q)).limit(1);
        rows = (data ?? []) as Person[];
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
      ? { title: 'No matches', body: 'Try another name or an 8-digit ID.' }
      : { title: 'No rooms are live', body: 'Start your own and invite your fans.' },
  });

  return (
    <Screen>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 14 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="h1">Party</Text>
          <Button title="Start a party" size="sm" icon={<Ionicons name="add" size={18} color={c.primaryText} />} onPress={() => setStarting(true)} />
        </Row>
        <View style={{ justifyContent: 'center' }}>
          <Ionicons name="search" size={18} color={c.textFaint} style={{ position: 'absolute', left: 14 }} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search rooms, people or ID"
            placeholderTextColor={c.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search rooms, people or ID"
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
                        <Text variant="caption" faint>{[`ID ${p.user_number}`, p.username && `@${p.username}`, p.country].filter(Boolean).join(' · ')}</Text>
                      </View>
                    </Row>
                  </Pressable>
                ))}
                {matchingRooms.length > 0 && <Text variant="h3" style={{ marginTop: 8 }}>Rooms</Text>}
              </View>
            ) : null
          }
          renderItem={({ item, index }) => (
            <FadeIn delay={stagger(index, 50)}>
              <PartyRow room={item} mode={modes.get(item.id) ?? 'live'} rank={!searching && index < 3 ? index + 1 : undefined} />
            </FadeIn>
          )}
        />
      </StateView>

      <Sheet visible={starting} onClose={() => setStarting(false)} title="Start a party">
        {([
          { mode: 'voice', icon: 'mic', title: 'Voice party', body: 'Audio only · you + up to 8 guests on seats' },
          { mode: 'video', icon: 'videocam', title: 'Video party', body: 'Cameras on · you + up to 6 guests' },
          { mode: 'live', icon: 'radio', title: 'Solo live', body: 'Just you on camera' },
        ] as const).map((o) => (
          <PressScale key={o.mode} scaleTo={0.98} haptic onPress={() => startParty(o.mode)} accessibilityRole="button" accessibilityLabel={o.title}>
            <Row style={{ padding: 14, borderRadius: radius[16], backgroundColor: c.surface }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={o.icon} size={22} color="#fff" />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label">{o.title}</Text>
                <Text variant="caption" muted>{o.body}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
            </Row>
          </PressScale>
        ))}
      </Sheet>
    </Screen>
  );
}

function PartyRow({ room, mode, rank }: { room: Room; mode: Mode; rank?: number }) {
  const { c, radius } = useTheme();
  const cover = room.cover_url ?? room.host?.avatar_url;
  const host = displayName(room.host);
  return (
    <PressScale
      scaleTo={0.98}
      onPress={() => (mode === 'live'
        ? router.push({ pathname: '/live/[roomId]', params: { roomId: room.id } })
        : router.push({ pathname: '/party/[roomId]', params: { roomId: room.id } }))}
      accessibilityRole="button"
      accessibilityLabel={`Join ${room.title}, hosted by ${host}, ${room.viewer_count} watching`}
      style={{ flexDirection: 'row', gap: 12, padding: 10, borderRadius: radius[16] + 2, backgroundColor: c.surface, borderWidth: 1, borderColor: c.divider }}
    >
      <View style={{ width: 92, height: 92, borderRadius: radius[12] + 2, backgroundColor: c.surfaceRaised, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        {cover ? <Image source={cover} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <Text variant="display" color="rgba(255,255,255,0.2)" style={{ fontSize: 44, lineHeight: 50 }}>{host.slice(0, 1).toUpperCase()}</Text>}
        <View style={{ position: 'absolute', left: 6, top: 6, backgroundColor: c.live, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text variant="caption" color="#fff" style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>{mode === 'voice' ? 'VOICE' : mode === 'video' ? 'VIDEO' : 'LIVE'}</Text>
        </View>
        {rank !== undefined && (
          <View style={{ position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: c.gold, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 }}>
            <Ionicons name="trophy" size={9} color={c.onGold} />
            <Text variant="caption" color={c.onGold} style={{ fontSize: 9, fontWeight: '800' }}>TOP {rank}</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, justifyContent: 'center', gap: 5 }}>
        <Text variant="h3" numberOfLines={1} style={{ fontSize: 16 }}>{room.title}</Text>
        <Text variant="bodySmall" muted numberOfLines={1}>Host <Text variant="bodySmall" style={{ fontWeight: '500' }}>{host}</Text> · {categoryLabel(room.category)}</Text>
        <View style={{ flexDirection: 'row' }}><RoleBadges profile={room.host} small /></View>
        <Text variant="caption" faint>{compactNumber(room.viewer_count)} watching</Text>
      </View>
    </PressScale>
  );
}
