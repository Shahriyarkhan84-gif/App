import { useSignUp } from '@clerk/clerk-expo';
import { Link, router } from 'expo-router';
import { useState } from 'react';

import { AuthShell, clerkErrorMessage, Field, FormError, SocialButtons } from '@/components/AuthForm';
import { Button, Text } from '@/components/ui';
import { fonts, useTheme } from '@/lib/theme';

export default function SignUpScreen() {
  const { c } = useTheme();
  const { signUp, setActive, isLoaded } = useSignUp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    if (!isLoaded) return;
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

  const onCreate = () =>
    run(async () => {
      await signUp!.create({ emailAddress: email.trim(), password });
      await signUp!.prepareEmailAddressVerification({ strategy: 'email_code' });
      setAwaitingCode(true);
    });

  const onVerify = () =>
    run(async () => {
      const attempt = await signUp!.attemptEmailAddressVerification({ code: code.trim() });
      if (attempt.status === 'complete') {
        await setActive!({ session: attempt.createdSessionId });
        // Stack.Protected re-evaluates on the next render, but a signed-in
        // user can otherwise be left stranded on this (auth) screen when the
        // group's guard flips mid-navigation; push home explicitly.
        router.replace('/');
      } else {
        setError('Verification incomplete. Please try again.');
      }
    });

  if (awaitingCode) {
    return (
      <AuthShell title="Check your email" subtitle={`We sent a 6-digit code to ${email}.`}>
        <Field label="Verification code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" placeholder="123456" />
        <FormError message={error} />
        <Button title="Verify & continue" loading={loading} disabled={code.length < 6} onPress={onVerify} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" subtitle="Watch live, chat, send gifts — or go live yourself.">
      <SocialButtons onError={setError} />
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="At least 8 characters" />
      <FormError message={error} />
      <Button title="Continue" loading={loading} disabled={!email || password.length < 8} onPress={onCreate} />
      <Text muted style={{ textAlign: 'center' }}>
        Already have an account?{' '}
        <Link href="/sign-in" style={{ color: c.primary, fontFamily: fonts.bold }}>
          Sign in
        </Link>
      </Text>
    </AuthShell>
  );
}
