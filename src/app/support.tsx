import { useAuth } from '@clerk/clerk-expo';
import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Button, Card, Input, Screen, Text } from '@/components/ui';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

type Ticket = { id: string; subject: string; body: string; status: string; ai_reply: string | null; created_at: string };

export default function SupportScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const offline = useOffline();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const { data, error, loading, reload } = useFocusedAsync(async () => {
    const { data, error } = await supabase.from('support_tickets').select('*').eq('user_id', userId!).order('created_at', { ascending: false });
    if (error) throw error;
    return data as Ticket[];
  }, [userId]);
  useRealtime('notifications', `user_id=eq.${userId}`, (p) => {
    if ((p.new as { type?: string }).type === 'support') reload();
  });

  const submit = async () => {
    setSending(true);
    try {
      await rpc(supabase, 'create_support_ticket', { p_subject: subject.trim(), p_body: body.trim() });
      setSubject('');
      setBody('');
      reload();
    } catch (e) {
      Alert.alert('Could not send', friendlyError(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <Card>
          <Text variant="h3">How can we help?</Text>
          <Input label="Subject" value={subject} onChangeText={setSubject} maxLength={120} />
          <Input label="Details" value={body} onChangeText={setBody} multiline style={{ minHeight: 100, paddingTop: 12 }} maxLength={4000} />
          <Button title="Send" onPress={submit} loading={sending} disabled={subject.trim().length < 3 || body.trim().length < 5 || offline} />
          <Text variant="caption" muted>Our AI assistant answers common questions within a minute; anything else goes to the team.</Text>
        </Card>
        <StateView state={resolveState({ offline, loading, error, data, onRetry: reload, isEmpty: (d) => d.length === 0, empty: { title: 'No tickets yet' } })}>
          {(data ?? []).map((t) => (
            <Card key={t.id}>
              <Text variant="label">{t.subject}</Text>
              <Text muted numberOfLines={3}>{t.body}</Text>
              {t.ai_reply ? <Text>{t.ai_reply}</Text> : <Text variant="caption" muted>Waiting for a reply…</Text>}
              <Text variant="caption" color={t.status === 'escalated' ? c.warning : c.textMuted}>{t.status === 'escalated' ? 'With our team' : t.status}</Text>
            </Card>
          ))}
        </StateView>
      </ScrollView>
    </Screen>
  );
}
