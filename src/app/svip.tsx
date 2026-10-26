import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/clerk-expo';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, ScrollView, useWindowDimensions, View } from 'react-native';

import { tapHaptic } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Button, Row, Screen, Text } from '@/components/ui';
import { U, units } from '@/lib/brand';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { PRIVILEGES, privilegesFor, SVIP_LEVELS, svipProgress, type SvipLevel } from '@/lib/svip';
import { fonts } from '@/lib/theme';

const WHITE = '#FFFFFF';
const SOFT = 'rgba(255,255,255,0.82)';

/** VIP: one card per level, V1–V6, swiped sideways. Everything about a level is on its card. */
export default function SvipScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const offline = useOffline();
  const { width } = useWindowDimensions();
  const cardW = Math.min(width, 520) - 48;
  const step = cardW + 12;
  const [scrollX] = useState(() => new Animated.Value(0));
  const [index, setIndex] = useState<number | null>(null);

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    // Your own purchases only (RLS: own coin ledger). Refunds and chargebacks take diamonds back off.
    const { data, error } = await supabase.from('coin_transactions').select('delta,kind').eq('user_id', userId!).in('kind', ['purchase', 'refund', 'chargeback']);
    if (error) throw error;
    return Math.max(0, (data ?? []).reduce((n, t) => n + Number(t.delta), 0));
  }, [userId], 'svip');

  const bought = data ?? 0;
  const p = svipProgress(bought);
  // Opens on your level (V1 if you aren't VIP yet).
  const start = Math.max(0, p.level - 1);
  const shown = index ?? start;
  useEffect(() => { scrollX.setValue(start * step); }, [scrollX, start, step]);

  // Cards follow the finger: the middle one grows, its neighbours shrink and fade.
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
    useNativeDriver: true,
    listener: (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const i = Math.min(SVIP_LEVELS.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / step)));
      if (i !== shown) { setIndex(i); tapHaptic(); }
    },
  });

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'VIP' }} />
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
        <ScrollView contentContainerStyle={{ paddingVertical: 16, gap: 16, paddingBottom: 40 }}>
          <Animated.FlatList
            data={SVIP_LEVELS}
            keyExtractor={(l) => String(l.level)}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={step}
            decelerationRate="fast"
            initialScrollIndex={start}
            getItemLayout={(_, i) => ({ length: step, offset: step * i, index: i })}
            contentContainerStyle={{ paddingHorizontal: 24, gap: 12 }}
            onScroll={onScroll}
            scrollEventThrottle={16}
            renderItem={({ item, index: i }) => {
              const range = [(i - 1) * step, i * step, (i + 1) * step];
              return (
                <Animated.View style={{
                  opacity: scrollX.interpolate({ inputRange: range, outputRange: [0.6, 1, 0.6], extrapolate: 'clamp' }),
                  transform: [{ scale: scrollX.interpolate({ inputRange: range, outputRange: [0.92, 1, 0.92], extrapolate: 'clamp' }) }],
                }}>
                  <LevelCard level={item} width={cardW} myLevel={p.level} bought={bought} />
                </Animated.View>
              );
            }}
          />

          <View style={{ paddingHorizontal: 24, gap: 10, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
            <Text variant="label" muted style={{ textAlign: 'center' }}>Level {shown + 1} of {SVIP_LEVELS.length} · swipe to see more</Text>
            {p.level < 6 && <Button title={`Buy ${U.spend}`} onPress={() => router.push('/wallet')} icon={<Ionicons name="diamond" size={16} color={WHITE} />} />}
            <Text variant="caption" faint style={{ textAlign: 'center' }}>Your level comes from {U.spend} you buy. VIP privileges are coming soon.</Text>
          </View>
        </ScrollView>
      </StateView>
    </Screen>
  );
}

function LevelCard({ level, width, myLevel, bought }: { level: SvipLevel; width: number; myLevel: number; bought: number }) {
  const reached = myLevel >= level.level;
  const here = myLevel === level.level;
  const isNext = myLevel + 1 === level.level;
  const prevNeed = SVIP_LEVELS[level.level - 2]?.need ?? 0;
  const progress = Math.min(1, Math.max(0, (bought - prevNeed) / (level.need - prevNeed)));
  const adds = PRIVILEGES.find((x) => x.from === level.level);

  return (
    <LinearGradient colors={level.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ width, minHeight: 580, borderRadius: 30, padding: 20, gap: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)' }}>
      {/* Soft sky glow */}
      <View style={{ position: 'absolute', right: -50, top: -50, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.12)' }} />
      <View style={{ position: 'absolute', left: -30, bottom: -60, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(255,255,255,0.07)' }} />

      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <Text variant="caption" color={SOFT}>VIP level</Text>
          <Text color={WHITE} style={{ fontFamily: fonts.brand, fontSize: 56, lineHeight: 62 }}>{level.level}</Text>
        </View>
        <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: here ? WHITE : 'rgba(255,255,255,0.18)', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name={here ? 'star' : reached ? 'checkmark-circle' : 'lock-closed'} size={13} color={here ? level.colors[1] : WHITE} />
          <Text variant="caption" color={here ? level.colors[1] : WHITE} style={{ fontFamily: fonts.bold }}>{here ? 'Your level' : reached ? 'Reached' : 'Locked'}</Text>
        </View>
      </Row>

      <Text variant="h3" color={WHITE}>{level.tagline}</Text>

      {/* Diamonds needed, with progress on the level you're working towards. */}
      <View style={{ gap: 6 }}>
        <Row gap={6}>
          <Ionicons name="diamond" size={14} color={WHITE} />
          <Text variant="label" color={WHITE}>{level.need.toLocaleString()} {U.spend}</Text>
          {!reached && <Text variant="caption" color={SOFT}>· {units(level.need - bought)} to go</Text>}
        </Row>
        {isNext && (
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }} style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(progress * 100)}%`, height: '100%', backgroundColor: WHITE }} />
          </View>
        )}
      </View>

      {/* What this level includes, on frosted rows. */}
      <View style={{ gap: 8 }}>
        {privilegesFor(level.level).map((pr) => {
          const isNew = pr.id === adds?.id;
          return (
            <Row key={pr.id} gap={10} style={{ padding: 10, borderRadius: 16, backgroundColor: isNew ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.12)' }}>
              <View style={{ width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: isNew ? WHITE : 'rgba(255,255,255,0.18)' }}>
                <Ionicons name={pr.icon} size={16} color={isNew ? level.colors[1] : WHITE} />
              </View>
              <Text variant="label" color={WHITE} style={{ flex: 1 }} numberOfLines={1}>{pr.title}</Text>
              {isNew && <Text variant="caption" color={WHITE} style={{ fontFamily: fonts.bold }}>NEW</Text>}
            </Row>
          );
        })}
      </View>
    </LinearGradient>
  );
}
