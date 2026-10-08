import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { StateView } from './StateView';

// Allowed deep-link prefixes to bounce back into the native app.
const APP_URL_PREFIXES = ['zynalive://', 'exp://', 'exps://'];

/**
 * External flows (Stripe, Didit) redirect to the Vercel-hosted web app. If the
 * flow started in the native app, `to` holds its deep link and we hand control
 * back to it, which closes the in-app browser. Otherwise go to `fallback`.
 */
export function ReturnBounce({ fallback }: { fallback: Href }) {
  const { to, status } = useLocalSearchParams<{ to?: string; status?: string }>();

  useEffect(() => {
    // Pass the outcome (e.g. Stripe's status=success|cancelled) on, so the app can tell a purchase from a cancel.
    const safeStatus = status && /^[a-z_]{1,20}$/.test(status) ? status : undefined;
    if (Platform.OS === 'web' && to && APP_URL_PREFIXES.some((p) => to.startsWith(p))) {
      window.location.replace(safeStatus ? `${to}${to.includes('?') ? '&' : '?'}status=${safeStatus}` : to);
      return;
    }
    if (safeStatus && typeof fallback === 'string') router.dismissTo(`${fallback}?status=${safeStatus}` as Href);
    else router.dismissTo(fallback);
  }, [to, status, fallback]);

  return <StateView state={{ kind: 'loading' }} />;
}
