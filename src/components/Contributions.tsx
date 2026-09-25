import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useAsync } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

import { FadeIn, Pop, PressScale, stagger } from './Motion';
import { Avatar, Card, Coin, compactNumber, Row, Segmented, Text } from './ui';

type Period = 'day' | 'week' | 'month' | 'overall';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'day', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
  { id: 'overall', label: 'Overall' },
];
type Contributor = { rank: number; user_id: string; display_name: string | null; username: string | null; avatar_url: string | null; user_number: number; coins: number; since: string };

const MEDALS = ['#FFC24B', '#C0C6D4', '#C98A5A'];
const EMPTY: Record<Period, string> = { day: 'No gifts yet today.', week: 'No gifts yet this week.', month: 'No gifts yet this month.', overall: 'No gifts yet.' };

/** A host's top gifters for today / this week / this month / since they joined hosting. */
export function Contributions({ hostId }: { hostId: string }) {
  const supabase = useSupabase();
  const { c } = useTheme();
  const [period, setPeriod] = useState<Period>('day');
  const { data, error, loading } = useAsync(() => rpc<Contributor[]>(supabase, 'host_contributions', { p_host: hostId, p_period: period }), [hostId, period]);
  const rows = (data ?? []).slice(0, 10);
  const top = rows[0];
  const name = (r: Contributor) => r.display_name ?? r.username ?? `ID ${r.user_number}`;
  const open = (r: Contributor) => router.push({ pathname: '/user/[id]', params: { id: r.user_id } });

  return (
    <Card style={{ gap: 14 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={8}><Ionicons name="gift-outline" size={18} color={c.gold} /><Text variant="h3">Contributions</Text></Row>
        {period === 'overall' && top && <Text variant="caption" faint>Since joined hosting · {new Date(top.since).toLocaleDateString()}</Text>}
      </Row>
      <Segmented options={PERIODS} value={period} onChange={setPeriod} />

      {loading && !data ? (
        <ActivityIndicator color={c.primary} style={{ paddingVertical: 20 }} />
      ) : error ? (
        <Text muted>{friendlyError(error)}</Text>
      ) : rows.length === 0 ? (
        <Text muted style={{ textAlign: 'center', paddingVertical: 12 }}>{EMPTY[period]}</Text>
      ) : (
        <View style={{ gap: 8 }} key={period}>
          {/* Top 1 */}
          <FadeIn from={10}>
            <PressScale onPress={() => open(top!)} scaleTo={0.97} accessibilityRole="button" accessibilityLabel={`Top contributor ${name(top!)}, ${top!.coins} coins`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: c.goldSurface, borderWidth: 1, borderColor: c.goldBorder }}>
              <View>
                <Avatar uri={top!.avatar_url} name={name(top!)} size={52} ring={MEDALS[0]} />
                <Pop delay={200} from={0} style={{ position: 'absolute', top: -14, alignSelf: 'center' }}><Ionicons name="trophy" size={18} color={MEDALS[0]} /></Pop>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="caption" color={c.goldText}>{period === 'overall' ? 'Overall top 1' : 'Top 1'}</Text>
                <Text variant="label" numberOfLines={1}>{name(top!)}</Text>
                <Text variant="caption" faint>ID {top!.user_number}</Text>
              </View>
              <Row gap={4}><Coin size={16} /><Text variant="h3" color={c.goldText}>{compactNumber(top!.coins)}</Text></Row>
            </PressScale>
          </FadeIn>
          {rows.slice(1).map((r, i) => (
            <FadeIn key={r.user_id} delay={stagger(i + 1, 50)} from={10}>
              <PressScale onPress={() => open(r)} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={`Rank ${r.rank}, ${name(r)}, ${r.coins} coins`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
                <Text variant="label" color={MEDALS[r.rank - 1] ?? c.textFaint} style={{ width: 22, textAlign: 'center' }}>{r.rank}</Text>
                <Avatar uri={r.avatar_url} name={name(r)} size={36} ring={MEDALS[r.rank - 1]} />
                <Text style={{ flex: 1 }} numberOfLines={1}>{name(r)}</Text>
                <Row gap={4}><Coin size={12} /><Text variant="label">{compactNumber(r.coins)}</Text></Row>
              </PressScale>
            </FadeIn>
          ))}
        </View>
      )}
    </Card>
  );
}
