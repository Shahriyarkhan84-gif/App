import Stripe from 'npm:stripe@18';

import { requireEnv } from './cors.ts';

export function getStripe() {
  return new Stripe(requireEnv('STRIPE_SECRET_KEY'), {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export const cryptoProvider = Stripe.createSubtleCryptoProvider();

/** Stripe return URL on the web app that can bounce back into the native app. */
export function returnUrl(path: string, appReturnTo?: string, extra = '') {
  const site = requireEnv('SITE_URL').replace(/\/$/, '');
  const to = appReturnTo && /^(zynalive|exps?):\/\//.test(appReturnTo) ? `to=${encodeURIComponent(appReturnTo)}` : '';
  const query = [to, extra].filter(Boolean).join('&');
  return `${site}${path}${query ? `?${query}` : ''}`;
}
