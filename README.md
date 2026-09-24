# Streamly

A video streaming app for iOS, Android and web, built with Expo (SDK 57, Expo Router), using the "$20/mo startup stack":

| Tool | Role in Streamly | Where |
| --- | --- | --- |
| **Claude** | Coding | — |
| **Supabase** | Postgres catalog, watchlist, watch progress, subscriptions; Edge Functions for the server side | `supabase/` |
| **Clerk** | Auth: email + code, Google, Apple. Supabase trusts Clerk tokens through third-party auth | `src/app/(auth)`, `src/lib/supabase.tsx` |
| **Stripe** | Premium subscriptions: Checkout, billing portal, webhooks | `supabase/functions/create-*-session`, `stripe-webhook` |
| **Resend** | Welcome, subscription-started and subscription-ended emails | `supabase/functions/_shared/email.ts` |
| **Upstash Redis** | Trending views, rate limiting, search and recommendation cache | `supabase/functions/_shared/redis.ts` |
| **Pinecone** | Natural-language search and "Because you watched…" recommendations | `supabase/functions/_shared/pinecone.ts` |
| **PostHog** | Product analytics: screens plus typed events (play, search, checkout…) | `src/lib/analytics.ts` |
| **Sentry** | Crash and error tracking, including playback errors | `src/lib/sentry.ts`, `metro.config.js` |
| **ProductBridge** | Feedback board, opened from Profile → Share feedback | `src/app/(tabs)/profile.tsx` |
| **Vercel** | Hosts the web build, which is also Stripe's return page | `vercel.json` |
| **Namecheap + Cloudflare** | Domain and DNS for the Vercel site and Resend's sending domain | see below |
| **GitHub** | Code and CI (typecheck, lint, web build, Deno check) | `.github/workflows/ci.yml` |

## Features

- Home screen with a hero banner plus rows for Continue watching, Trending, Because you watched…, New releases and each genre
- HLS playback with `expo-video`: native controls, fullscreen, picture-in-picture, background audio, resume where you left off
- Premium gating enforced **in the database**: premium stream URLs sit in `video_streams`, and Row Level Security (RLS) only lets active subscribers read them
- Semantic search ("a heartwarming animated adventure"), with a keyword search fallback
- My List (watchlist), Profile, billing management and feedback

## Project layout

```
src/app/            Expo Router screens
  (auth)/           sign-in, sign-up
  (tabs)/           home, search, library (My List), profile
  title/[id].tsx    details page
  watch/[id].tsx    full-screen player
  paywall.tsx       Stripe plan picker (modal)
  checkout-return   where Stripe sends users afterwards (bounces back into the native app)
src/lib/            supabase client, api, hooks, analytics, sentry, theme
src/components/     UI building blocks
supabase/
  migrations/       schema + RLS
  seed.sql          demo catalog (Blender open movies + public HLS test streams)
  functions/        Edge Functions (Deno)
```

## Setup

### 1. Install and configure

```bash
npm install
cp .env.example .env   # fill in the values below
```

### 2. Clerk (auth)

1. Create an application and enable Email, Google and Apple.
2. Open **Integrations → Supabase** and activate it. This adds the `role: authenticated` claim that Supabase needs.
3. Put the publishable key in `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`.
4. Add a webhook to `https://<project>.supabase.co/functions/v1/clerk-webhook` for `user.created`, `user.updated` and `user.deleted`. Copy its signing secret for `CLERK_WEBHOOK_SECRET`.

### 3. Supabase (backend)

1. Create a project. Under **Authentication → Sign In / Providers → Third-party auth**, add **Clerk** with your Clerk domain.
2. Apply the schema and demo data:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   psql "$DATABASE_URL" -f supabase/seed.sql   # or paste into the SQL editor
   ```
3. Set the server secrets and deploy the functions:
   ```bash
   npx supabase secrets set \
     CLERK_ISSUER=https://<your-app>.clerk.accounts.dev \
     CLERK_WEBHOOK_SECRET=whsec_... \
     STRIPE_SECRET_KEY=sk_... STRIPE_WEBHOOK_SECRET=whsec_... \
     STRIPE_PRICE_MONTHLY=price_... STRIPE_PRICE_YEARLY=price_... \
     RESEND_API_KEY=re_... EMAIL_FROM="Streamly <hello@yourdomain.com>" \
     UPSTASH_REDIS_REST_URL=https://... UPSTASH_REDIS_REST_TOKEN=... \
     PINECONE_API_KEY=pcsk_... PINECONE_INDEX_HOST=streamly-xxxx.svc.pinecone.io \
     SITE_URL=https://yourdomain.com ADMIN_SECRET=$(openssl rand -hex 24)
   npx supabase functions deploy
   ```
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)
4. Put the project URL and publishable (anon) key in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

### 4. Stripe (payments)

1. Create a "Premium" product with a monthly and a yearly recurring price. Their IDs go in `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`.
2. Add a webhook endpoint at `https://<project>.supabase.co/functions/v1/stripe-webhook` for `checkout.session.completed` and `customer.subscription.created`, `.updated` and `.deleted`.
3. Turn on the **Customer portal** in Billing settings.

> App Store / Play Store note: stores restrict selling digital content through outside payment links, and the rules differ by region. Before you submit, check the current Apple and Google guidelines for your markets. You may need in-app purchases (for example through RevenueCat) on native, with Stripe kept for web.

### 5. Pinecone (semantic search)

Create a serverless index with **integrated embedding** (for example `llama-text-embed-v2`) and field map `text → text`. Its host goes in `PINECONE_INDEX_HOST`. Then index the catalog, and re-run this whenever you add titles:

```bash
curl -X POST "https://<project>.supabase.co/functions/v1/index-catalog" -H "x-admin-secret: $ADMIN_SECRET"
```

### 6. Upstash, Resend, PostHog, Sentry, ProductBridge

- **Upstash**: create a Redis database and copy its REST URL and token. Without it, the Trending row stays empty and rate limits are off.
- **Resend**: verify your sending domain by adding the DNS records it gives you in Cloudflare, then set `RESEND_API_KEY` and `EMAIL_FROM`.
- **PostHog**: set `EXPO_PUBLIC_POSTHOG_KEY` and `EXPO_PUBLIC_POSTHOG_HOST`.
- **Sentry**: set `EXPO_PUBLIC_SENTRY_DSN` and change `organization` and `project` in `app.json`. To upload source maps from EAS, add `SENTRY_AUTH_TOKEN` as an EAS secret.
- **ProductBridge**: set `EXPO_PUBLIC_PRODUCTBRIDGE_URL` to your public feedback board.

### 7. Run

The app uses native modules (Clerk, Sentry, expo-video PiP), so use a development build rather than Expo Go:

```bash
npx eas-cli@latest build --profile development --platform ios   # or android
npm start
npm run web                                                     # web works immediately
```

## Deploying

- **Web → Vercel**: import the GitHub repo. `vercel.json` already sets the build (`expo export -p web`), the output folder and the SPA rewrites. Add the `EXPO_PUBLIC_*` variables in Vercel's project settings.
- **Domain**: buy it on Namecheap, then point its nameservers at Cloudflare. In Cloudflare, add the Vercel records (`A @ 76.76.21.21`, `CNAME www cname.vercel-dns.com`, both DNS-only / grey cloud) and Resend's DKIM/SPF records. Add the domain in Vercel and set `SITE_URL` / `EXPO_PUBLIC_SITE_URL` to it.
- **Mobile → EAS**: `npx eas-cli@latest build --profile production` and then `eas submit`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Start the dev server |
| `npm run web` | Run in the browser |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint (Expo config) |
| `npm run build:web` | Static web export to `dist/` |
