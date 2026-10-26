import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/clerk-expo';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, View } from 'react-native';

import { FadeIn, stagger, tapHaptic } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Button, Card, Row, Screen, Text } from '@/components/ui';
import { U, units } from '@/lib/brand';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { PRIVILEGES, privilegesFor, SVIP_LEVELS, svipProgress, type SvipLevel } from '@/lib/svip';
import { fonts, useTheme } from '@/lib/theme';

/** VIP: your level and progress on top, then the climb from V1 to V6. Tap a level to see what it includes. */
export default function SvipScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const offline = useOffline();
  const [open, setOpen] = useState<number | null>(null);

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    // Your own purchases only (RLS: own coin ledger). Refunds and chargebacks take diamonds back off.
    const { data, error } = await supabase.from('coin_transactions').select('delta,kind').eq('user_id', userId!).in('kind', ['purchase', 'refund', 'chargeback']);
    if (error) throw error;
    return Math.max(0, (data ?? []).reduce((n, t) => n + Number(t.delta), 0));
  }, [userId], 'svip');

  const bought = data ?? 0;
  const p = svipProgress(bought);
  // The level you're working towards opens by default.
  const expanded = open ?? (p.next?.level ?? 6);

  const toggle = (level: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    tapHaptic();
    setOpen(expanded === level ? 0 : level);
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'VIP' }} />
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 40, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          {/* Your level */}
          <FadeIn>
            <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 28, padding: 20, gap: 14, overflow: 'hidden' }}>
              <View style={{ position: 'absolute', right: -40, top: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.08)' }} />
              <View style={{ position: 'absolute', right: 30, top: 60, width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(255,255,255,0.06)' }} />
              <Row gap={14}>
                <View style={{ width: 72, height: 72, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }}>
                  <Text color="#FFFFFF" style={{ fontFamily: fonts.brand, fontSize: p.level ? 30 : 16 }}>{p.level ? `V${p.level}` : '—'}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="caption" color="rgba(255,255,255,0.8)">Your VIP level</Text>
                  <Text variant="h2" color="#FFFFFF">{p.level ? `VIP ${p.level}` : 'Not VIP yet'}</Text>
                  <Text variant="caption" color="rgba(255,255,255,0.8)">{units(bought)} bought</Text>
                </View>
              </Row>
              <View style={{ gap: 6 }}>
                <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(p.progress * 100) }} style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' }}>
                  <View style={{ width: `${Math.round(p.progress * 100)}%`, height: '100%', borderRadius: 4, backgroundColor: '#FFFFFF' }} />
                </View>
                <Text variant="caption" color="rgba(255,255,255,0.85)">
                  {p.next ? `${units(p.toNext)} more to V${p.next.level}` : 'You reached the top level'}
                </Text>
              </View>
              {p.next && <Button title={`Buy ${U.spend}`} variant="secondary" onPress={() => router.push('/wallet')} icon={<Ionicons name="diamond" size={16} color={c.primary} />} />}
            </LinearGradient>
          </FadeIn>

          <View style={{ gap: 4 }}>
            <Text variant="h3">The VIP path</Text>
            <Text muted>Each level keeps everything below it. VIP privileges are coming soon.</Text>
          </View>

          {/* The climb, V1 → V6, joined by a line. */}
          <View>
            {SVIP_LEVELS.map((l, i) => (
              <FadeIn key={l.level} delay={stagger(i)}>
                <LevelStep level={l} myLevel={p.level} bought={bought} last={i === SVIP_LEVELS.length - 1} open={expanded === l.level} onPress={() => toggle(l.level)} />
              </FadeIn>
            ))}
          </View>
        </ScrollView>
      </StateView>
    </Screen>
  );
}

function LevelStep({ level, myLevel, bought, last, open, onPress }: { level: SvipLevel; myLevel: number; bought: number; last: boolean; open: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const reached = myLevel >= level.level;
  const here = myLevel === level.level;
  const adds = PRIVILEGES.find((x) => x.from === level.level);
  const status = here ? 'You’re here' : reached ? 'Reached' : `${units(level.need - bought)} to go`;

  return (
    <Row gap={12} style={{ alignItems: 'stretch' }}>
      {/* Node and line */}
      <View style={{ width: 40, alignItems: 'center' }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: reached ? level.color : c.surface, borderWidth: 2, borderColor: level.color, marginTop: 14 }}>
          {reached ? <Ionicons name={here ? 'star' : 'checkmark'} size={18} color="#FFFFFF" /> : <Text variant="label" color={level.color}>{level.level}</Text>}
        </View>
        {!last && <View style={{ flex: 1, width: 2, marginVertical: 4, backgroundColor: myLevel > level.level ? level.color : c.violetBorder }} />}
      </View>

      <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`V${level.level}, ${status}`} style={{ flex: 1, paddingBottom: last ? 0 : 12 }}>
        <Card style={[{ padding: 14, gap: 8 }, here && { borderColor: level.color, borderWidth: 2 }]}>
          <Row gap={8}>
            <Text variant="h3" color={level.color} style={{ fontFamily: fonts.brand }}>V{level.level}</Text>
            <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>{level.tagline}</Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
          </Row>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: c.violetSurface }}>
              <Text variant="caption" color={c.violetText}>{level.need.toLocaleString()} {U.spend}</Text>
            </View>
            <Text variant="caption" muted>{status}</Text>
          </Row>

          {open && (
            <View style={{ gap: 10, marginTop: 4 }}>
              {privilegesFor(level.level).map((pr) => {
                const isNew = pr.id === adds?.id;
                return (
                  <Row key={pr.id} gap={10} style={{ alignItems: 'flex-start' }}>
                    <View style={{ width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: isNew ? level.color : c.violetSurface }}>
                      <Ionicons name={pr.icon} size={17} color={isNew ? '#FFFFFF' : level.color} />
                    </View>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text variant="label">{pr.title}{isNew ? '  · new' : ''}</Text>
                      <Text variant="caption" muted>{pr.body}</Text>
                    </View>
                  </Row>
                );
              })}
            </View>
          )}
        </Card>
      </Pressable>
    </Row>
  );
}
