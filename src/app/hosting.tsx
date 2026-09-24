import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, ScrollView } from 'react-native';

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


        <Button title={cta.title} onPress={cta.onPress} loading={cta.loading} disabled={offline} />
        {offline && <Text variant="caption" muted>You need a connection to continue.</Text>}

        <Section title="Your privacy">
          <Text muted>Didit, our verification partner, processes your ID and selfie. Zynalive only receives the result (approved or not) and the document type — never your ID photos or selfie.</Text>
        </Section>
      </ScrollView>
    </Screen>
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
