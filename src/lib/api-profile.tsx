// API-backed equivalent of src/lib/profile.tsx's ProfileProvider/useProfile,
// built against apps/api instead of Supabase — see docs/MIGRATION_PLAN.md,
// Phase 8. Additive: not wired into src/app/_layout.tsx and no screen
// imports it yet, same as zyna-auth.tsx (the two are meant to be adopted
// together, since this hook needs a signed-in ZynaAuth session).
//
// Known gap, not fabricated: apps/api's Host model has no verification_status
// yet (Didit identity verification — 20260924060000_host_verification.sql /
// 20260924120000_host_applications.sql — was never translated in Phases 1-7).
// `host` here reflects "has a host row", not "passed verification"; screens
// that gate on verification_status can't move until that lands.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { apiFetch } from './api-client';
import { useZynaAuth } from './zyna-auth';

export type ApiHostInfo = { hostCode: string; agencyId: string | null; status: string };
export type ApiProfile = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  country: string | null;
  role: string;
  status: 'active' | 'restricted' | 'banned';
};

type ApiProfileState = {
  profile: ApiProfile | null;
  host: ApiHostInfo | null;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
  isHost: boolean;
  isPlatformAdmin: boolean;
};

const ApiProfileContext = createContext<ApiProfileState | null>(null);

const ADMIN_ROLES = ['OWNER_ADMIN', 'SUPER_ADMIN'];

export function ApiProfileProvider({ children }: { children: ReactNode }) {
  const { signedIn } = useZynaAuth();
  const [profile, setProfile] = useState<ApiProfile | null>(null);
  const [host, setHost] = useState<ApiHostInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const me = await apiFetch<ApiProfile & { host: ApiHostInfo | null }>('/users/me');
      const { host: h, ...p } = me;
      setProfile(p);
      setHost(h);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    // Deferred so the state updates happen outside the effect body, same
    // pattern as ProfileProvider (src/lib/profile.tsx) and ZynaAuthProvider.
    let cancelled = false;
    const t = setTimeout(() => {
      if (!cancelled) void reload();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [signedIn, reload]);

  const value: ApiProfileState = {
    profile: signedIn ? profile : null,
    host: signedIn ? host : null,
    loading,
    error,
    reload,
    isHost: !!host && host.status === 'active',
    isPlatformAdmin: !!profile && ADMIN_ROLES.includes(profile.role),
  };
  return <ApiProfileContext.Provider value={value}>{children}</ApiProfileContext.Provider>;
}

export function useApiProfile() {
  const ctx = useContext(ApiProfileContext);
  if (!ctx) throw new Error('useApiProfile must be used inside <ApiProfileProvider>');
  return ctx;
}
