import { useSignIn } from '@clerk/clerk-expo';
import { Link } from 'expo-router';
import { useState } from 'react';

import { AuthShell, clerkErrorMessage, Field, FormError, SocialButtons } from '@/components/AuthForm';
import { Button, Text } from '@/components/ui';
import { fonts, useTheme } from '@/lib/theme';

export default function SignInScreen() {
  const { c } = useTheme();
  const { signIn, setActive, isLoaded } = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!isLoaded) return;
    setError(null);
    setLoading(true);
    try {
      const attempt = await signIn.create({ identifier: email.trim(), password });
      if (attempt.status === 'complete') {
        await setActive({ session: attempt.createdSessionId });
      } else {
        setError('Additional verification is required. Please use the web app to finish signing in.');
      }
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to join the live rooms.">
      <SocialButtons onError={setError} />
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder="••••••••" />
      <FormError message={error} />
      <Button title="Sign in" loading={loading} disabled={!email || !password} onPress={onSubmit} />
      <Text muted style={{ textAlign: 'center' }}>
        New here?{' '}
        <Link href="/sign-up" style={{ color: c.primary, fontFamily: fonts.bold }}>
          Create an account
        </Link>
      </Text>
    </AuthShell>
  );
}
