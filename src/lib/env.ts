import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

// Public, client-side configuration (EXPO_PUBLIC_* only — never secrets).
// LiveKit's URL is returned by the livekit-token function; its API secret
// lives only in Supabase function secrets.
export const env = {
  clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  posthogKey: process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '',
  posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
  productBridgeUrl: process.env.EXPO_PUBLIC_PRODUCTBRIDGE_URL ?? '',
  siteUrl: process.env.EXPO_PUBLIC_SITE_URL ?? '',
  // New NestJS backend (apps/api) — see docs/MIGRATION_PLAN.md, Phase 8.
  // Not in missingRequiredEnv yet: nothing reads this until screens are
  // repointed off Supabase/Clerk one at a time.
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  // 'store' in Google Play / App Store builds (eas.json production). Store rules don't allow
  // pointing buyers of diamonds to other ways to pay, so the reseller list is hidden there.
  distribution: process.env.EXPO_PUBLIC_DISTRIBUTION ?? '',
};

/**
 * Official resellers (JazzCash / Easypaisa) are shown on the website and the downloadable APK only.
 * Store builds are recognised by their update channel too (baked into the binary, so an OTA update
 * bundled without EXPO_PUBLIC_DISTRIBUTION can't turn the list back on); iPhone apps only come from the App Store.
 */
export const showResellers = Platform.OS === 'web'
  || (Platform.OS === 'android' && env.distribution !== 'store' && Updates.channel !== 'production');

export const missingRequiredEnv = (
  [
    ['EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY', env.clerkPublishableKey],
    ['EXPO_PUBLIC_SUPABASE_URL', env.supabaseUrl],
    ['EXPO_PUBLIC_SUPABASE_ANON_KEY', env.supabaseAnonKey],
  ] as const
)
  .filter(([, value]) => !value)
  .map(([name]) => name);
