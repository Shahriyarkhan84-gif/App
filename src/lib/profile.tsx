import { useAuth, useUser } from '@clerk/clerk-expo';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { rpc } from './api';
import { Sentry } from './sentry';
import { useSupabase } from './supabase';
import type { Profile } from './types';

export type HostInfo = { host_code: string; agency_id: string | null; status: string };

type ProfileState = {
  profile: Profile | null;
  host: HostInfo | null;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
  isHost: boolean;
  isPlatformAdmin: boolean;
};

const ProfileContext = createContext<ProfileState | null>(null);

/** Ensures the signed-in user has a profile + wallet and exposes it (role is read-only). */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const supabase = useSupabase();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [host, setHost] = useState<HostInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fullName = user?.fullName ?? null;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const p = await rpc<Profile>(supabase, 'ensure_profile', { p_display_name: fullName });
      const { data: h } = await supabase.from('hosts').select('host_code,agency_id,status').eq('user_id', p.id).maybeSingle();
      setProfile(p);
      setHost(h ?? null);
      setError(null);
    } catch (e) {
      setError(e as Error);
      Sentry.captureException(e);
    } finally {
      setLoading(false);
    }
  }, [supabase, fullName]);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    // Deferred so the state updates happen outside the effect body.
    const t = setTimeout(() => {
      if (!cancelled) void reload();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isSignedIn, reload]);

  const value: ProfileState = {
    profile: isSignedIn ? profile : null,
    host: isSignedIn ? host : null,
    loading,
    error,
    reload,
    isHost: !!host && host.status === 'active',
    isPlatformAdmin: profile?.role === 'OWNER_ADMIN' || profile?.role === 'SUPER_ADMIN',
  };
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside <ProfileProvider>');
  return ctx;
}
