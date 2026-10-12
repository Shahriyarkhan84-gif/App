# Hosting Zynalive (step by step)

Everything runs on managed services: no servers to look after.

| Piece | Where | Status |
|---|---|---|
| Database, login checks, server functions, file storage, realtime | Supabase (`mdfjbhzriuwxafeagnwo`, us-east-1) | Running. Server functions deployed (incl. `smart-search`, `clerk-webhook`). Database up to date (12 Oct 2026). |
| Sign-in | Clerk | Running on a development key (`pk_test_…`). |
| Live video | LiveKit Cloud | Needs its secrets in Supabase (step 2). |
| Website (zynalive.com) | Vercel (`vercel.json`) or Cloudflare Pages (`public/_headers`), static Expo web export | Not created yet (step 3 or 3b). |
| AI agents + media worker | Render, two always-on workers (`render.yaml`) | Not created yet (step 4). |
| Phone app | Expo EAS (builds + over-the-air updates) | Running; blocked on build minutes / network (step 5). |

## 1. Database updates (Supabase) — done

All migrations through `20261012010000_smart_search` are live (checked 12 Oct 2026). For future
migrations: Supabase → **SQL Editor** → paste the new file(s) from `supabase/migrations/` in order → **Run**.

## 2. Server function secrets (Supabase)

Supabase → **Edge Functions → Secrets**: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`CLERK_ISSUER`, `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`,
`DIDIT_API_KEY`, and optionally `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (rate limits),
`RESEND_API_KEY` (emails), `PINECONE_API_KEY` (smart search) (see `docs/ENVIRONMENT.md`). Point the LiveKit webhook at
`/functions/v1/livekit-webhook`, the Stripe webhook at `/functions/v1/stripe-webhook` (events:
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`,
`charge.dispute.created`, `charge.dispute.closed`) and the Clerk
webhook at `/functions/v1/clerk-webhook` (secret: `CLERK_WEBHOOK_SECRET`).
`didit-session` / `didit-webhook` are not deployed: host sign-up uses `host-application` instead.
Never paste these into chat or the repository.

## 3. Website (Vercel) — about 5 minutes

1. vercel.com → **Add New → Project** → import GitHub repository `shahriyarkhan84-gif/app`
   (if it isn't listed: **Adjust GitHub App Permissions** and allow this repository).
2. Leave the build settings alone: `vercel.json` sets them (build `npm run build:web`,
   output `dist`, every path served by the app, long caching for app files).
3. **Environment Variables** (all are public values, already in `eas.json`):

   | Name | Value |
   |---|---|
   | `EXPO_PUBLIC_SUPABASE_URL` | `https://mdfjbhzriuwxafeagnwo.supabase.co` |
   | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_ym0AC5kxr0NywW26w3Bp_g_hsD28utt` |
   | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | the Clerk publishable key (`pk_test_…` today, `pk_live_…` for launch) |
   | `EXPO_PUBLIC_SITE_URL` | `https://zynalive.com` |

4. **Deploy**. Every push to the repository's main branch then updates the site by itself.
5. Domain: Vercel → project → **Domains** → add `zynalive.com` and `www.zynalive.com`; at the DNS
   provider set `A @ 76.76.21.21` and `CNAME www cname.vercel-dns.com` (Cloudflare: DNS only).
6. Clerk → **Domains / allowed origins**: add the site URL.

Vercel's free Hobby plan is for non-commercial use. It is fine for testing; switch to Pro before the
site sells coins, or use Cloudflare Pages instead (step 3b).

### 3b. Website on Cloudflare Pages instead (free, commercial use allowed)

1. dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → pick
   `shahriyarkhan84-gif/app`.
2. Build settings: framework preset **None**, build command `npm run build:web`, output
   directory `dist`. Node 22 comes from `.node-version`.
3. **Environment variables**: the same four `EXPO_PUBLIC_*` values as in step 3.
4. **Save and Deploy**. Every push updates the site. Cloudflare serves the app for every address
   (single-page app) and `public/_headers` keeps app files cached, like `vercel.json` does on Vercel.
5. Domain: project → **Custom domains** → add `zynalive.com` (if the domain's DNS is already on
   Cloudflare, it sets the records itself). Add the site URL to Clerk's allowed origins.

Use one of Vercel or Cloudflare for the live domain, not both.

### What zynalive.com shows

- `/` is the public website (`public/landing.html`: what Zynalive is, features, hosting, safety, FAQ),
  so a search for "zynalive" lands on a real page instead of straight inside the app. Its buttons
  open `/app`, which sends people into the app (Home when signed in, the welcome screen when not).
- Every other address (`/privacy`, `/live/…`, `/sign-in`, …) is the app (`dist/app.html`).
- People already signed in on that browser skip the website and go straight to the app
  (`zl-signed-in` flag set by the app). `zynalive.com/?site` always shows the website.
- `npm run build:web` = `expo export -p web` + `scripts/web-landing.mjs`, which puts the website at
  `dist/index.html` and the app at `dist/app.html` (Vercel rewrites to it) and `dist/404.html`
  (Cloudflare Pages). `robots.txt` and `sitemap.xml` are in `public/`.

## 4. AI agents + media worker (Render) — about 5 minutes

1. render.com → **New → Blueprint** → pick `shahriyarkhan84-gif/app`. Render reads `render.yaml`
   and proposes two workers: `zynalive-ai-agents` and `zynalive-media`.
2. Fill the secrets it asks for:
   - `DATABASE_URL`: Supabase → **Connect** → *Session pooler* connection string (with the database password).
   - `ANTHROPIC_API_KEY`: from console.anthropic.com.
   - `SUPABASE_SERVICE_ROLE_KEY` (media only): Supabase → Settings → API keys → service role / secret key.
   - `PINECONE_API_KEY` (AI worker, optional): smart search. app.pinecone.io → API keys. Add the same
     key in Supabase → Edge Functions → Secrets (`smart-search` is already deployed). The index is
     created on the worker's first sync.
3. **Apply**. Both redeploy on every push. Logs: Render → service → **Logs**.

The media worker transcodes video; if uploads wait long, raise its plan. Without it, video uploads
stay "processing". Without the AI worker, moderation proposals, recommendations and the creator
coach stop (the app still works).

## 5. Phone app (Expo EAS)

- Over-the-air updates (JavaScript changes, no store review): `npx eas-cli update --channel preview`
  or the `publish-preview-update.yml` workflow. Needs an `EXPO_TOKEN` (cloud environment variable)
  and network access to `api.expo.dev`, or build minutes on the Expo plan.
- New native code (e.g. `expo-observe`) needs a new build: `npx eas-cli build --profile preview`.

## Accounts checklist (the $20/month stack)

Every service is already wired into the code; each only needs an account and its key pasted in the
right place. Paste keys into the dashboards named here, never into chat or the repository.

| Website | Sign up | Copy | Paste into |
|---|---|---|---|
| Supabase | supabase.com (have it) | — | Done: database up to date |
| Vercel *or* Cloudflare Pages | vercel.com / dash.cloudflare.com | — | Import the GitHub repo (step 3 / 3b) |
| Namecheap | namecheap.com (have zynalive.com) | — | DNS → Cloudflare (step 3) |
| Stripe | dashboard.stripe.com | Secret key, webhook signing secret | Supabase → Edge Functions → Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Clerk | dashboard.clerk.com (have it) | Production publishable + secret key; Webhooks → add endpoint `/functions/v1/clerk-webhook` (events user.created/updated/deleted) → signing secret | Website/EAS: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`; Supabase secrets: `CLERK_SECRET_KEY`, `CLERK_ISSUER`, `CLERK_WEBHOOK_SECRET` |
| Resend | resend.com → API keys; verify zynalive.com | API key | Supabase secrets: `RESEND_API_KEY` |
| Upstash | console.upstash.com → Create Redis database | REST URL + REST token | Supabase secrets: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| Pinecone | app.pinecone.io → API keys | API key | Render (AI worker) and Supabase secrets: `PINECONE_API_KEY` |
| PostHog | posthog.com → Project settings | Project API key + host | Website/EAS: `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST` |
| Sentry | sentry.io → React Native project | DSN | Website/EAS: `EXPO_PUBLIC_SENTRY_DSN` |
| ProductBridge | your ProductBridge feedback board | Public board URL | Website/EAS: `EXPO_PUBLIC_PRODUCTBRIDGE_URL` (shows "Feedback" on Me) |
| Render | render.com | — | New → Blueprint (step 4) |

Linking these in claude.ai → Settings → Connectors lets Claude do the setup steps for you:
Resend, Cloudflare, Sentry, PostHog, Clerk (Vercel and Supabase are already linked; Vercel needs
permission to create projects, Supabase changes need approving when Claude asks). Pinecone,
Upstash, Namecheap and ProductBridge have no connector: those are a few clicks on their sites.

## Checks after going live

- Website: open the site, sign in, Home loads live rooms.
- Supabase → **Advisors** (security + performance) shows nothing new.
- Render logs show the workers polling without errors.
- Before a big event: run the load test against a staging Supabase project (`docs/LOAD_TEST.md`).
