import { router } from 'expo-router';

import type { VerificationStatus } from '@/lib/profile';
import { useTheme } from '@/lib/theme';

import { Button, Card, Text } from './ui';

const COPY: Record<Exclude<VerificationStatus, 'approved'>, { title: string; body: string; cta?: string }> = {
  unverified: {
    title: 'Verify your identity',
    body: 'Before going live, hosts confirm their identity with their CNIC and a face photo (about 2 minutes). Photos are checked by our verification partner, Didit.',
    cta: 'Verify identity',
  },
  pending: {
    title: 'Finish verifying',
    body: "You started verification but haven't finished. Continue where you left off, or start again.",
    cta: 'Continue verification',
  },
  in_review: {
    title: 'Verification under review',
    body: "Thanks! Our team is checking your documents — usually within a day. We'll notify you.",
  },
  declined: {
    title: "We couldn't verify you",
    body: 'Make sure your ID is valid, fully visible and not blurred, and that your face is well lit. You can try again.',
    cta: 'Try again',
  },
};

/** Didit identity verification for hosts (shown until approved). */
export function HostVerificationCard({ status, onChanged }: { status: Exclude<VerificationStatus, 'approved'>; onChanged: () => void }) {
  const { c } = useTheme();
  const copy = COPY[status];

  return (
    <Card style={{ borderColor: status === 'declined' ? c.danger : c.primary }}>
      <Text variant="h3">{copy.title}</Text>
      <Text muted>{copy.body}</Text>
      {copy.cta && <Button title={copy.cta} onPress={() => router.push('/verify-form')} />}
      {status === 'in_review' && <Button title="Refresh status" variant="secondary" onPress={onChanged} />}
      <Button title="How hosting works" variant="ghost" size="sm" onPress={() => router.push('/hosting')} />
    </Card>
  );
}
