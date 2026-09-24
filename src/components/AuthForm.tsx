import { isClerkAPIResponseError, useSSO } from '@clerk/clerk-expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

import { Button, Input, Text, Wordmark } from './ui';

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

const TILES = ['#5B2A4A', '#1F4A5C', '#4A2F6B', '#6B3A22'];

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 14, marginBottom: 28 }}>
            <View style={{ flexDirection: 'row', gap: 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {TILES.map((bg, i) => <View key={bg} style={{ width: 56, height: 76, borderRadius: 14, backgroundColor: bg, marginTop: i % 2 ? 18 : 0 }} />)}
            </View>
            <Wordmark size={44} />
            <Text variant="bodyLarge" muted>Go live, meet people and support the hosts you love.</Text>
          </View>
          <Text variant="h2">{title}</Text>
          <Text muted style={{ marginTop: 4, marginBottom: 20 }}>{subtitle}</Text>
          <View style={{ gap: 12 }}>{children}</View>
          <Text variant="caption" faint style={{ textAlign: 'center', marginTop: 28, lineHeight: 18 }}>
            By continuing you agree to the Terms and Privacy Policy. You must be 18+ to go live.
          </Text>
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
  container: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40, maxWidth: 480, width: '100%', alignSelf: 'center' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  divider: { flex: 1, height: StyleSheet.hairlineWidth },
});
