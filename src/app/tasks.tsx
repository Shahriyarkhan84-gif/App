import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Button, Card, Row, Screen, Text } from '@/components/ui';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { DAILY_TASKS, liveMinutes, startOfToday, type TaskId } from '@/lib/tasks';
import { useTheme } from '@/lib/theme';

const GO: Record<TaskId, { title: string; to: '/party' | '/create' | '/(tabs)' }> = {
  follow: { title: 'Find people', to: '/party' },
  chat: { title: 'Watch a live', to: '/(tabs)' },
  gift: { title: 'Watch a live', to: '/(tabs)' },
  live: { title: 'Go live', to: '/create' },
};

/** Task center: today's tasks with real progress. Rewards are shown as coming soon. */
export default function TasksScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const offline = useOffline();
  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const since = startOfToday();
    const [follows, chats, gifts, streams] = await Promise.all([
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId!).gte('created_at', since),
      supabase.from('messages').select('*', { count: 'exact', head: true }).eq('sender_id', userId!).gte('created_at', since),
      supabase.from('gifts').select('*', { count: 'exact', head: true }).eq('sender_id', userId!).gte('created_at', since),
      supabase.from('streams').select('started_at,ended_at').eq('host_id', userId!).or(`ended_at.is.null,ended_at.gte."${since}"`),
    ]);
    for (const r of [follows, chats, gifts, streams]) if (r.error) throw r.error;
    return { follow: follows.count ?? 0, chat: chats.count ?? 0, gift: gifts.count ?? 0, live: liveMinutes(streams.data ?? [], since) } as Record<TaskId, number>;
  }, [userId], 'tasks');

  const done = data ? DAILY_TASKS.filter((t) => data[t.id] >= t.goal).length : 0;

  return (
    <Screen edges={['bottom']}>
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
        {data && (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
            <Card style={{ padding: 18, gap: 8 }}>
              <Text variant="h2">Daily tasks</Text>
              <Text muted>{done} of {DAILY_TASKS.length} done today · new tasks every day at midnight</Text>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: c.violetSurface, overflow: 'hidden' }}>
                <View style={{ width: `${Math.round((done / DAILY_TASKS.length) * 100)}%`, height: '100%', backgroundColor: c.primary }} />
              </View>
            </Card>

            <Card style={{ padding: 14, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Ionicons name="gift-outline" size={20} color={c.primary} />
              <Text muted style={{ flex: 1 }}>Rewards for tasks are coming soon.</Text>
            </Card>

            {DAILY_TASKS.map((t) => {
              const value = Math.min(data[t.id], t.goal);
              const complete = data[t.id] >= t.goal;
              return (
                <Card key={t.id} style={{ padding: 16, gap: 10 }}>
                  <Row style={{ alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="h3">{t.title}</Text>
                      <Text muted>{t.body}</Text>
                    </View>
                    {complete ? (
                      <Row gap={4}><Ionicons name="checkmark-circle" size={20} color={c.success} /><Text variant="label" color={c.success}>Done</Text></Row>
                    ) : (
                      <Text variant="label" color={c.primary}>{value}/{t.goal}{t.unit ? ` ${t.unit}` : ''}</Text>
                    )}
                  </Row>
                  <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: t.goal, now: value }} style={{ height: 6, borderRadius: 3, backgroundColor: c.violetSurface, overflow: 'hidden' }}>
                    <View style={{ width: `${Math.round((value / t.goal) * 100)}%`, height: '100%', backgroundColor: complete ? c.success : c.primary }} />
                  </View>
                  {!complete && <Button title={GO[t.id].title} variant="secondary" size="sm" onPress={() => router.push(GO[t.id].to)} style={{ alignSelf: 'flex-start' }} />}
                </Card>
              );
            })}
          </ScrollView>
        )}
      </StateView>
    </Screen>
  );
}
