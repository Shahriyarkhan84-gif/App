import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { View } from 'react-native';

import { rpc } from '@/lib/api';
import { useAsync } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

import { Pop, PressScale } from './Motion';
import { Avatar, Coin, compactNumber, Row, Text } from './ui';

export type Period = 'day' | 'week' | 'month' | 'overall';
export const PERIODS: { id: Period; label: string }[] = [
  { id: 'day', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
  { id: 'overall', label: 'Overall' },
];
export type Contributor = { rank: number; user_id: string; display_name: string | null; username: string | null; avatar_url: string | null; user_number: number; coins: number; since: string };
export const MEDALS = ['#FFC24B', '#C0C6D4', '#C98A5A'];
export const contributorName = (r: Contributor) => r.display_name ?? r.username ?? `ID ${r.user_number}`;

/** Profile entry to a host's Contributions page: overall top 3 and the overall top 1. */
export function ContributionsCard({ hostId }: { hostId: string }) {
  const supabase = useSupabase();
  const { c } = useTheme();
  const { data } = useAsync(() => rpc<Contributor[]>(supabase, 'host_contributions', { p_host: hostId, p_period: 'overall' }), [hostId]);
  const top = (data ?? []).slice(0, 3);
  return (
    <PressScale
      onPress={() => router.push({ pathname: '/contributions/[id]', params: { id: hostId } })}
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={top[0] ? `Contributions. Overall top 1: ${contributorName(top[0])}` : 'Contributions'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.goldBorder }}
    >
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.goldSurface, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="gift-outline" size={20} color={c.gold} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label">Contributions</Text>
        {top[0] ? (
          <Row gap={4}>
            <Text variant="caption" color={c.goldText} numberOfLines={1} style={{ flexShrink: 1 }}>Overall top 1 · {contributorName(top[0])}</Text>
            <Coin size={10} /><Text variant="caption" color={c.goldText}>{compactNumber(top[0].coins)}</Text>
          </Row>
        ) : (
          <Text variant="caption" faint>Daily · Weekly · Monthly · Overall</Text>
        )}
      </View>
      <Row gap={0}>
        {top.map((r, i) => (
          <Pop key={r.user_id} delay={i * 90} from={0.4} style={{ zIndex: 3 - i, marginLeft: i === 0 ? 0 : -10 }}>
            <Avatar uri={r.avatar_url} name={contributorName(r)} size={32} ring={MEDALS[i]} />
          </Pop>
        ))}
      </Row>
      <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
    </PressScale>
  );
}
