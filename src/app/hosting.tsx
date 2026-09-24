import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';

import { FadeIn } from '@/components/Motion';
import { StateView } from '@/components/StateView';
import { Button, Card, HostBadge, Row, Screen, Text, type IconName } from '@/components/ui';
import { useOffline, useRealtime } from '@/lib/hooks';
import { useProfile } from '@/lib/profile';
import { useTheme } from '@/lib/theme';

const REQUIREMENTS: { icon: IconName; text: string }[] = [
  { icon: 'person-outline', text: 'You are 18 or older' },
  { icon: 'card-outline', text: 'Your own original CNIC — not expired, no photocopies or screenshots' },
  { icon: 'call-outline', text: 'A Pakistani mobile number (+92 3XX XXXXXXX)' },
  { icon: 'business-outline', text: 'An agency code from the Zynalive agency you host with — ask your agency for it, you can\'t continue without one' },
  { icon: 'camera-outline', text: 'A phone camera for 3 photos: CNIC front, CNIC back, and your face holding your CNIC' },
  { icon: 'sunny-outline', text: 'Good light and about 3 minutes' },
];

const TIPS = [
  'Type your name and CNIC number exactly as printed on the card.',
  'Enter the agency code exactly as your agency gave it (e.g. AG-1A2B3C).',
  'No glare: tilt the card away from lamps and windows, and fit all 4 corners in the photo.',
  'For the face photo, hold your CNIC next to your face; remove sunglasses, hats and masks.',
];

/** Hosting instructions: how to become a verified host with Didit, with progress and the next action. */
export default function HostingScreen() {
  const { c } = useTheme();
  const offline = useOffline();
  const { profile, host, isHost, reload } = useProfile();

  // Didit results arrive as a notification; refresh when one lands.
  useRealtime('notifications', profile ? `user_id=eq.${profile.id}` : undefined, (p) => {
    if ((p.new as { type?: string }).type === 'verification') void reload();
  }, !!profile);

  if (!profile) return <Screen edges={[]}><StateView state={offline ? { kind: 'offline', onRetry: reload } : { kind: 'loading' }} /></Screen>;

  const status = host?.verification_status ?? 'unverified';
  const approved = status === 'approved';

  const openDidit = () => router.push('/verify-form');
  const cta = !isHost
    ? { title: 'Continue verification', onPress: openDidit, loading: false }
    : approved
      ? { title: 'Go live', onPress: () => router.push('/create'), loading: false }
      : status === 'in_review'
        ? { title: 'Refresh status', onPress: () => void reload(), loading: false }
        : { title: status === 'declined' ? 'Try again with Didit' : 'Continue verification', onPress: openDidit, loading: false };

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
            <Text muted>Usually a CNIC photo was blurred, cut off or expired, the face photo was too dark, or the details didn’t match the card. Check the tips above and try again.</Text>
          </Card>
        )}


        <Button title={cta.title} onPress={cta.onPress} loading={cta.loading} disabled={offline} />
        {offline && <Text variant="caption" muted>You need a connection to continue.</Text>}

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
