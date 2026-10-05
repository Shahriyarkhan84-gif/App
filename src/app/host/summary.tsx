import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';

import { FadeIn } from '@/components/Motion';
import { StateView } from '@/components/StateView';
import { Button, Card, Row, Screen, Text, type IconName } from '@/components/ui';
import { useAsync, useRealtime } from '@/lib/hooks';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

type Summary = { headline: string; summary: string; tips: string[] };

export default function StreamSummaryScreen() {
  const { c } = useTheme();
  const { streamId } = useLocalSearchParams<{ streamId: string }>();
  const supabase = useSupabase();
  const [ai, setAi] = useState<Summary | null>(null);

  const stream = useAsync(async () => {
    if (!streamId) return null;
    const { data, error } = await supabase.from('streams').select('*').eq('id', streamId).single();
    if (error) throw error;
    return data as { title: string | null; started_at: string; ended_at: string; peak_viewers: number; gift_coins: number; ai_summary: Summary | null };
  }, [streamId]);

  // The Creator Assist agent writes ai_summary shortly after the stream ends.
  useRealtime('streams', `id=eq.${streamId}`, (p) => setAi((p.new as { ai_summary: Summary | null }).ai_summary), !!streamId);
  const coaching = ai ?? stream.data?.ai_summary ?? null;
  // Fallback for projects without realtime on streams: check every 15 s until the coach is done.
  const reloadStream = stream.reload;
  useEffect(() => {
    if (coaching || !stream.data) return;
    const t = setInterval(reloadStream, 15000);
    return () => clearInterval(t);
  }, [coaching, stream.data, reloadStream]);
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const s = stream.data;
  const minutes = s ? Math.max(1, Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000)) : 0;

  return (
    <Screen edges={[]}>
      <StateView state={s ? { kind: 'success' }
        : stream.data === null ? { kind: 'empty', title: 'Summary not found', body: 'This stream summary is no longer available.', action: { title: 'Back', onPress: leave } }
        : stream.error ? { kind: 'error', error: stream.error, onRetry: stream.reload } : { kind: 'loading' }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          <FadeIn style={{ borderRadius: 22, overflow: 'hidden' }}>
            <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 20, gap: 4 }}>
              <Row gap={8}>
                <Ionicons name="checkmark-circle" size={22} color="#fff" />
                <Text variant="h1" color="#fff">Stream ended</Text>
              </Row>
              <Text color="rgba(255,255,255,0.85)">{s?.title ? `${s.title} · ` : ''}{minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`}</Text>
            </LinearGradient>
          </FadeIn>

          <FadeIn delay={80} style={{ flexDirection: 'row', gap: 10 }}>
            <Metric icon="time-outline" label="Minutes" value={minutes} />
            <Metric icon="eye-outline" label="Peak viewers" value={s?.peak_viewers ?? 0} />
            <Metric icon="gift-outline" label="Gift coins" value={s?.gift_coins ?? 0} />
          </FadeIn>

          <FadeIn delay={160}>
            <Card style={{ gap: 12 }}>
              <Row gap={8}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.violetSurface, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="sparkles" size={16} color={c.violetText} />
                </View>
                <Text variant="label" muted>AI creator assist</Text>
              </Row>
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
          </FadeIn>

          <Button title={router.canGoBack() ? 'Done' : 'Back to home'} onPress={leave} />
          <Button
            title="Share highlights"
            variant="secondary"
            onPress={() => Share.share({ message: `I just went live on Zynalive — ${s?.peak_viewers ?? 0} peak viewers and ${(s?.gift_coins ?? 0).toLocaleString()} gift coins!` })}
          />
        </ScrollView>
      </StateView>
    </Screen>
  );
}

function Metric({ icon, label, value }: { icon: IconName; label: string; value: number }) {
  const { c } = useTheme();
  return (
    <Card style={{ flex: 1, alignItems: 'center', gap: 8 }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.goldSurface, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={16} color={c.gold} />
      </View>
      <Text variant="h2">{value.toLocaleString()}</Text>
      <Text variant="caption" muted style={{ textAlign: 'center' }}>{label}</Text>
    </Card>
  );
}
