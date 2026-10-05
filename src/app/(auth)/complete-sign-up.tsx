import { useClerk, useSignUp } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { AuthShell, clerkErrorMessage, Field, FormError, PENDING_TASK_MESSAGE, useRedirectWhenSignedIn } from '@/components/AuthForm';
import { StateView } from '@/components/StateView';
import { Button, Text } from '@/components/ui';
import { useTheme } from '@/lib/theme';

type Step = 'details' | 'phone_code' | 'email_code';

/**
 * Finishes a sign-up Clerk left at `missing_requirements`: Google/Apple (and the
 * email form) only supply some of the fields the Clerk instance requires, e.g.
 * username, phone number or password. Asks for exactly what's missing, verifies
 * the phone or email by code if needed, then activates the session.
 */
export default function CompleteSignUpScreen() {
  const { c } = useTheme();
  const { signUp, setActive, isLoaded } = useSignUp();
  const clerk = useClerk();
  useRedirectWhenSignedIn();
  const [step, setStep] = useState<Step>('details');
  const [values, setValues] = useState({ username: '', firstName: '', lastName: '', phoneNumber: '', password: '' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const missing = signUp?.missingFields ?? [];
  const needs = {
    username: missing.includes('username'),
    firstName: missing.includes('first_name'),
    lastName: missing.includes('last_name'),
    // Also when a phone was saved but never verified: the user must be able to correct it.
    phoneNumber: missing.includes('phone_number') || (signUp?.unverifiedFields ?? []).includes('phone_number'),
    password: missing.includes('password'),
  };

  // Nothing to finish (opened directly, or the sign-up expired): back to the start.
  // 'complete' is left alone: advance() is already taking the user home.
  useEffect(() => {
    const status = signUp?.status;
    if (isLoaded && status !== 'missing_requirements' && status !== 'complete') router.replace('/welcome');
  }, [isLoaded, signUp?.status]);

  /** Moves to whatever Clerk still needs after an update/verification. */
  const advance = async () => {
    const s = clerk.client?.signUp ?? signUp!;
    if (s.status === 'complete') {
      await setActive!({ session: s.createdSessionId });
      if (clerk.session?.currentTask) return setError(PENDING_TASK_MESSAGE);
      router.replace('/');
    } else if (s.unverifiedFields.includes('phone_number')) {
      await s.preparePhoneNumberVerification({ strategy: 'phone_code' });
      setCode('');
      setStep('phone_code');
    } else if (s.unverifiedFields.includes('email_address')) {
      await s.prepareEmailAddressVerification({ strategy: 'email_code' });
      setCode('');
      setStep('email_code');
    } else {
      setStep('details');
      setError(`Still needed: ${s.missingFields.join(', ').replace(/_/g, ' ')}.`);
    }
  };

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setLoading(true);
    try {
      await fn();
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const onSave = () =>
    run(async () => {
      const params = Object.fromEntries(
        (Object.keys(needs) as (keyof typeof needs)[]).filter((k) => needs[k]).map((k) => [k, k === 'phoneNumber' ? normalizePhone(values[k]) : values[k].trim()]),
      );
      await signUp!.update(params);
      await advance();
    });

  const [resent, setResent] = useState(false);
  const onResend = () =>
    run(async () => {
      if (step === 'phone_code') await signUp!.preparePhoneNumberVerification({ strategy: 'phone_code' });
      else await signUp!.prepareEmailAddressVerification({ strategy: 'email_code' });
      setResent(true);
    });

  const onVerify = () =>
    run(async () => {
      if (step === 'phone_code') await signUp!.attemptPhoneNumberVerification({ code: code.trim() });
      else await signUp!.attemptEmailAddressVerification({ code: code.trim() });
      await advance();
    });

  if (!isLoaded || signUp?.status !== 'missing_requirements') {
    // A message (e.g. Clerk holding the session on an extra step) must show instead of a spinner.
    return error ? <AuthShell title="Almost there" subtitle={error}><Button title="Back to start" variant="ghost" onPress={() => router.replace('/welcome')} /></AuthShell> : <StateView state={{ kind: 'loading' }} />;
  }

  if (step !== 'details') {
    const target = step === 'phone_code' ? (values.phoneNumber && normalizePhone(values.phoneNumber)) || 'your phone' : signUp.emailAddress ?? 'your email';
    return (
      <AuthShell title={step === 'phone_code' ? 'Check your messages' : 'Check your email'} subtitle={`We sent a 6-digit code to ${target}.`}>
        <Field label="Verification code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" placeholder="123456" />
        <FormError message={error} />
        <Button title="Verify & continue" loading={loading} disabled={code.trim().length < 6} onPress={onVerify} />
        <Button title={resent ? 'Code sent again' : 'Resend code'} variant="ghost" disabled={loading || resent} onPress={onResend} />
        <Button title="Change details" variant="ghost" onPress={() => { setResent(false); setStep('details'); }} />
      </AuthShell>
    );
  }

  const set = (k: keyof typeof values) => (v: string) => setValues((prev) => ({ ...prev, [k]: v }));
  // Usernames follow the Clerk rule (8–20 characters), checked here so the user isn't surprised later.
  const usernameOk = !needs.username || (values.username.trim().length >= 8 && values.username.trim().length <= 20);
  const ready = usernameOk && (Object.keys(needs) as (keyof typeof needs)[]).every((k) => !needs[k] || values[k].trim().length > 0);

  return (
    <AuthShell title="Finish your profile" subtitle="Just a few more details to create your Zynalive account.">
      {needs.firstName && <Field label="First name" value={values.firstName} onChangeText={set('firstName')} autoCapitalize="words" autoComplete="given-name" />}
      {needs.lastName && <Field label="Last name" value={values.lastName} onChangeText={set('lastName')} autoCapitalize="words" autoComplete="family-name" />}
      {needs.username && <Field label="Username" value={values.username} onChangeText={set('username')} autoComplete="username" placeholder="8–20 characters" />}
      {needs.username && values.username.trim().length > 0 && !usernameOk && (
        <Text variant="caption" color={c.danger}>Usernames are 8–20 characters ({values.username.trim().length} now).</Text>
      )}
      {needs.phoneNumber && (
        <Field label="Phone number" value={values.phoneNumber} onChangeText={set('phoneNumber')} keyboardType="phone-pad" autoComplete="tel" placeholder="+92 300 1234567" />
      )}
      {needs.password && <Field label="Password" value={values.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" />}
      <FormError message={error} />
      <Button title="Continue" loading={loading} disabled={!ready} onPress={onSave} />
    </AuthShell>
  );
}

/** Pakistani numbers are often typed locally (0300 1234567); Clerk needs E.164 (+923001234567). */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+92${digits.slice(1)}`;
  if (digits.startsWith('92')) return `+${digits}`;
  return digits;
}
