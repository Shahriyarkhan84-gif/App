import { useAuth } from '@clerk/clerk-expo';
import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Card, Row, Screen, Text } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useFocusedAsync, useOffline } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

/** Groups people may switch off (the server decides; see set_notification_muted). */
const GROUPS = [
  { id: 'lives', title: 'Lives', body: 'When someone you follow goes live.' },
  { id: 'messages', title: 'Messages', body: 'New private messages.' },
  { id: 'pk_battles', title: 'PK battles', body: 'Battle invites, accepted invites and results.' },
  { id: 'events', title: 'Events & rewards', body: 'Rewards from events you took part in.' },
] as const;

/** Settings → Notifications: switch optional notification groups on or off. */
export default function NotificationSettingsScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const offline = useOffline();
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, reload } = useFocusedAsync<string[]>(async () => {
    const { data, error } = await supabase.from('notification_settings').select('muted').eq('user_id', userId!).maybeSingle();
    if (error) throw error;
    return (data?.muted as string[] | undefined) ?? [];
  }, [userId], 'notification-settings');

  const toggle = async (group: string, on: boolean) => {
    setBusy(group);
    try {
      await rpc(supabase, 'set_notification_muted', { p_group: group, p_muted: !on });
      reload();
    } catch (e) {
      Alert.alert('Could not save', friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <StateView state={resolveState({ offline, loading, error, data, onRetry: reload })}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
            {GROUPS.map((g, i) => {
              const on = !(data ?? []).includes(g.id);
              return (
                <Row key={g.id} style={{ padding: 16, borderBottomWidth: i === GROUPS.length - 1 ? 0 : 1, borderBottomColor: c.divider }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="label">{g.title}</Text>
                    <Text variant="caption" muted>{g.body}</Text>
                  </View>
                  <Switch value={on} onValueChange={(v) => void toggle(g.id, v)} disabled={busy === g.id}
                    trackColor={{ true: c.primary, false: c.divider }} thumbColor="#FFFFFF" accessibilityLabel={g.title} />
                </Row>
              );
            })}
          </Card>
          <Text variant="caption" faint>Payments, withdrawals, verification and account notices are always on. These switches cover the app and phone alerts; to stop all phone alerts, turn notifications off for Zynalive in your phone&apos;s settings.</Text>
        </ScrollView>
      </StateView>
    </Screen>
  );
}
