'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth-context';

const ADMIN_ROLES = ['OWNER_ADMIN', 'SUPER_ADMIN'];

/** Wraps a dashboard page: redirects to /login when signed out, optionally requires an admin role. */
export function RequireAuth({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { token, user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!token) {
      router.replace('/login');
      return;
    }
    if (adminOnly && user && !ADMIN_ROLES.includes(user.role)) {
      router.replace('/creator');
    }
  }, [loading, token, user, adminOnly, router]);

  if (loading || !token) return <main className="p-8 text-white/60">Loading…</main>;
  if (adminOnly && user && !ADMIN_ROLES.includes(user.role)) return null;

  return <>{children}</>;
}
