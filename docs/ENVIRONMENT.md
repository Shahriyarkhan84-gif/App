# Environment variables

Never commit real values. `.env` is git-ignored; `.env.example` files list names only.

## App (bundled — public only)

| Name | Purpose |
|---|---|
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase project URL + publishable key |
| `EXPO_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_POSTHOG_HOST` | Analytics (optional) |
| `EXPO_PUBLIC_SENTRY_DSN` | Error tracking (optional) |
| `EXPO_PUBLIC_PRODUCTBRIDGE_URL` | Feedback board (optional) |
| `EXPO_PUBLIC_SITE_URL` | Public web URL (Vercel / custom domain) |

The public Supabase URL and publishable key for the `zynalive` project are set in `eas.json` `env` so EAS builds pick them up. Clerk's publishable key goes in EAS environment variables (or `eas.json`) once the Clerk app exists.

The app never receives `LIVEKIT_API_SECRET`; `livekit-token` returns a short-lived
token plus `LIVEKIT_URL`.

## Supabase Edge Function secrets (`npx supabase secrets set …`)

| Name | Used by |
|---|---|
| `CLERK_ISSUER` | all user-facing functions (JWT verification), e.g. `https://xxx.clerk.accounts.dev` |
| `CLERK_WEBHOOK_SECRET` | `clerk-webhook` |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | `livekit-token`, `livekit-webhook` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `coins-checkout`, `stripe-webhook` |
| `SITE_URL` | Stripe return URLs |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | rate limiting (optional; limits off without it) |
| `RESEND_API_KEY`, `EMAIL_FROM` | welcome email (optional) |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

## Agents worker (`agents/.env`)

| Name | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | Direct/session Postgres connection string (server-side only) |
| `ANTHROPIC_API_KEY` | — | Claude API key |
| `AI_MODEL` | `claude-opus-5` | Default model for all branches |
| `AI_MODEL_<BRANCH>` | — | Per-branch override: `MODERATION`, `FRAUD`, `SUPPORT`, `CREATOR_ASSIST`, `TRANSLATION`, `CEO` |
| `AI_CONCURRENCY` | 4 | Parallel jobs per worker |
| `AI_CEO_EVERY_MIN` / `AI_FRAUD_EVERY_MIN` / `AI_RECS_EVERY_MIN` | 60 / 30 / 15 | Schedules |

## Build-time

| Name | Where |
|---|---|
| `SENTRY_AUTH_TOKEN` | EAS secret, uploads source maps |
