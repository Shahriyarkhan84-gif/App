import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { FadeIn, GrowBar, PressScale } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Avatar, Coin, compactNumber, Row, Screen, Segmented, Text, TextTabs } from '@/components/ui';
import { rpc } from '@/lib/api';
import { useAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

type Ranking = { rank: number; subject_id: string; label: string; avatar_url: string | null; score: number };
type Kind = 'live' | 'creator' | 'gifter' | 'country';
type Period = 'day' | 'week' | 'month';

const KINDS: { id: Kind; label: string }[] = [
  { id: 'creator', label: 'Hosts' },
  { id: 'gifter', label: 'Gifters' },
  { id: 'live', label: 'Live' },
  { id: 'country', label: 'Countries' },
];
const PERIODS: { id: Period; label: string }[] = [
  { id: 'day', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
];
const MEDALS = ['#FFC24B', '#C9C4D6', '#D08A5A'];

export default function RankingsScreen() {
  const supabase = useSupabase();
  const { c } = useTheme();
  const offline = useOffline();
  const [kind, setKind] = useState<Kind>('creator');
  const [period, setPeriod] = useState<Period>('week');

  const rankings = useAsync(() => rpc<Ranking[]>(supabase, 'get_rankings', { p_kind: kind, p_period: period }), [kind, period]);

  const open = (r: Ranking) => {
    if (kind === 'live') router.push({ pathname: '/live/[roomId]', params: { roomId: r.subject_id } });
    else if (kind !== 'country') router.push({ pathname: '/user/[id]', params: { id: r.subject_id } });
  };
  const score = (r: Ranking) => (kind === 'live' ? `${compactNumber(r.score)} watching` : compactNumber(Number(r.score)));

  const rows = rankings.data ?? [];
  // Podium order: 2nd, 1st, 3rd.
  const podium = [rows[1], rows[0], rows[2]].filter(Boolean) as Ranking[];

  return (
    <Screen edges={[]}>
      <View style={{ paddingHorizontal: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: c.divider }}>
        <TextTabs options={KINDS} value={kind} onChange={setKind} />
      </View>
      {kind !== 'live' && (
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <Segmented options={PERIODS} value={period} onChange={setPeriod} />
        </View>
      )}
      <StateView
        state={resolveState({
          offline, loading: rankings.loading, error: rankings.error, data: rankings.data, onRetry: rankings.reload,
          isEmpty: (d) => d.length === 0, empty: { title: 'No rankings yet', body: 'Rankings fill up as people go live and send gifts.' },
        })}
      >
        <FlatList
          data={rows.slice(3)}
          keyExtractor={(r) => `${r.rank}-${r.subject_id}`}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          ListHeaderComponent={
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 6, paddingBottom: 12 }}>
              {podium.map((r, i) => {
                const first = r.rank === 1;
                const size = first ? 84 : 68;
                return (
                  <FadeIn key={`${kind}-${r.subject_id}`} delay={[150, 0, 300][i] ?? 0} from={40} style={{ flex: 1 }}>
                  <PressScale onPress={() => open(r)} disabled={kind === 'country'} style={{ alignItems: 'center', gap: 6 }} accessibilityLabel={`Rank ${r.rank}, ${r.label}, ${score(r)}`}>
                    <View>
                      <Avatar uri={kind === 'country' ? null : r.avatar_url} name={r.label} size={size} ring={MEDALS[r.rank - 1]} />
                      <View style={{ position: 'absolute', alignSelf: 'center', bottom: -8, width: 22, height: 22, borderRadius: 11, backgroundColor: MEDALS[r.rank - 1], alignItems: 'center', justifyContent: 'center' }}>
                        <Text variant="caption" color="#1A1206" style={{ fontWeight: '700' }}>{r.rank}</Text>
                      </View>
                    </View>
                    <Text variant="label" numberOfLines={1} style={{ marginTop: 6 }}>{r.label}</Text>
                    <Row gap={4}>{kind !== 'live' && <Coin size={12} />}<Text variant="caption" muted>{score(r)}</Text></Row>
                    <GrowBar height={first ? 56 : 36} delay={350 + i * 120} style={{ alignSelf: 'stretch', borderTopLeftRadius: 12, borderTopRightRadius: 12, backgroundColor: c.surface }} />
                  </PressScale>
                  </FadeIn>
                );
              })}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => open(item)} disabled={kind === 'country'}>
              <Row style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.divider }}>
                <Text variant="label" faint style={{ width: 24, textAlign: 'center' }}>{item.rank}</Text>
                <Avatar uri={kind === 'country' ? null : item.avatar_url} name={item.label} />
                <Text style={{ flex: 1, fontWeight: '500' }} numberOfLines={1}>{item.label}</Text>
                <Row gap={4}>{kind !== 'live' && <Coin size={12} />}<Text variant="label">{score(item)}</Text></Row>
              </Row>
            </Pressable>
          )}
        />
      </StateView>
    </Screen>
  );
}
