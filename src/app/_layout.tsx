import '@/lib/livekit';

import { BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque/800ExtraBold';
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_700Bold } from '@expo-google-fonts/dm-sans/700Bold';
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-expo';
import { resourceCache } from '@clerk/clerk-expo/resource-cache';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { useFonts } from 'expo-font';
import { Stack, useGlobalSearchParams, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { PostHogProvider, usePostHog } from 'posthog-react-native';
import { useEffect, type ReactNode } from 'react';
import { Platform, View } from 'react-native';

import { LaunchScreen } from '@/components/LaunchScreen';
import { Text } from '@/components/ui';
import { env, missingRequiredEnv } from '@/lib/env';
import { AppI18n } from '@/lib/i18n/AppI18n';
import { ProfileProvider } from '@/lib/profile';
import { initSentry, Sentry } from '@/lib/sentry';
import { SupabaseProvider } from '@/lib/supabase';
import { fonts, useTheme } from '@/lib/theme';

initSentry();
// Keep the native logo splash up until fonts are ready, then hand over to <LaunchScreen />.
void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 300 });

/**
 * Shows the branded loading page only while Clerk restores the session. Clerk's resource cache
 * (ClerkProvider below) lets a returning user's session load from the phone instead of the
 * network, so reopening the app goes straight to Home instead of waiting on the logo.
 */
function LaunchGate({ children }: { children: ReactNode }) {
  const { isLoaded } = useAuth();
  if (!isLoaded) return <LaunchScreen />;
  return <>{children}</>;
}

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
        headerTitleStyle: { fontFamily: fonts.bold },
        contentStyle: { backgroundColor: c.background },
        headerShadowVisible: false,
      }}
    >
      <Stack.Protected guard={!!isSignedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="live/[roomId]" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="party/[roomId]" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="host/live" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="host/summary" options={{ title: 'Stream summary', headerBackVisible: false }} />
        <Stack.Screen name="host/dashboard" options={{ title: 'Host dashboard' }} />
        <Stack.Screen name="user/[id]" options={{ title: '' }} />
        <Stack.Screen name="chat/[userId]" options={{ title: 'Chat' }} />
        <Stack.Screen name="wallet" options={{ title: 'Wallet' }} />
        <Stack.Screen name="frames" options={{ title: 'Profile frames' }} />
        <Stack.Screen name="rankings" options={{ title: 'Rankings' }} />
        <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
        <Stack.Screen name="hosting" options={{ title: 'Hosting' }} />
        <Stack.Screen name="verify-form" options={{ title: 'Verify with Didit' }} />
        <Stack.Screen name="earnings" options={{ title: 'Earnings' }} />
        <Stack.Screen name="support" options={{ title: 'Help & support' }} />
        <Stack.Screen name="profile-edit" options={{ title: 'Edit profile', presentation: 'modal' }} />
        <Stack.Screen name="agency" options={{ title: 'Agency portal' }} />
        <Stack.Screen name="contributions/[id]" options={{ title: 'Contributions' }} />
        <Stack.Screen name="admin/index" options={{ title: 'Owner command center' }} />
        <Stack.Screen name="videos/index" options={{ title: 'Videos' }} />
        <Stack.Screen name="videos/upload" options={{ title: 'My videos' }} />
        <Stack.Screen name="videos/[id]" options={{ title: 'Video' }} />
        <Stack.Screen name="events/index" options={{ title: 'Events' }} />
        <Stack.Screen name="events/[id]" options={{ title: 'Event' }} />
        <Stack.Screen name="menus" options={{ title: 'Menu styles' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack.Protected>
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false, animation: 'fade' }} />
      </Stack.Protected>
      <Stack.Screen name="checkout-return" options={{ headerShown: false }} />
      <Stack.Screen name="sso-callback" options={{ headerShown: false }} />
      {/* Public pages linked from the store listings; readable signed out. */}
      <Stack.Screen name="privacy" options={{ headerShown: false }} />
      <Stack.Screen name="terms" options={{ headerShown: false }} />
      <Stack.Screen name="account-deletion" options={{ headerShown: false }} />
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
  const { c } = useTheme();
  // A font that fails to load falls back to the system face; never block on it.
  const [fontsLoaded, fontError] = useFonts({ BricolageGrotesque_800ExtraBold, DMSans_400Regular, DMSans_500Medium, DMSans_700Bold });
  const fontsReady = fontsLoaded || !!fontError;
  useEffect(() => {
    if (fontsReady) SplashScreen.hide();
  }, [fontsReady]);
  if (!fontsReady) return <View style={{ flex: 1, backgroundColor: c.background }} />;
  if (missingRequiredEnv.length > 0) return <MissingConfig />;
  return (
    <ClerkProvider publishableKey={env.clerkPublishableKey} tokenCache={tokenCache} __experimental_resourceCache={Platform.OS === 'web' ? undefined : resourceCache}>
      <LaunchGate>
        <SupabaseProvider>
          <ProfileProvider>
            <AppI18n>
              <Analytics>
                <IdentityAndScreens />
                <StatusBar style="light" />
                <RootNavigator />
              </Analytics>
            </AppI18n>
          </ProfileProvider>
        </SupabaseProvider>
      </LaunchGate>
    </ClerkProvider>
  );
}

export default Sentry.wrap(RootLayout);

export { ErrorBoundary } from 'expo-router';
