import 'react-native-url-polyfill/auto';

import { useAuth } from '@clerk/clerk-expo';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { env } from './env';

const SupabaseContext = createContext<SupabaseClient | null>(null);

/**
 * Supabase client authenticated with the Clerk session token (Supabase
 * "third-party auth" integration). Row Level Security policies read the Clerk
 * user id from `auth.jwt() ->> 'sub'`.
 */
export function SupabaseProvider({ children }: { children: ReactNode }) {
  // Clerk's getToken is stable and returns a fresh (cached) session JWT.
  const { getToken } = useAuth();

  const client = useMemo(
    () =>
      createClient(env.supabaseUrl, env.supabaseAnonKey, {
        accessToken: async () => (await getToken()) ?? null,
      }),
    [getToken],
  );

  return <SupabaseContext.Provider value={client}>{children}</SupabaseContext.Provider>;
}

export function useSupabase() {
  const client = useContext(SupabaseContext);
  if (!client) throw new Error('useSupabase must be used inside <SupabaseProvider>');
  return client;
}
