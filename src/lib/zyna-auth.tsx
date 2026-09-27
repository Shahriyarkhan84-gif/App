// New session layer for apps/api — see docs/MIGRATION_PLAN.md, Phase 8 step 2.
// Named ZynaAuth (not "Auth") to avoid colliding with @clerk/clerk-expo's own
// useAuth()/AuthProvider names while both exist side by side in the tree.
//
// NOT wired into src/app/_layout.tsx yet, and no screen imports it. Reason:
// useSupabase() (src/lib/supabase.tsx) authenticates every Supabase query
// with the Clerk session's JWT — a user can't be "signed in" here and still
// have working data screens there. The actual cutover moves auth AND the
// Supabase-dependent screens together, not auth alone; see the phase plan.
//
// Response field names from apps/api are Prisma's camelCase (displayName,
// avatarUrl, ...), not the snake_case the rest of the app's `Profile` type
// (src/lib/types.ts) expects from Supabase RPCs — screens that move over
// need their field reads updated too, not just their data source.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { login as apiLogin, logout as apiLogout, persistSession } from './auth-api';
import { apiFetch, clearTokens, getStoredTokens } from './api-client';

export type ZynaUser = {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  role: string;
};

type ZynaAuthState = {
  user: ZynaUser | null;
  loading: boolean;
  signedIn: boolean;
  login: (email: string, password: string) => Promise<{ twoFactorRequired: boolean }>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
};

const ZynaAuthContext = createContext<ZynaAuthState | null>(null);

export function ZynaAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ZynaUser | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const tokens = await getStoredTokens();
    if (!tokens) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await apiFetch<ZynaUser>('/users/me'));
    } catch {
      await clearTokens();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so the state updates happen outside the effect body, same
    // pattern as ProfileProvider (src/lib/profile.tsx).
    let cancelled = false;
    const t = setTimeout(() => {
      if (!cancelled) void reload();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [reload]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await apiLogin(email, password);
      if ('twoFactorRequired' in result) return { twoFactorRequired: true };
      await persistSession(result);
      await reload();
      return { twoFactorRequired: false };
    },
    [reload],
  );

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <ZynaAuthContext.Provider value={{ user, loading, signedIn: !!user, login, logout, reload }}>
      {children}
    </ZynaAuthContext.Provider>
  );
}

export function useZynaAuth(): ZynaAuthState {
  const ctx = useContext(ZynaAuthContext);
  if (!ctx) throw new Error('useZynaAuth must be used inside <ZynaAuthProvider>');
  return ctx;
}
