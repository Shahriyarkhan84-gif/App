import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/clerk-expo';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Button, Card, Coin, Row, Screen, Text } from '@/components/ui';
import { U, units } from '@/lib/brand';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { SVIP_LEVELS, svipProgress } from '@/lib/svip';
import { useTheme } from '@/lib/theme';

/** SVIP: your level from the diamonds you've bought, what's next, and the perks of each level. */
export default function SvipScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const offline = useOffline();
  const { data, error, loading, reload } = useFocusedAsync(async () => {
    // Your own purchases only (RLS: own coin ledger). Refunds and chargebacks take diamonds back off.
    const { data, error } = await supabase.from('coin_transactions').select('delta,kind').eq('user_id', userId!).in('kind', ['purchase', 'refund', 'chargeback']);
    if (error) throw error;
    return Math.max(0, (data ?? []).reduce((n, t) => n + Number(t.delta), 0));
  }, [userId], 'svip');

  return (
    <Screen edges={['bottom']}>
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
        {data !== undefined && (() => {
          const p = svipProgress(data);
          return (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
              <LinearGradient colors={['#1E293B', '#0C4A6E', '#0369A1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 26, padding: 20, gap: 10 }}>
                <Row gap={8}>
                  <Ionicons name="diamond" size={22} color="#FFC24B" />
                  <Text variant="display" color="#FFC24B" style={{ fontSize: 28, lineHeight: 34 }}>{p.level ? `SVIP ${p.level}` : 'SVIP'}</Text>
                </Row>
                <Text color="#E0F2FE">{p.level ? `You're SVIP ${p.level}.` : 'Buy diamonds to become SVIP.'} {units(data)} bought so far.</Text>
                {p.next && (
                  <>
                    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(p.progress * 100) }} style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' }}>
                      <View style={{ width: `${Math.round(p.progress * 100)}%`, height: '100%', backgroundColor: '#FFC24B' }} />
                    </View>
                    <Text variant="caption" color="#E0F2FE">{units(p.toNext)} more to SVIP {p.next.level}</Text>
                  </>
                )}
                <Button title={`Buy ${U.spend}`} variant="gold" onPress={() => router.push('/wallet')} style={{ marginTop: 4 }} />
              </LinearGradient>

              <Card style={{ padding: 14, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Ionicons name="time-outline" size={20} color={c.primary} />
                <Text muted style={{ flex: 1 }}>SVIP perks are coming soon. Your level already counts every {U.spendOne} you buy.</Text>
              </Card>

              {SVIP_LEVELS.map((l) => {
                const reached = p.level >= l.level;
                return (
                  <Card key={l.level} style={{ padding: 16, gap: 8, borderColor: p.next?.level === l.level ? c.primary : c.glassBorder }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Text variant="h3">SVIP {l.level}</Text>
                      {reached ? (
                        <Row gap={4}><Ionicons name="checkmark-circle" size={18} color={c.success} /><Text variant="label" color={c.success}>Reached</Text></Row>
                      ) : (
                        <Row gap={4}><Coin size={14} /><Text variant="label" color={c.primary}>{l.need.toLocaleString()}</Text></Row>
                      )}
                    </Row>
                    {l.perks.map((perk) => (
                      <Row key={perk} gap={8} style={{ alignItems: 'flex-start' }}>
                        <Ionicons name="sparkles-outline" size={15} color={c.textMuted} style={{ marginTop: 2 }} />
                        <Text muted style={{ flex: 1 }}>{perk}</Text>
                      </Row>
                    ))}
                  </Card>
                );
              })}
            </ScrollView>
          );
        })()}
      </StateView>
    </Screen>
  );
}
