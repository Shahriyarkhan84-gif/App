import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { StateView } from '@/components/StateView';

// Allowed deep-link prefixes to bounce back into the native app after Stripe.
const APP_URL_PREFIXES = ['zynalive://', 'exp://', 'exps://'];

/**
 * Stripe redirects here (on the Vercel-hosted web app) after coin checkout. If the flow started in the native app, `to` holds its deep link and
 * we hand control back to it, which closes the in-app browser.
 */
export default function CheckoutReturn() {
  const { to } = useLocalSearchParams<{ to?: string }>();

  useEffect(() => {
    if (Platform.OS === 'web' && to && APP_URL_PREFIXES.some((p) => to.startsWith(p))) {
      window.location.replace(to);
      return;
    }
    router.replace('/wallet');
  }, [to]);

  return <StateView state={{ kind: 'loading' }} />;
}
