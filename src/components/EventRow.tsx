import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { View } from 'react-native';

import { PressScale } from '@/components/Motion';
import { Row, Text } from '@/components/ui';
import { eventPhase, fetchEvents, fetchMyRegion, timeLeft, type AppEvent, type EventPhase } from '@/lib/events';
import { useFocusedAsync } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export function EventRow({ event, phase }: { event: AppEvent; phase: EventPhase }) {
  const { c, radius } = useTheme();
  const when = phase === 'live' ? `Ends in ${timeLeft(event.ends_at)}` : phase === 'upcoming' ? `Starts in ${timeLeft(event.starts_at)}` : 'Ended';
  return (
    <PressScale onPress={() => router.push(`/events/${event.id}`)} accessibilityRole="button" accessibilityLabel={event.title} scaleTo={0.98}>
      <Row style={{ padding: 16, borderRadius: radius[16] + 2, backgroundColor: phase === 'live' ? c.goldSurface : c.surface, borderWidth: 1, borderColor: phase === 'live' ? c.goldBorder : c.divider }}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: phase === 'live' ? c.gold : c.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={event.kind === 'pk_battle' ? 'flash' : 'gift'} size={22} color={phase === 'live' ? c.onGold : c.textMuted} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="h3" numberOfLines={1}>{event.title}</Text>
          <Text variant="bodySmall" muted>{event.kind === 'pk_battle' ? 'PK battle league' : 'Gifting race'} · {when}</Text>
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
