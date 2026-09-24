import { isClerkAPIResponseError, useSSO } from '@clerk/clerk-expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/lib/theme';

import { Button } from './Button';

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
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>STREAMLY</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <View style={{ gap: spacing.md }}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput placeholderTextColor={colors.textMuted} style={styles.input} autoCapitalize="none" {...props} />
    </View>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

/** Google / Apple sign-in through Clerk's SSO flow. */
export function SocialButtons({ onError }: { onError: (message: string) => void }) {
  useWarmUpBrowser();
  const { startSSOFlow } = useSSO();
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
    <View style={{ gap: spacing.md }}>
      <Button title="Continue with Google" variant="secondary" loading={pending === 'oauth_google'} onPress={() => start('oauth_google')} />
      {Platform.OS !== 'android' && (
        <Button title="Continue with Apple" variant="secondary" loading={pending === 'oauth_apple'} onPress={() => start('oauth_apple')} />
      )}
      <View style={styles.dividerRow}>
        <View style={styles.divider} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.divider} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, maxWidth: 480, width: '100%', alignSelf: 'center' },
  brand: { color: colors.accent, fontSize: 28, fontWeight: '900', letterSpacing: 4, marginBottom: spacing.xxl },
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: 15, marginTop: spacing.xs, marginBottom: spacing.xl },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    height: 50,
    fontSize: 16,
  },
  error: { color: '#FF6B6B', fontSize: 14 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.xs },
  divider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dividerText: { color: colors.textMuted },
});
