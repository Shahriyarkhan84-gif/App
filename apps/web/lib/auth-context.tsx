'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { API_URL, authFetch } from './api-client';

type Me = { id: string; role: string; displayName: string | null; email: string | null };

type AuthState = {
  token: string | null;
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

// Token lives in localStorage for this MVP dashboard — a real deployment
// should move to httpOnly cookies + a server-side refresh flow instead
// (see docs/MIGRATION_PLAN.md, Phase 7 notes).
const STORAGE_KEY = 'zynalive_access_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setLoading(false);
      return;
    }
    setToken(stored);
    authFetch<Me>('/users/me', stored)
      .then(setUser)
      .catch(() => {
        window.localStorage.removeItem(STORAGE_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Login failed');
    const data = await res.json();
    if (data.twoFactorRequired) throw new Error('This account has 2FA enabled — not supported on this dashboard yet.');

    window.localStorage.setItem(STORAGE_KEY, data.accessToken);
    setToken(data.accessToken);
    setUser(await authFetch<Me>('/users/me', data.accessToken));
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ token, user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
