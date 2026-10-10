# Hosting Zynalive (step by step)

Everything runs on managed services: no servers to look after.

| Piece | Where | Status |
|---|---|---|
| Database, login checks, server functions, file storage, realtime | Supabase (`mdfjbhzriuwxafeagnwo`, us-east-1) | Running. 5 database updates waiting (step 1). |
| Sign-in | Clerk | Running on a development key (`pk_test_…`). |
| Live video | LiveKit Cloud | Needs its secrets in Supabase (step 2). |
| Website (zynalive.com) | Vercel, static Expo web export (`vercel.json`) | Not created yet (step 3). |
| AI agents + media worker | Render, two always-on workers (`render.yaml`) | Not created yet (step 4). |
| Phone app | Expo EAS (builds + over-the-air updates) | Running; blocked on build minutes / network (step 5). |

## 1. Database updates (Supabase)

Supabase → **SQL Editor** → paste the file `zynalive-database-updates.sql` (round 5 fixes, gift
hot-row fix, indexes, rankings cache, viral-live fix) → **Run** once. Safe to run twice. Or apply
these migrations in order: `20261005040000`, `20261010010000`, `20261010020000`, `20261010030000`,
`20261010040000`.

## 2. Server function secrets (Supabase)

Supabase → **Edge Functions → Secrets**: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`CLERK_ISSUER`, `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`,
`DIDIT_API_KEY` (see `docs/ENVIRONMENT.md`). Point the LiveKit webhook at
`/functions/v1/livekit-webhook` and the Stripe webhook at `/functions/v1/stripe-webhook`.
Never paste these into chat or the repository.

## 3. Website (Vercel) — about 5 minutes

1. vercel.com → **Add New → Project** → import GitHub repository `shahriyarkhan84-gif/app`
   (if it isn't listed: **Adjust GitHub App Permissions** and allow this repository).
2. Leave the build settings alone: `vercel.json` sets them (build `npx expo export -p web`,
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
site sells coins (or host the same `dist` folder on Cloudflare Pages, whose free plan allows it).

## 4. AI agents + media worker (Render) — about 5 minutes

1. render.com → **New → Blueprint** → pick `shahriyarkhan84-gif/app`. Render reads `render.yaml`
   and proposes two workers: `zynalive-ai-agents` and `zynalive-media`.
2. Fill the secrets it asks for:
   - `DATABASE_URL`: Supabase → **Connect** → *Session pooler* connection string (with the database password).
   - `ANTHROPIC_API_KEY`: from console.anthropic.com.
   - `SUPABASE_SERVICE_ROLE_KEY` (media only): Supabase → Settings → API keys → service role / secret key.
3. **Apply**. Both redeploy on every push. Logs: Render → service → **Logs**.

The media worker transcodes video; if uploads wait long, raise its plan. Without it, video uploads
stay "processing". Without the AI worker, moderation proposals, recommendations and the creator
coach stop (the app still works).

## 5. Phone app (Expo EAS)

- Over-the-air updates (JavaScript changes, no store review): `npx eas-cli update --channel preview`
  or the `publish-preview-update.yml` workflow. Needs an `EXPO_TOKEN` (cloud environment variable)
  and network access to `api.expo.dev`, or build minutes on the Expo plan.
- New native code (e.g. `expo-observe`) needs a new build: `npx eas-cli build --profile preview`.

## Checks after going live

- Website: open the site, sign in, Home loads live rooms.
- Supabase → **Advisors** (security + performance) shows nothing new.
- Render logs show the workers polling without errors.
- Before a big event: run the load test against a staging Supabase project (`docs/LOAD_TEST.md`).
