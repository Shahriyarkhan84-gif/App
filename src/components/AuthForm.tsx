import { isClerkAPIResponseError, useSSO } from '@clerk/clerk-expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

import { FadeIn, Float } from './Motion';
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

/** Tiles + wordmark + tagline from the design canvas. */
export function AuthHero({ size = 44 }: { size?: number }) {
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {TILES.map((bg, i) => (
          <FadeIn key={bg} delay={i * 90} from={-24}>
            <Float offset={i * 350} style={{ marginTop: i % 2 ? 18 : 0 }}>
              <View style={{ width: 56, height: 76, borderRadius: 14, backgroundColor: bg }} />
            </Float>
          </FadeIn>
        ))}
      </View>
      <FadeIn delay={380}><Wordmark size={size} /></FadeIn>
      <FadeIn delay={500}><Text variant="bodyLarge" muted>Go live, meet people and support the hosts you love.</Text></FadeIn>
    </View>
  );
}

export function AuthTerms() {
  const { c } = useTheme();
  return (
    <Text variant="caption" faint style={{ textAlign: 'center', marginTop: 28, lineHeight: 18 }}>
      By continuing you agree to the Terms and{' '}
      <Text variant="caption" color={c.primary} accessibilityRole="link" onPress={() => router.push('/privacy')}>Privacy Policy</Text>
      . You must be 18+ to go live.
    </Text>
  );
}

/** Sign-in / sign-up frame: back button, compact wordmark, title, form. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="chevron-back" size={22} color={c.text} />
            </Pressable>
            <Wordmark size={24} />
            <View style={{ width: 44 }} />
          </View>
          <FadeIn>
            <Text variant="h1">{title}</Text>
            <Text muted style={{ marginTop: 4, marginBottom: 20 }}>{subtitle}</Text>
          </FadeIn>
          <FadeIn delay={120} style={{ gap: 12 }}>{children}</FadeIn>
          <AuthTerms />
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
export function SocialButtons({ onError, divider = true }: { onError: (message: string) => void; divider?: boolean }) {
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
    <View style={{ gap: 12 }}>
      <Button title="Continue with Google" variant="secondary" loading={pending === 'oauth_google'} onPress={() => start('oauth_google')} />
      {Platform.OS !== 'android' && (
        <Button title="Continue with Apple" variant="secondary" loading={pending === 'oauth_apple'} onPress={() => start('oauth_apple')} />
      )}
      {divider && <OrDivider />}
    </View>
  );
}

export function OrDivider() {
  const { c } = useTheme();
  return (
    <View style={styles.dividerRow}>
      <View style={[styles.divider, { backgroundColor: c.divider }]} />
      <Text variant="bodySmall" faint>or</Text>
      <View style={[styles.divider, { backgroundColor: c.divider }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 16, maxWidth: 480, width: '100%', alignSelf: 'center' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  divider: { flex: 1, height: 1 },
});
