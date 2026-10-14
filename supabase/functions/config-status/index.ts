// Setup check: which Edge Function secrets are set — names and yes/no only, never values.
// GET /functions/v1/config-status. Lets the owner (or Claude) confirm configuration without
// opening the dashboard. Public on purpose: it reveals nothing but whether a feature is configured.
import { corsHeaders } from '../_shared/cors.ts';

const NEEDED: Record<string, string[]> = {
  checkout: ['CLERK_ISSUER', 'STRIPE_SECRET_KEY', 'SITE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  stripe_webhook: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  live_video: ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'],
  clerk_webhook: ['CLERK_WEBHOOK_SECRET'],
  delete_account: ['CLERK_SECRET_KEY'],
  host_application: ['DIDIT_API_KEY'],
  smart_search: ['PINECONE_API_KEY'],
  rate_limits: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  emails: ['RESEND_API_KEY'],
};

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const has = (n: string) => !!Deno.env.get(n);
  const features = Object.fromEntries(
    Object.entries(NEEDED).map(([feature, names]) => [feature, { ready: names.every(has), missing: names.filter((n) => !has(n)) }]),
  );
  // Mode of the Stripe key (test or live), from its public prefix only.
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const stripe_mode = stripeKey.startsWith('sk_live_') || stripeKey.startsWith('rk_live_') ? 'live'
    : stripeKey.startsWith('sk_test_') || stripeKey.startsWith('rk_test_') ? 'test' : stripeKey ? 'unknown' : 'missing';
  const site = Deno.env.get('SITE_URL') ?? null;
  return new Response(JSON.stringify({ features, stripe_mode, site_url: site }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
});
