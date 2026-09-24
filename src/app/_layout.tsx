import { ClerkLoaded, ClerkProvider, useAuth, useUser } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { Stack, usePathname, useGlobalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PostHogProvider, usePostHog } from 'posthog-react-native';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { env, missingRequiredEnv } from '@/lib/env';
import { initSentry, Sentry } from '@/lib/sentry';
import { SupabaseProvider } from '@/lib/supabase';
import { colors, spacing } from '@/lib/theme';

initSentry();

function Analytics({ children }: { children: ReactNode }) {
  if (!env.posthogKey) return <>{children}</>;
  return (
    <PostHogProvider
      apiKey={env.posthogKey}
      options={{ host: env.posthogHost }}
      // Expo Router doesn't expose a React Navigation container to PostHog,
      // so screens are tracked manually in <IdentityAndScreens />.
      autocapture={{ captureScreens: false, captureTouches: false }}
    >
      {children}
    </PostHogProvider>
  );
}

/** Keeps PostHog + Sentry user identity in sync with Clerk, and tracks screens. */
function IdentityAndScreens() {
  const posthog = usePostHog();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const pathname = usePathname();
  const params = useGlobalSearchParams();

  useEffect(() => {
    if (isSignedIn && user) {
      const email = user.primaryEmailAddress?.emailAddress;
      posthog?.identify(user.id, { email: email ?? null, name: user.fullName ?? null });
      Sentry.setUser({ id: user.id, email });
    } else if (isSignedIn === false) {
      posthog?.reset();
      Sentry.setUser(null);
    }
  }, [isSignedIn, user, posthog]);

  useEffect(() => {
    posthog?.screen(pathname, { params: JSON.stringify(params) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}

function RootNavigator() {
  const { isSignedIn } = useAuth();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    >
      <Stack.Protected guard={!!isSignedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="title/[id]" options={{ title: '', headerTransparent: true }} />
        <Stack.Screen name="watch/[id]" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', title: 'Go Premium' }} />
      </Stack.Protected>
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="checkout-return" options={{ headerShown: false }} />
    </Stack>
  );
}

function MissingConfig() {
  return (
    <View style={styles.missing}>
      <Text style={styles.missingTitle}>Configuration needed</Text>
      <Text style={styles.missingBody}>
        Copy .env.example to .env and set:{'\n\n'}
        {missingRequiredEnv.join('\n')}
      </Text>
    </View>
  );
}

function RootLayout() {
  if (missingRequiredEnv.length > 0) return <MissingConfig />;

  return (
    <ClerkProvider publishableKey={env.clerkPublishableKey} tokenCache={tokenCache}>
      <ClerkLoaded>
        <SupabaseProvider>
          <Analytics>
            <IdentityAndScreens />
            <StatusBar style="light" />
            <RootNavigator />
          </Analytics>
        </SupabaseProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

export default Sentry.wrap(RootLayout);

export { ErrorBoundary } from 'expo-router';

const styles = StyleSheet.create({
  missing: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: spacing.xl },
  missingTitle: { color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: spacing.md },
  missingBody: { color: colors.textMuted, fontSize: 14, fontFamily: 'monospace' },
});
