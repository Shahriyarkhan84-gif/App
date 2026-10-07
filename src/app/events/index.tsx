import { Stack } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { EventRow } from '@/components/EventRow';
import { FadeIn, stagger } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Screen, Text } from '@/components/ui';
import { eventPhase, fetchEvents, fetchMyRegion, type EventPhase } from '@/lib/events';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/en';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

const SECTIONS: { phase: EventPhase; title: MessageKey }[] = [
  { phase: 'live', title: 'events.live' },
  { phase: 'upcoming', title: 'events.upcoming' },
  { phase: 'ended', title: 'events.past' },
];

/** Engagement events for the viewer's region (plus global ones). */
export default function EventsScreen() {
  const supabase = useSupabase();
  const offline = useOffline();
  const { hPadding } = useTheme();
  const { t } = useI18n();

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const region = await fetchMyRegion(supabase);
    return { region, events: await fetchEvents(supabase, region?.code ?? null) };
  }, [], 'events');

  const state = resolveState({
    offline, loading, error, data, onRetry: reload,
    isEmpty: (d) => d.events.length === 0,
    empty: { title: t('events.empty'), body: t('events.empty.body') },
  });

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('events.title') }} />
      <StateView state={state}>
        <ScrollView contentContainerStyle={{ padding: hPadding, gap: 20, maxWidth: 900, width: '100%', alignSelf: 'center' }}>
          {data?.region && <Text variant="caption" muted>{t('events.region', { region: data.region.name })}</Text>}
          {SECTIONS.map(({ phase, title }) => {
            const list = (data?.events ?? []).filter((e) => eventPhase(e) === phase);
            if (!list.length) return null;
            return (
              <View key={phase} style={{ gap: 10 }}>
                <Text variant="h3">{t(title)}</Text>
                {list.map((e, i) => (
                  <FadeIn key={e.id} delay={stagger(i)}>
                    <EventRow event={e} phase={phase} />
                  </FadeIn>
                ))}
              </View>
            );
          })}
        </ScrollView>
      </StateView>
    </Screen>
  );
}
