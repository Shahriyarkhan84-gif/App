import { useClerk, useSignIn } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { AuthShell, clerkErrorMessage, Field, FormError, pendingTaskMessage } from './AuthForm';
import { OtpInput } from './OtpInput';
import { Button } from './ui';

type Strategy = 'email_code' | 'phone_code' | 'totp' | 'backup_code';

const COPY: Record<Strategy, { title: string; subtitle: (to?: string) => string; label: string }> = {
  email_code: { title: 'Check your email', subtitle: (to) => `To keep your account safe, enter the code we sent to ${to ?? 'your email'}.`, label: 'Verification code' },
  phone_code: { title: 'Check your phone', subtitle: (to) => `Enter the code we sent to ${to ?? 'your phone'}.`, label: 'Verification code' },
  totp: { title: 'Two-step verification', subtitle: () => 'Enter the 6-digit code from your authenticator app.', label: 'Authenticator code' },
  backup_code: { title: 'Two-step verification', subtitle: () => 'Enter one of your backup codes.', label: 'Backup code' },
};

/**
 * The second sign-in step Clerk asks for after a correct password: its new-device check (a code
 * emailed to the user) or the account's two-step verification. Shown by sign-in and password reset
 * when the attempt comes back `needs_second_factor`. Prefers an emailed code, then SMS, then an
 * authenticator app, then a backup code.
 */
export function SecondFactorStep({ onBack }: { onBack: () => void }) {
  const { signIn, setActive } = useSignIn();
  const clerk = useClerk();
  const factors = signIn?.supportedSecondFactors ?? [];
  const factor =
    factors.find((f) => f.strategy === 'email_code') ??
    factors.find((f) => f.strategy === 'phone_code') ??
    factors.find((f) => f.strategy === 'totp') ??
    factors.find((f) => f.strategy === 'backup_code');
  const strategy = factor?.strategy as Strategy | undefined;
  const sentTo = factor && 'safeIdentifier' in factor ? factor.safeIdentifier : undefined;

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sent = useRef(false);

  const send = async () => {
    if (!signIn || !factor) return;
    try {
      if (factor.strategy === 'email_code') await signIn.prepareSecondFactor({ strategy: 'email_code', emailAddressId: factor.emailAddressId });
      else if (factor.strategy === 'phone_code') await signIn.prepareSecondFactor({ strategy: 'phone_code', phoneNumberId: factor.phoneNumberId });
    } catch (err) {
      setError(clerkErrorMessage(err));
    }
  };

  // Emailed and SMS codes are sent once when the step opens; authenticator and backup codes need nothing sent.
  useEffect(() => {
    if (sent.current || (strategy !== 'email_code' && strategy !== 'phone_code')) return;
    sent.current = true;
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy]);

  const verify = async (value = code) => {
    if (!signIn || !strategy) return;
    setError(null);
    setLoading(true);
    try {
      const attempt = await signIn.attemptSecondFactor({ strategy, code: value.trim() });
      if (attempt.status !== 'complete') return setError('That code could not be confirmed. Please try again.');
      await setActive!({ session: attempt.createdSessionId });
      if (clerk.session?.currentTask) return setError(pendingTaskMessage(clerk.session.currentTask));
      router.replace('/');
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (!strategy) {
    return (
      <AuthShell title="Verification needed" subtitle="Your account needs a sign-in step we can't show here.">
        <FormError message="Please contact support so we can help you sign in." />
        <Button title="Back" variant="secondary" onPress={onBack} />
      </AuthShell>
    );
  }

  const copy = COPY[strategy];
  const isBackup = strategy === 'backup_code';
  return (
    <AuthShell title={copy.title} subtitle={copy.subtitle(sentTo)}>
      {isBackup ? (
        // Backup codes contain letters, so they use a normal text field.
        <Field label={copy.label} value={code} onChangeText={(v) => { setCode(v); setError(null); }} autoCapitalize="none" autoCorrect={false} />
      ) : (
        <OtpInput
          label={copy.label}
          value={code}
          onChange={(v) => {
            setCode(v);
            setError(null);
          }}
          onComplete={(v) => void verify(v)}
          error={!!error}
          disabled={loading}
        />
      )}
      <FormError message={error} />
      <Button title="Verify" loading={loading} disabled={code.trim().length < 6} onPress={() => void verify()} />
      {(strategy === 'email_code' || strategy === 'phone_code') && (
        <Button title="Resend code" variant="secondary" disabled={loading} onPress={() => void send()} />
      )}
      <Button title="Back" variant="ghost" disabled={loading} onPress={onBack} />
    </AuthShell>
  );
}
