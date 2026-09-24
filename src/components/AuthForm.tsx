import { isClerkAPIResponseError, useSSO } from '@clerk/clerk-expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

import { Button, Input, Text } from './ui';

WebBrowser.maybeCompleteAuthSession();

/** Warm up the Android browser so the OAuth sheet opens quickly. */
function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

export function clerkErrorMessage(err: unknown) {
  if (isClerkAPIResponseError(err)) return err.errors[0]?.longMessage ?? err.errors[0]?.message ?? 'Request failed';
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text variant="display" color={c.primary} style={{ marginBottom: 32 }}>Zynalive</Text>
          <Text variant="h1">{title}</Text>
          <Text muted style={{ marginTop: 4, marginBottom: 24 }}>{subtitle}</Text>
          <View style={{ gap: 12 }}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  return <Input autoCapitalize="none" {...props} />;
}

export function FormError({ message }: { message: string | null }) {
  const { c } = useTheme();
  if (!message) return null;
  return <Text color={c.danger}>{message}</Text>;
}

/** Google / Apple sign-in through Clerk's SSO flow. */
export function SocialButtons({ onError }: { onError: (message: string) => void }) {
  useWarmUpBrowser();
  const { startSSOFlow } = useSSO();
  const { c } = useTheme();
  const [pending, setPending] = useState<string | null>(null);

  const start = async (strategy: 'oauth_google' | 'oauth_apple') => {
    setPending(strategy);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy,
        redirectUrl: AuthSession.makeRedirectUri({ path: 'sso-callback' }),
      });
      if (createdSessionId) await setActive?.({ session: createdSessionId });
    } catch (err) {
      onError(clerkErrorMessage(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <Button title="Continue with Google" variant="secondary" loading={pending === 'oauth_google'} onPress={() => start('oauth_google')} />
      {Platform.OS !== 'android' && (
        <Button title="Continue with Apple" variant="secondary" loading={pending === 'oauth_apple'} onPress={() => start('oauth_apple')} />
      )}
      <View style={styles.dividerRow}>
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <Text muted>or</Text>
        <View style={[styles.divider, { backgroundColor: c.border }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, maxWidth: 480, width: '100%', alignSelf: 'center' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  divider: { flex: 1, height: StyleSheet.hairlineWidth },
});
