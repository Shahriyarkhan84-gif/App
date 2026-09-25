import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';

import { type Contributor, PERIODS, type Period, contributorName, MEDALS } from '@/components/Contributions';
import { FadeIn, GrowBar, Pop, PressScale, stagger } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Avatar, Coin, compactNumber, Row, Screen, Segmented, Text } from '@/components/ui';
import { rpc } from '@/lib/api';
import { useAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

const EMPTY: Record<Period, string> = { day: 'No gifts yet today', week: 'No gifts yet this week', month: 'No gifts yet this month', overall: 'No gifts yet' };

/** Full contributions ranking for one host: podium + list, per period; Overall starts when they joined hosting. */
export default function ContributionsScreen() {
  const { id, period: initial } = useLocalSearchParams<{ id: string; period?: Period }>();
  const supabase = useSupabase();
  const { c } = useTheme();
  const offline = useOffline();
  const [period, setPeriod] = useState<Period>(initial ?? 'day');
  const { data, error, loading, reload } = useAsync(() => rpc<Contributor[]>(supabase, 'host_contributions', { p_host: id, p_period: period }), [id, period]);
  const rows = data ?? [];
  const podium = [rows[1], rows[0], rows[2]].filter(Boolean) as Contributor[];
  const open = (r: Contributor) => router.push({ pathname: '/user/[id]', params: { id: r.user_id } });

  return (
    <Screen edges={['bottom']}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 8, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <Segmented options={PERIODS} value={period} onChange={setPeriod} />
        {period === 'overall' && rows[0] && <Text variant="caption" faint style={{ textAlign: 'center' }}>Since joined hosting · {new Date(rows[0].since).toLocaleDateString()}</Text>}
      </View>
      <StateView state={resolveState({ offline, loading: loading && !data, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: EMPTY[period], body: 'Gifts sent to this host show up here.' } })}>
        <FlatList
          key={period}
          data={rows.slice(3)}
          keyExtractor={(r) => r.user_id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 6, maxWidth: 640, width: '100%', alignSelf: 'center' }}
          ListHeaderComponent={
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 22, paddingBottom: 14 }}>
              {podium.map((r) => {
                const first = r.rank === 1;
                const size = first ? 84 : 64;
                return (
                  <FadeIn key={r.user_id} delay={first ? 0 : r.rank === 2 ? 150 : 300} from={40} style={{ flex: 1 }}>
                    <PressScale onPress={() => open(r)} style={{ alignItems: 'center', gap: 6 }} accessibilityRole="button"
                      accessibilityLabel={`${first && period === 'overall' ? 'Overall top 1' : `Rank ${r.rank}`}, ${contributorName(r)}, ${r.coins} coins`}>
                      {first && <Pop delay={250} from={0}><Ionicons name="trophy" size={24} color={MEDALS[0]} /></Pop>}
                      <View>
                        <Avatar uri={r.avatar_url} name={contributorName(r)} size={size} ring={MEDALS[r.rank - 1]} />
                        <View style={{ position: 'absolute', alignSelf: 'center', bottom: -9, width: 22, height: 22, borderRadius: 11, backgroundColor: MEDALS[r.rank - 1], alignItems: 'center', justifyContent: 'center' }}>
                          <Text variant="caption" color="#1A1206" style={{ fontWeight: '800' }}>{r.rank}</Text>
                        </View>
                      </View>
                      <Text variant="label" numberOfLines={1} style={{ marginTop: 6 }}>{contributorName(r)}</Text>
                      {first && <Text variant="caption" color={c.goldText}>{period === 'overall' ? 'Overall top 1' : 'Top 1'}</Text>}
                      <Row gap={4}><Coin size={12} /><Text variant="caption" color={c.goldText} style={{ fontWeight: '700' }}>{compactNumber(r.coins)}</Text></Row>
                      <GrowBar height={first ? 64 : r.rank === 2 ? 44 : 30} delay={350 + r.rank * 100} style={{ alignSelf: 'stretch', borderTopLeftRadius: 12, borderTopRightRadius: 12, backgroundColor: first ? c.goldSurface : c.surface }} />
                    </PressScale>
                  </FadeIn>
                );
              })}
            </View>
          }
          renderItem={({ item, index }) => (
            <FadeIn delay={stagger(index, 40)} from={10}>
              <PressScale onPress={() => open(item)} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={`Rank ${item.rank}, ${contributorName(item)}, ${item.coins} coins`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: c.surface }}>
                <Text variant="label" faint style={{ width: 26, textAlign: 'center' }}>{item.rank}</Text>
                <Avatar uri={item.avatar_url} name={contributorName(item)} size={40} />
                <View style={{ flex: 1 }}>
                  <Text variant="label" numberOfLines={1}>{contributorName(item)}</Text>
                  <Text variant="caption" faint>ID {item.user_number}</Text>
                </View>
                <Row gap={4}><Coin size={14} /><Text variant="label">{compactNumber(item.coins)}</Text></Row>
              </PressScale>
            </FadeIn>
          )}
        />
      </StateView>
    </Screen>
  );
}
