import '@/lib/livekit';

import { ClerkLoaded, ClerkProvider, useAuth, useUser } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { Stack, useGlobalSearchParams, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PostHogProvider, usePostHog } from 'posthog-react-native';
import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui';
import { env, missingRequiredEnv } from '@/lib/env';
import { ProfileProvider } from '@/lib/profile';
import { initSentry, Sentry } from '@/lib/sentry';
import { SupabaseProvider } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

initSentry();

function Analytics({ children }: { children: ReactNode }) {
  if (!env.posthogKey) return <>{children}</>;
  return (
    <PostHogProvider
      apiKey={env.posthogKey}
      options={{ host: env.posthogHost }}
      // Expo Router screens are tracked manually in <IdentityAndScreens />.
      autocapture={{ captureScreens: false, captureTouches: false }}
    >
      {children}
    </PostHogProvider>
  );
}

/** Keeps PostHog + Sentry identity in sync with Clerk and tracks screens. */
function IdentityAndScreens() {
  const posthog = usePostHog();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const pathname = usePathname();
  const params = useGlobalSearchParams();

  useEffect(() => {
    if (isSignedIn && user) {
      posthog?.identify(user.id, { name: user.fullName ?? null });
      Sentry.setUser({ id: user.id });
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
  const { c } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.background },
        headerTintColor: c.text,
        contentStyle: { backgroundColor: c.background },
        headerShadowVisible: false,
      }}
    >
      <Stack.Protected guard={!!isSignedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="live/[roomId]" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="host/live" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="host/summary" options={{ title: 'Stream summary', headerBackVisible: false }} />
        <Stack.Screen name="user/[id]" options={{ title: '' }} />
        <Stack.Screen name="chat/[userId]" options={{ title: 'Chat' }} />
        <Stack.Screen name="wallet" options={{ title: 'Wallet' }} />
        <Stack.Screen name="earnings" options={{ title: 'Earnings' }} />
        <Stack.Screen name="support" options={{ title: 'Help & support' }} />
        <Stack.Screen name="profile-edit" options={{ title: 'Edit profile', presentation: 'modal' }} />
        <Stack.Screen name="admin/index" options={{ title: 'Owner command center' }} />
      </Stack.Protected>
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="checkout-return" options={{ headerShown: false }} />
    </Stack>
  );
}

function MissingConfig() {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center', padding: 24, gap: 12 }}>
      <Text variant="h2">Configuration needed</Text>
      <Text muted>Copy .env.example to .env and set:</Text>
      <Text style={{ fontFamily: 'monospace' }}>{missingRequiredEnv.join('\n')}</Text>
    </View>
  );
}

function RootLayout() {
  const { scheme } = useTheme();
  if (missingRequiredEnv.length > 0) return <MissingConfig />;
  return (
    <ClerkProvider publishableKey={env.clerkPublishableKey} tokenCache={tokenCache}>
      <ClerkLoaded>
        <SupabaseProvider>
          <ProfileProvider>
            <Analytics>
              <IdentityAndScreens />
              <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
              <RootNavigator />
            </Analytics>
          </ProfileProvider>
        </SupabaseProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

export default Sentry.wrap(RootLayout);

export { ErrorBoundary } from 'expo-router';
