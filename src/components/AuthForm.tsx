import { isClerkAPIResponseError, useAuth, useClerk, useSSO } from '@clerk/clerk-expo';
import * as AuthSession from 'expo-auth-session';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { brand } from '@/lib/brand';
import { errorCode, friendlyError } from '@/lib/errors';
import { useTheme } from '@/lib/theme';

import { FadeIn, Float } from './Motion';
import { Button, glassShadow, IconButton, Input, SkyBackground, Text, Wordmark } from './ui';

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

/**
 * Push signed-in users to the home screen. Used on every screen that can
 * complete a Clerk session (welcome/sign-up/sign-in's social buttons,
 * sign-up/sign-in's own email flow, sso-callback). Fires off
 * `useAuth().isSignedIn` rather than immediately after `setActive()`, so it
 * can't race React flushing that state update — the authoritative signal,
 * not a same-tick guess. Each caller may *also* call router.replace('/')
 * right after its own setActive() as a same-tick fast path; that's harmless
 * and this hook is what actually guarantees the navigation happens.
 */
export function useRedirectWhenSignedIn() {
  const { isSignedIn } = useAuth();
  useEffect(() => {
    if (isSignedIn) router.replace('/');
  }, [isSignedIn]);
}

/**
 * Shown when Clerk created the session but holds it on a task (e.g. "choose-organization" when the
 * dashboard requires organization membership). The task name is shown so support can tell which
 * Clerk setting caused it.
 */
export const PENDING_TASK_MESSAGE =
  'Your account is ready, but one more sign-in step is needed that the app can\'t show yet. Please try again in a few minutes or contact support.';

export function pendingTaskMessage(task?: { key?: string } | null) {
  return task?.key ? `${PENDING_TASK_MESSAGE} (step: ${task.key})` : PENDING_TASK_MESSAGE;
}

export function clerkErrorMessage(err: unknown) {
  if (isClerkAPIResponseError(err)) return err.errors[0]?.longMessage ?? err.errors[0]?.message ?? 'Request failed';
  // Lost connections get friendly copy; app error codes get theirs; anything else keeps its own message.
  if (err instanceof Error && /network request failed|failed to fetch|network error/i.test(err.message)) return 'No internet connection. Check your connection and try again.';
  if (err instanceof Error && /timed? ?out/i.test(err.message)) return 'That took too long. Please try again.';
  if (errorCode(err) !== 'unknown') return friendlyError(err);
  return err instanceof Error && err.message ? err.message : friendlyError(err);
}

/** App icon + wordmark + tagline at the top of the welcome and sign-in screens. */
export function AuthHero({ size = 44 }: { size?: number }) {
  return (
    <View style={{ gap: 14 }}>
      <FadeIn from={-16}>
        <Float>
          <Image source={require('../../assets/splash-icon.png')} style={{ width: 84, height: 84 }} contentFit="contain" accessible={false} />
        </Float>
      </FadeIn>
      <FadeIn delay={380}><Wordmark size={size} /></FadeIn>
      <FadeIn delay={500}><Text variant="bodyLarge" muted>{brand.tagline}</Text></FadeIn>
    </View>
  );
}

export function AuthTerms() {
  const { c } = useTheme();
  return (
    <Text variant="caption" faint style={{ textAlign: 'center', marginTop: 28, lineHeight: 18 }}>
      By continuing you agree to the{' '}
      <Text variant="caption" color={c.primary} accessibilityRole="link" onPress={() => router.push('/terms')}>Terms</Text>
      {' '}and{' '}
      <Text variant="caption" color={c.primary} accessibilityRole="link" onPress={() => router.push('/privacy')}>Privacy Policy</Text>
      . You must be 18+ to go live.
    </Text>
  );
}

/** Sign-in / sign-up frame (Aurora dark): a glass back button, big title and subtitle, then the form straight on the background. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <SkyBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
              <IconButton icon="chevron-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))} />
            </View>
            <FadeIn>
              <Text variant="display" accessibilityRole="header">{title}</Text>
              <Text variant="bodyLarge" muted style={{ marginTop: 6, marginBottom: 24 }}>{subtitle}</Text>
            </FadeIn>
            <FadeIn delay={120}>
              <View style={{ gap: 14 }}>{children}</View>
            </FadeIn>
            <AuthTerms />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SkyBackground>
  );
}

/** Small rounded tile with the brand's first letter on the button gradient. */
/** The app logo (the Kitty icon, assets/logo.png) on the sign-in screens. */
export function LogoTile({ size = 44 }: { size?: number }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: size * 0.24, overflow: 'hidden' }, glassShadow]} accessible={false}>
      <Image source={require('../../assets/logo.png')} style={{ width: size, height: size }} contentFit="cover" />
    </View>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  return <Input autoCapitalize="none" {...props} />;
}

export function FormError({ message }: { message: string | null }) {
  const { c } = useTheme();
  if (!message) return null;
  return <Text color={c.danger} accessibilityRole="alert" accessibilityLiveRegion="polite">{message}</Text>;
}

/** Google / Apple sign-in through Clerk's SSO flow. */
/** `divider`: an "or" line below the buttons (default), above them, or none. */
export function SocialButtons({ onError, divider = true }: { onError: (message: string) => void; divider?: boolean | 'above' | 'below' }) {
  const { c } = useTheme();
  useWarmUpBrowser();
  useRedirectWhenSignedIn();
  const { startSSOFlow } = useSSO();
  const clerk = useClerk();
  const [pending, setPending] = useState<string | null>(null);

  const start = async (strategy: 'oauth_google' | 'oauth_apple') => {
    setPending(strategy);
    try {
      const { createdSessionId, setActive, authSessionResult, signIn, signUp } = await startSSOFlow({
        strategy,
        redirectUrl: AuthSession.makeRedirectUri({ path: 'sso-callback' }),
      });
      if (createdSessionId) {
        await setActive?.({ session: createdSessionId });
        if (clerk.session?.currentTask) return onError(pendingTaskMessage(clerk.session.currentTask));
        // See sign-up.tsx: push home explicitly rather than rely solely on
        // Stack.Protected's guard re-evaluation.
        router.replace('/');
      } else if (signUp?.status === 'missing_requirements') {
        // New account, but the Clerk instance requires fields Google/Apple don't
        // provide (username, phone, password…): collect them in the app.
        router.replace('/complete-sign-up');
      } else if (authSessionResult?.type === 'cancel' || authSessionResult?.type === 'dismiss') {
        // User closed the browser sheet before finishing — not an error, just stop quietly.
      } else {
        // The browser session ended but Clerk didn't hand back a session — this used to
        // fail silently (button just stopped loading, no feedback). Surface *why* so it's
        // debuggable instead of looking like the app "did nothing": either the sign-in
        // needs another step Clerk requires (status), or the redirect didn't carry a
        // result back to the app at all (authSessionResult.type).
        const status = signUp?.status ?? signIn?.status;
        onError(
          status
            ? `Sign-in needs an extra step (${status}). Try email sign-in instead.`
            : `Sign-in didn't complete (${authSessionResult?.type ?? 'no response'}). Please try again.`,
        );
      }
    } catch (err) {
      onError(clerkErrorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const buttons = (
    <View style={{ gap: 10 }}>
      <Button title="Continue with Google" accessibilityLabel="Continue with Google" variant="secondary" loading={pending === 'oauth_google'} onPress={() => start('oauth_google')}
        icon={<Ionicons name="logo-google" size={18} color={c.text} />} />
      {Platform.OS !== 'android' && (
        <Button title="Continue with Apple" accessibilityLabel="Continue with Apple" variant="secondary" loading={pending === 'oauth_apple'} onPress={() => start('oauth_apple')}
          icon={<Ionicons name="logo-apple" size={19} color={c.text} />} />
      )}
    </View>
  );
  return (
    <View style={{ gap: 14 }}>
      {divider === 'above' && <OrDivider label="or" />}
      {buttons}
      {(divider === true || divider === 'below') && <OrDivider />}
    </View>
  );
}

export function OrDivider({ label = 'or use email' }: { label?: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.dividerRow}>
      <View style={[styles.divider, { backgroundColor: c.divider }]} />
      <Text variant="caption" faint>{label}</Text>
      <View style={[styles.divider, { backgroundColor: c.divider }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 20, paddingVertical: 12, maxWidth: 480, width: '100%', alignSelf: 'center' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  divider: { flex: 1, height: 1 },
});
