import { useClerk, useSignIn } from '@clerk/clerk-expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { AuthShell, clerkErrorMessage, Field, FormError, PENDING_TASK_MESSAGE, useRedirectWhenSignedIn } from '@/components/AuthForm';
import { OtpInput } from '@/components/OtpInput';
import { Button } from '@/components/ui';

export default function ForgotPasswordScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const clerk = useClerk();
  useRedirectWhenSignedIn();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
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

  const onSendCode = () =>
    run(async () => {
      await signIn!.create({ strategy: 'reset_password_email_code', identifier: email.trim() });
      setCodeSent(true);
    });

  const onReset = () =>
    run(async () => {
      const attempt = await signIn!.attemptFirstFactor({ strategy: 'reset_password_email_code', code: code.trim(), password });
      if (attempt.status === 'complete') {
        await setActive!({ session: attempt.createdSessionId });
        if (clerk.session?.currentTask) return setError(PENDING_TASK_MESSAGE);
        router.replace('/');
      } else {
        // needs_second_factor: sign-in.tsx doesn't support 2FA on mobile either.
        setError('Password updated. Additional verification is required — please use the web app to finish signing in.');
      }
    });

  if (codeSent) {
    return (
      <AuthShell title="Set a new password" subtitle={`Enter the code we sent to ${email.trim()}.`}>
        <OtpInput label="Reset code" value={code} onChange={(v) => { setCode(v); setError(null); }} error={!!error} disabled={loading} />
        <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="At least 8 characters" />
        <FormError message={error} />
        <Button title="Reset password" loading={loading} disabled={code.trim().length < 6 || password.length < 8} onPress={onReset} />
        <Button title="Resend code" variant="secondary" disabled={loading} onPress={onSendCode} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a code to set a new password.">
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
      <FormError message={error} />
      <Button title="Send reset code" loading={loading} disabled={!email.trim()} onPress={onSendCode} />
      <Button title="Back to sign in" variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/sign-in'))} />
    </AuthShell>
  );
}
