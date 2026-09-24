import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { StateView } from '@/components/StateView';
import { Button, Card, Row, Screen, Text } from '@/components/ui';
import { useAsync, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';

type Summary = { headline: string; summary: string; tips: string[] };

export default function StreamSummaryScreen() {
  const { streamId } = useLocalSearchParams<{ streamId: string }>();
  const supabase = useSupabase();
  const [ai, setAi] = useState<Summary | null>(null);

  const stream = useAsync(async () => {
    const { data, error } = await supabase.from('streams').select('*').eq('id', streamId).single();
    if (error) throw error;
    return data as { started_at: string; ended_at: string; peak_viewers: number; gift_coins: number; ai_summary: Summary | null };
  }, [streamId]);

  // The Creator Assist agent writes ai_summary shortly after the stream ends.
  useRealtime('streams', `id=eq.${streamId}`, (p) => setAi((p.new as { ai_summary: Summary | null }).ai_summary), !!streamId);
  const coaching = ai ?? stream.data?.ai_summary ?? null;

  const s = stream.data;
  const minutes = s ? Math.max(1, Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000)) : 0;

  return (
    <Screen edges={[]}>
      <StateView state={s ? { kind: 'success' } : stream.error ? { kind: 'error', error: stream.error, onRetry: stream.reload } : { kind: 'loading' }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          <Row style={{ justifyContent: 'space-around' }}>
            <Metric label="Minutes" value={minutes} />
            <Metric label="Peak viewers" value={s?.peak_viewers ?? 0} />
            <Metric label="Gift coins" value={s?.gift_coins ?? 0} />
          </Row>
          <Card>
            <Text variant="label" muted>AI creator assist</Text>
            {coaching ? (
              <>
                <Text variant="h3">{coaching.headline}</Text>
                <Text>{coaching.summary}</Text>
                {coaching.tips.map((t, i) => <Text key={i} muted>• {t}</Text>)}
              </>
            ) : (
              <Text muted>Your coach is reviewing the stream… this usually takes under a minute.</Text>
            )}
          </Card>
          <Button title="Done" onPress={() => router.replace('/create')} />
        </ScrollView>
      </StateView>
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card style={{ alignItems: 'center', minWidth: 100 }}>
      <Text variant="h2">{value.toLocaleString()}</Text>
      <Text variant="caption" muted>{label}</Text>
    </Card>
  );
}
