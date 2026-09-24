import { getLocales } from 'expo-localization';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Platform } from 'react-native';

import { startHostVerification } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import type { VerificationStatus } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

import { Button, Card, Text } from './ui';

const COPY: Record<Exclude<VerificationStatus, 'approved'>, { title: string; body: string; cta?: string }> = {
  unverified: {
    title: 'Verify your identity',
    body: 'Before going live, hosts confirm their identity with a quick ID scan and selfie (about 2 minutes). Your documents are handled by our verification partner, Didit.',
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

/** Opens Didit's hosted ID + selfie check and calls onDone when the user comes back. */
export function useStartVerification(onDone: () => void) {
  const supabase = useSupabase();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const returnTo = Linking.createURL('/verify-return');
      const { url } = await startHostVerification(supabase, returnTo, getLocales()[0]?.languageCode ?? undefined);
      if (Platform.OS === 'web') window.location.assign(url);
      else await WebBrowser.openAuthSessionAsync(url, returnTo);
      onDone();
    } catch (e) {
      Alert.alert('Verification', friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return { start, busy };
}

/** Didit identity verification for hosts (shown until approved). */
export function HostVerificationCard({ status, onChanged }: { status: Exclude<VerificationStatus, 'approved'>; onChanged: () => void }) {
  const { c } = useTheme();
  const { start, busy } = useStartVerification(onChanged);
  const copy = COPY[status];

  return (
    <Card style={{ borderColor: status === 'declined' ? c.danger : c.primary }}>
      <Text variant="h3">{copy.title}</Text>
      <Text muted>{copy.body}</Text>
      {copy.cta && <Button title={copy.cta} onPress={start} loading={busy} />}
      {status === 'in_review' && <Button title="Refresh status" variant="secondary" onPress={onChanged} />}
      <Button title="How hosting works" variant="ghost" size="sm" onPress={() => router.push('/hosting')} />
    </Card>
  );
}
