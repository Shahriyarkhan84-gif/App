import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/clerk-expo';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Button, Row, Text } from '@/components/ui';
import { U, units } from '@/lib/brand';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { PRIVILEGES, SVIP_LEVELS, svipProgress, type SvipLevel } from '@/lib/svip';
import { fonts } from '@/lib/theme';

// The VIP page is dark and premium on every brand look: deep navy, light text, each level in its own metal.
const BG = ['#0B1020', '#0E1630', '#070B16'] as const;
const INK = '#FFFFFF';
const MUTED = '#AEB8CC';
const FAINT = '#7D879C';
const GOLD = '#F2C48D';

/** My VIP: swipe V1–V6, see what each level unlocks, and how far you are from it. */
export default function SvipScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const offline = useOffline();
  const { width } = useWindowDimensions();
  const cardW = Math.min(width, 520) - 56;
  const list = useRef<FlatList<SvipLevel>>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [perk, setPerk] = useState(0);

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    // Your own purchases only (RLS: own coin ledger). Refunds and chargebacks take diamonds back off.
    const { data, error } = await supabase.from('coin_transactions').select('delta,kind').eq('user_id', userId!).in('kind', ['purchase', 'refund', 'chargeback']);
    if (error) throw error;
    return Math.max(0, (data ?? []).reduce((n, t) => n + Number(t.delta), 0));
  }, [userId], 'svip');

  const p = svipProgress(data ?? 0);
  // Opens on your current level, or V1 if you aren't VIP yet.
  const shown = index ?? Math.max(0, p.level - 1);
  const lvl = SVIP_LEVELS[shown];
  const reached = p.level >= lvl.level;
  const privilege = PRIVILEGES[perk];
  const unlocked = privilege.from <= lvl.level;

  const goTo = (i: number) => {
    setIndex(i);
    list.current?.scrollToIndex({ index: i, animated: true });
  };

  return (
    <LinearGradient colors={BG} style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack.Screen options={{ title: 'My VIP', headerStyle: { backgroundColor: BG[0] }, headerTintColor: INK, headerTitleStyle: { fontFamily: fonts.bold, color: INK } }} />
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Level cards, swiped sideways like a carousel. */}
          <FlatList
            ref={list}
            data={SVIP_LEVELS}
            keyExtractor={(l) => String(l.level)}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={cardW + 12}
            decelerationRate="fast"
            initialScrollIndex={Math.max(0, p.level - 1)}
            getItemLayout={(_, i) => ({ length: cardW + 12, offset: (cardW + 12) * i, index: i })}
            contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 16, gap: 12 }}
            onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / (cardW + 12)))}
            renderItem={({ item }) => <LevelCard level={item} width={cardW} current={p.level === item.level} reached={p.level >= item.level} />}
          />

          {/* V1 … V6 line: filled up to your level; tap to jump. */}
          <View style={{ marginTop: 22, marginHorizontal: 28 }}>
            <View style={{ position: 'absolute', top: 7, left: 8, right: 8, height: 2, backgroundColor: 'rgba(255,255,255,0.12)' }} />
            <Row style={{ justifyContent: 'space-between' }}>
              {SVIP_LEVELS.map((l, i) => {
                const on = i === shown;
                return (
                  <Pressable key={l.level} onPress={() => goTo(i)} accessibilityRole="button" accessibilityLabel={`V${l.level}`} accessibilityState={{ selected: on }} hitSlop={10} style={{ alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? 'rgba(255,255,255,0.25)' : 'transparent' }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.level >= l.level ? l.gem : on ? INK : 'rgba(255,255,255,0.3)' }} />
                    </View>
                    <Text variant="label" color={on ? INK : FAINT}>V{l.level}</Text>
                  </Pressable>
                );
              })}
            </Row>
          </View>

          {/* Privileges of the level on screen. */}
          <View style={{ marginTop: 26, marginHorizontal: 0, paddingTop: 22, paddingHorizontal: 20, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: 'rgba(255,255,255,0.04)', borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 14, alignItems: 'center' }}>
            <Text variant="h2" color={GOLD}>V{lvl.level} privileges</Text>
            <View style={{ width: 150, height: 150, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: unlocked ? lvl.gem : '#FFFFFF', opacity: 0.12 }} />
              <Ionicons name={privilege.icon} size={84} color={unlocked ? lvl.gem : FAINT} />
              {!unlocked && <View style={{ position: 'absolute', right: 18, bottom: 18, width: 34, height: 34, borderRadius: 17, backgroundColor: '#1B2236', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="lock-closed" size={16} color={MUTED} /></View>}
            </View>
            <Text variant="h3" color={GOLD}>◆  {privilege.title}  ◆</Text>
            <Text color={MUTED} style={{ textAlign: 'center' }}>{privilege.body}</Text>
            {!unlocked && <Text variant="caption" color={FAINT}>Unlocks at V{privilege.from}</Text>}

            <Row style={{ justifyContent: 'space-between', alignSelf: 'stretch', marginTop: 6 }}>
              {PRIVILEGES.map((pr, i) => {
                const on = i === perk;
                const has = pr.from <= lvl.level;
                return (
                  <Pressable key={pr.id} onPress={() => setPerk(i)} accessibilityRole="button" accessibilityLabel={`${pr.title}${has ? '' : `, unlocks at V${pr.from}`}`} accessibilityState={{ selected: on }}
                    style={{ width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? 'rgba(255,255,255,0.12)' : 'transparent', borderWidth: on ? 1 : 0, borderColor: 'rgba(255,255,255,0.2)' }}>
                    <Ionicons name={pr.icon} size={24} color={has ? (on ? lvl.gem : MUTED) : 'rgba(255,255,255,0.22)'} />
                  </Pressable>
                );
              })}
            </Row>

            <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 10 }}>
              {reached ? (
                <View style={{ minHeight: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' }}>
                  <Text variant="label" color={INK} style={{ fontSize: 16 }}>{p.level === lvl.level ? `You're V${lvl.level}` : `V${lvl.level} reached`}</Text>
                </View>
              ) : (
                <Button title={`Buy ${U.spend}`} variant="gold" onPress={() => router.push('/wallet')} style={{ minHeight: 54 }} />
              )}
              <Text variant="caption" color={FAINT} style={{ textAlign: 'center' }}>
                {reached ? `${units(data ?? 0)} bought so far.` : `${units(Math.max(0, lvl.need - (data ?? 0)))} more to reach V${lvl.level}.`} VIP privileges are coming soon.
              </Text>
            </View>
          </View>
        </ScrollView>
      </StateView>
    </LinearGradient>
  );
}

function LevelCard({ level, width, current, reached }: { level: SvipLevel; width: number; current: boolean; reached: boolean }) {
  return (
    <LinearGradient colors={level.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ width, height: 176, borderRadius: 26, padding: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }}>
      <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.12)' }}>
        <Text variant="caption" color={INK}>{current ? 'Your level' : reached ? 'Reached' : `${level.need.toLocaleString()} ${U.spend}`}</Text>
      </View>
      <Text color={INK} style={{ fontFamily: fonts.brand, fontSize: 52, lineHeight: 60, marginTop: 6, fontStyle: 'italic' }}>V{level.level}</Text>
      <Text color={MUTED} numberOfLines={2} style={{ maxWidth: width * 0.58 }}>{level.tagline}</Text>
      {/* Our own gem: a large diamond in the level's metal, with a soft glow. */}
      <View style={{ position: 'absolute', right: 12, top: 18, width: 130, height: 130, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: level.gem, opacity: 0.18 }} />
        <Ionicons name="diamond" size={92} color={level.gem} />
      </View>
    </LinearGradient>
  );
}
