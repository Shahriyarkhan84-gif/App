// Public, client-side configuration. Values come from EXPO_PUBLIC_* env vars
// (see .env.example). Must be referenced statically so Metro can inline them.
export const env = {
  clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  posthogKey: process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '',
  posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
  productBridgeUrl: process.env.EXPO_PUBLIC_PRODUCTBRIDGE_URL ?? '',
  siteUrl: process.env.EXPO_PUBLIC_SITE_URL ?? '',
};

export const missingRequiredEnv = (
  [
    ['EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY', env.clerkPublishableKey],
    ['EXPO_PUBLIC_SUPABASE_URL', env.supabaseUrl],
    ['EXPO_PUBLIC_SUPABASE_ANON_KEY', env.supabaseAnonKey],
  ] as const
)
  .filter(([, value]) => !value)
  .map(([name]) => name);
