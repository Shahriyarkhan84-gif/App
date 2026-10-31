import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { View } from 'react-native';

import { PressScale } from '@/components/Motion';
import { glassShadow, Row, Text } from '@/components/ui';
import { eventPhase, fetchEvents, fetchMyRegion, timeLeft, type AppEvent, type EventPhase } from '@/lib/events';
import { useFocusedAsync } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export function EventRow({ event, phase }: { event: AppEvent; phase: EventPhase }) {
  const { c, radius } = useTheme();
  const { t } = useI18n();
  const when = phase === 'live' ? t('events.endsIn', { time: timeLeft(event.ends_at) })
    : phase === 'upcoming' ? t('events.startsIn', { time: timeLeft(event.starts_at) }) : t('events.ended');
  const live = phase === 'live';
  if (live) {
    // Aurora dark: the event running now is a big rose-to-violet hero card.
    return (
      <PressScale onPress={() => router.push(`/events/${event.id}`)} accessibilityRole="button" accessibilityLabel={`${event.title}, live now`} scaleTo={0.98}>
        <LinearGradient colors={['#BE123C', '#9D174D', '#6D28D9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ padding: 18, borderRadius: radius[24], gap: 6, shadowColor: '#E11D48', shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } }}>
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, height: 22, borderRadius: 11, backgroundColor: c.live }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' }} />
            <Text variant="caption" color="#FFFFFF" style={{ fontSize: 11, fontWeight: '700' }}>{t('events.live').toUpperCase()}</Text>
          </View>
          <Text variant="h1" color="#FFFFFF" numberOfLines={2}>{event.title}</Text>
          <Text variant="bodySmall" color="rgba(255,255,255,0.9)">{t(`events.kind.${event.kind}`)}</Text>
          <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <Text variant="label" color={c.goldText}>{when}</Text>
            <View style={{ paddingHorizontal: 18, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF', justifyContent: 'center' }}>
              <Text variant="label" color="#4C0519">Join</Text>
            </View>
          </Row>
        </LinearGradient>
      </PressScale>
    );
  }
  return (
    <PressScale onPress={() => router.push(`/events/${event.id}`)} accessibilityRole="button" accessibilityLabel={event.title} scaleTo={0.98}>
      <Row gap={14} style={{ padding: 12, borderRadius: radius[20], backgroundColor: c.surface, borderWidth: 1, borderColor: c.glassBorder, ...glassShadow }}>
        <LinearGradient colors={phase === 'upcoming' ? c.accentGradient : [c.surfaceRaised, c.surfaceRaised]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ width: 60, height: 60, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={event.kind === 'pk_battle' ? 'flash' : 'megaphone'} size={24} color={phase === 'upcoming' ? c.primaryText : c.textMuted} />
        </LinearGradient>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="h3" numberOfLines={1}>{event.title}</Text>
          <Text variant="bodySmall" muted>{t(`events.kind.${event.kind}`)} · {when}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={c.textFaint} />
      </Row>
    </PressScale>
  );
}

/** Home banner for the event running now in the viewer's region (renders nothing otherwise). */
export function LiveEventBanner() {
  const supabase = useSupabase();
  const { data } = useFocusedAsync(async () => {
    const region = await fetchMyRegion(supabase);
    return (await fetchEvents(supabase, region?.code ?? null)).find((e) => eventPhase(e) === 'live') ?? null;
  }, []);
  if (!data) return null;
  return <EventRow event={data} phase="live" />;
}
