import { ScrollView, View } from 'react-native';

import { EventRow } from '@/components/EventRow';
import { FadeIn, stagger } from '@/components/Motion';
import { resolveState, StateView } from '@/components/StateView';
import { Screen, Text } from '@/components/ui';
import { eventPhase, fetchEvents, fetchMyRegion, type EventPhase } from '@/lib/events';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

const SECTIONS: { phase: EventPhase; title: string }[] = [
  { phase: 'live', title: 'Live now' },
  { phase: 'upcoming', title: 'Coming up' },
  { phase: 'ended', title: 'Past events' },
];

/** Engagement events for the viewer's region (plus global ones). */
export default function EventsScreen() {
  const supabase = useSupabase();
  const offline = useOffline();
  const { hPadding } = useTheme();

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const region = await fetchMyRegion(supabase);
    return { region, events: await fetchEvents(supabase, region?.code ?? null) };
  }, []);

  const state = resolveState({
    offline, loading, error, data, onRetry: reload,
    isEmpty: (d) => d.events.length === 0,
    empty: { title: 'No events right now', body: 'Gifting races and PK battle leagues show up here.' },
  });

  return (
    <Screen edges={[]}>
      <StateView state={state}>
        <ScrollView contentContainerStyle={{ padding: hPadding, gap: 20, maxWidth: 900, width: '100%', alignSelf: 'center' }}>
          {data?.region && <Text variant="caption" muted>Showing events for {data.region.name}</Text>}
          {SECTIONS.map(({ phase, title }) => {
            const list = (data?.events ?? []).filter((e) => eventPhase(e) === phase);
            if (!list.length) return null;
            return (
              <View key={phase} style={{ gap: 10 }}>
                <Text variant="h3">{title}</Text>
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
