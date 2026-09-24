import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { useStartVerification } from '@/components/HostVerificationCard';
import { FadeIn } from '@/components/Motion';
import { StateView } from '@/components/StateView';
import { Button, Card, HostBadge, Row, Screen, Text, type IconName } from '@/components/ui';
import { useAnalytics } from '@/lib/analytics';
import { rpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useOffline, useRealtime } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

type StepState = 'done' | 'current' | 'todo';

const REQUIREMENTS: { icon: IconName; text: string }[] = [
  { icon: 'person-outline', text: 'You are 18 or older' },
  { icon: 'card-outline', text: 'A valid original ID: CNIC / national ID card, passport or driving licence (no photocopies or screenshots)' },
  { icon: 'camera-outline', text: 'A phone with a working front camera' },
  { icon: 'sunny-outline', text: 'Good light and about 2 minutes' },
];

const TIPS = [
  'Use your own ID — the name must match you.',
  'No glare: tilt the card away from lamps and windows.',
  'Remove sunglasses, hats and masks for the selfie.',
  'Hold the phone steady until each capture turns green.',
];

/** Hosting instructions: how to become a verified host with Didit, with progress and the next action. */
export default function HostingScreen() {
  const supabase = useSupabase();
  const { c } = useTheme();
  const track = useAnalytics();
  const offline = useOffline();
  const { profile, host, isHost, reload } = useProfile();
  const [becoming, setBecoming] = useState(false);
  const { start, busy } = useStartVerification(() => void reload());

  // Didit results arrive as a notification; refresh when one lands.
  useRealtime('notifications', profile ? `user_id=eq.${profile.id}` : undefined, (p) => {
    if ((p.new as { type?: string }).type === 'verification') void reload();
  }, !!profile);

  if (!profile) return <Screen edges={[]}><StateView state={offline ? { kind: 'offline', onRetry: reload } : { kind: 'loading' }} /></Screen>;

  const status = host?.verification_status ?? 'unverified';
  const approved = status === 'approved';
  const steps: { title: string; body: string; state: StepState }[] = [
    {
      title: 'Verify your identity with Didit',
      body: 'Quick ID scan and selfie in a secure Didit page.',
      state: status === 'in_review' || approved ? 'done' : 'current',
    },
    { title: 'Review', body: 'Most checks finish in minutes; some go to manual review (usually within a day).', state: approved ? 'done' : status === 'in_review' ? 'current' : 'todo' },
    { title: 'Host badge unlocked', body: 'Go live, receive gifts (you keep 90%) and withdraw earnings.', state: approved ? 'done' : 'todo' },
  ];

  // Becoming a host (Host ID) happens automatically right before the first Didit check.
  const becomeHostAndVerify = async () => {
    setBecoming(true);
    try {
      await rpc(supabase, 'become_host');
      track('became_host', {});
      await reload();
    } catch (e) {
      Alert.alert('Could not continue', friendlyError(e));
      return;
    } finally {
      setBecoming(false);
    }
    await start();
  };

  const cta = !isHost
    ? { title: 'Start verification with Didit', onPress: becomeHostAndVerify, loading: becoming || busy }
    : approved
      ? { title: 'Go live', onPress: () => router.push('/create'), loading: false }
      : status === 'in_review'
        ? { title: 'Refresh status', onPress: () => void reload(), loading: false }
        : { title: status === 'pending' ? 'Continue verification' : status === 'declined' ? 'Try again with Didit' : 'Start verification with Didit', onPress: start, loading: busy };

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <FadeIn style={{ gap: 6 }}>
          <Row gap={8}>
            <Text variant="h1">Become a host</Text>
            {approved && <HostBadge />}
          </Row>
          <Text muted>Every host on Zynalive is identity-verified. It keeps viewers safe and protects your earnings.</Text>
        </FadeIn>

        <Section title="What you need">
          {REQUIREMENTS.map((r) => (
            <Row key={r.text} gap={10} style={{ alignItems: 'flex-start' }}>
              <Ionicons name={r.icon} size={20} color={c.gold} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1 }}>{r.text}</Text>
            </Row>
          ))}
        </Section>

        <Section title="Tips to pass first time">
          {TIPS.map((t) => (
            <Row key={t} gap={10} style={{ alignItems: 'flex-start' }}>
              <Ionicons name="checkmark-circle-outline" size={20} color={c.success} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1 }}>{t}</Text>
            </Row>
          ))}
        </Section>

        {status === 'declined' && (
          <Card style={{ borderColor: c.danger }}>
            <Text variant="label" color={c.danger}>Your last check wasn’t approved</Text>
            <Text muted>Usually the ID was blurred, cut off or expired, or the selfie was too dark. Check the tips above and try again.</Text>
          </Card>
        )}

        <FadeIn delay={80}>
          <Card style={{ gap: 0, paddingVertical: 8 }}>
            {steps.map((s, i) => <Step key={s.title} n={i + 1} last={i === steps.length - 1} {...s} />)}
          </Card>
        </FadeIn>

        <Button title={cta.title} onPress={cta.onPress} loading={cta.loading} disabled={offline} />
        {offline && <Text variant="caption" muted>You need a connection to continue.</Text>}

        <Section title="Your privacy">
          <Text muted>Didit, our verification partner, processes your ID and selfie. Zynalive only receives the result (approved or not) and the document type — never your ID photos or selfie.</Text>
        </Section>
      </ScrollView>
    </Screen>
  );
}

function Step({ n, title, body, state, last }: { n: number; title: string; body: string; state: StepState; last: boolean }) {
  const { c } = useTheme();
  const color = state === 'done' ? c.success : state === 'current' ? c.primary : c.textFaint;
  return (
    <View style={{ flexDirection: 'row', gap: 12 }} accessibilityLabel={`Step ${n}, ${title}, ${state === 'done' ? 'done' : state === 'current' ? 'current step' : 'not started'}`}>
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, marginTop: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: state === 'todo' ? c.surfaceRaised : color }}>
          {state === 'done' ? <Ionicons name="checkmark" size={16} color="#fff" /> : <Text variant="caption" color={state === 'current' ? '#fff' : c.textMuted} style={{ fontWeight: '700' }}>{n}</Text>}
        </View>
        {!last && <View style={{ flex: 1, width: 2, backgroundColor: state === 'done' ? c.success : c.divider, marginVertical: 4 }} />}
      </View>
      <View style={{ flex: 1, paddingVertical: 8, gap: 2 }}>
        <Text variant="label" color={state === 'todo' ? c.textMuted : c.text}>{title}</Text>
        <Text variant="bodySmall" muted>{body}</Text>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={{ gap: 12 }}>
      <Text variant="h3">{title}</Text>
      {children}
    </Card>
  );
}
