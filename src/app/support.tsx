import { useAuth } from '@clerk/clerk-expo';
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { resolveState, StateView } from '@/components/StateView';
import { Button, Card, Input, Row, Screen, Text } from '@/components/ui';
import { Alert } from '@/lib/alert';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useFocusedAsync, useOffline, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

const FAQ = [
  { q: 'How do I become a host?', a: 'Profile → Verification for hosting. Enter your details, CNIC photos and your agency’s 4-digit code. Verified hosts are approved instantly.' },
  { q: 'Where do I get an agency code?', a: 'Ask the agency you host with. Every agency has one permanent 4-digit code.' },
  { q: 'How long do withdrawals take?', a: 'Withdrawals are reviewed by our team first; you get a notification when yours is paid.' },
  { q: 'I was charged but got no coins', a: 'Coins are added when the payment is confirmed. If it takes longer than 10 minutes, send us a message below.' },
];

type Ticket = { id: string; subject: string; body: string; status: string; ai_reply: string | null; created_at: string };

export default function SupportScreen() {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const { c } = useTheme();
  const offline = useOffline();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

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
        <Row gap={12} style={{ padding: 16, borderRadius: 18, backgroundColor: c.violetSurface, borderWidth: 1, borderColor: c.violetBorder }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="sparkles" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label">Ask AI support</Text>
            <Text variant="caption" muted>Instant answers, 24/7. A person takes over if needed.</Text>
          </View>
        </Row>

        <View style={{ gap: 8 }}>
          <Text variant="h3">Popular questions</Text>
          <View style={{ borderRadius: 18, backgroundColor: c.surface, overflow: 'hidden' }}>
            {FAQ.map((f, i) => (
              <Pressable
                key={f.q}
                onPress={() => setOpen(open === i ? null : i)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open === i }}
                style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: c.divider }}
              >
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ flex: 1, fontSize: 15 }}>{f.q}</Text>
                  <Ionicons name={open === i ? 'chevron-down' : 'chevron-forward'} size={18} color={c.textFaint} />
                </Row>
                {open === i && <Text muted>{f.a}</Text>}
              </Pressable>
            ))}
          </View>
        </View>

        <Card>
          <Text variant="h3">Still need help?</Text>
          <Input label="Subject" value={subject} onChangeText={setSubject} maxLength={120} />
          <Input label="Details" value={body} onChangeText={setBody} multiline style={{ minHeight: 100, paddingTop: 12 }} maxLength={4000} />
          <Button title="Send to support" onPress={submit} loading={sending} disabled={subject.trim().length < 3 || body.trim().length < 5 || offline} />
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
