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

No project values are written in the repository. App builds read `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_SITE_URL` from the EAS environment named by each `eas.json` profile (expo.dev → project → Environment variables: development, preview, production); the website build reads the same names from Vercel. The website's `/pay` and `/download` pages get the Supabase address filled in at build time (`%SUPABASE_URL%` in `scripts/web-landing.mjs`).

The app never receives `LIVEKIT_API_SECRET`; `livekit-token` returns a short-lived
token plus `LIVEKIT_URL`.

## Supabase Edge Function secrets (`npx supabase secrets set …`)

| Name | Used by |
|---|---|
| `CLERK_ISSUER` | all user-facing functions (JWT verification), e.g. `https://xxx.clerk.accounts.dev` |
| `CLERK_WEBHOOK_SECRET` | `clerk-webhook` |
| `CLERK_SECRET_KEY` | `delete-account` (deletes the Clerk user). Server-side only. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | `livekit-token`, `livekit-webhook` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `coins-checkout`, `stripe-webhook` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT` (the service account's JSON key, whole file as one value), `GOOGLE_PLAY_PACKAGE_NAME` (`com.zynalive.app`) | `iap-verify`, `store-notifications` (Play purchases, consume, voided purchases). In Play Console → Users and permissions, give the service account "View financial data" and "Manage orders" |
| `APPLE_BUNDLE_ID` (`com.zynalive.app`), `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY` (the .p8 key text) | `iap-verify`, `store-notifications` (App Store Server API key: App Store Connect → Users and Access → Integrations → In-App Purchase) |
| `STORE_NOTIFY_TOKEN` (random string) | `store-notifications`: Google's Pub/Sub push URL ends with `?token=<this>` |
| `IAP_ALLOW_TEST_PURCHASES` (`true` only on a test project) | Credit Play licence-tester and App Store sandbox purchases. Leave unset in production |
| `STRIPE_PUBLISHABLE_KEY` (`pk_test_…`/`pk_live_…`, same mode as the secret key; public, safe to share) | `coins-checkout`: turns on Zynalive's own payment page (zynalive.com/pay); without it buyers use Stripe's hosted page |
| `SITE_URL` | Stripe return URLs |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | rate limiting (optional; limits off without it) |
| `PINECONE_API_KEY` | `smart-search` (optional; the app falls back to word search and same-category lives without it). `PINECONE_INDEX` (default `zynalive-live`) or `PINECONE_INDEX_HOST` to skip the index lookup |
| `RESEND_API_KEY`, `EMAIL_FROM` | welcome email (optional) |
| `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET` | `didit-session`, `didit-webhook` (host identity verification) |
| `CNIC_HASH_KEY` | `host-application`: key for the hash of the full CNIC that stops one person verifying several host accounts (a long random string; never change it once set, or old applications stop matching). Without it the duplicate check is off. |
| `STORAGE_S3_ENDPOINT`, `STORAGE_S3_REGION`, `STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET` | `livekit-webhook` live recordings: LiveKit egress writes into the `uploads` bucket through Supabase Storage's S3 endpoint (Project settings → Storage → S3 access keys). Only needed when `platform_settings.media.record_live` is on. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

## Agents worker (`agents/.env`)

| Name | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | Direct/session Postgres connection string (server-side only) |
| `ANTHROPIC_API_KEY` | — | Claude API key |
| `AI_MODEL` | `claude-opus-5` | Default model for all branches |
| `AI_MODEL_<BRANCH>` | — | Per-branch override: `MODERATION`, `FRAUD`, `SUPPORT`, `CREATOR_ASSIST`, `TRANSLATION`, `CEO` |
| `AI_CONCURRENCY` | 4 | Parallel jobs per worker |
| `AI_DAILY_JOB_LIMIT` | 5000 | AI (Claude) jobs one worker starts per UTC day; past it AI jobs wait until the next day (media jobs keep running). `0` = no cap |
| `AI_CEO_EVERY_MIN` / `AI_FRAUD_EVERY_MIN` / `AI_RECS_EVERY_MIN` | 60 / 30 / 15 | Schedules |
| `WORKER_QUEUES` | `all` | `ai` (Dockerfile) · `media` (Dockerfile.media) · `all`. A replica never claims a job kind it has no handler for. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | — | Media worker only: downloads sources from `uploads`, writes HLS to `media`. Server-side only. |
| `MEDIA_PRESET` | `medium` | x264/x265 preset (`faster` to save CPU, `slow` for quality) |
| `SUBTITLES_MODEL` | `small` | Whisper model size for subtitles (needs `pip install '.[subtitles]'`) |
| `PINECONE_API_KEY` | — | Smart search: the AI worker syncs live rooms to Pinecone every minute (off when empty). Server-side only. |
| `PINECONE_INDEX` / `PINECONE_MODEL` | `zynalive-live` / `multilingual-e5-large` | Index (created on first sync, aws us-east-1) and Pinecone-hosted embedding model |

## Platform settings (owner-editable, `platform_settings.media`)

`media_base` (public URL of the `media` bucket — set per environment), `covers_base` (public URL of the `covers` bucket, e.g. `https://<ref>.supabase.co/storage/v1/object/public/covers` — required, or hosts can't add a cover and so can't go live), `avatars_base` (public URL of the `avatars` bucket — required, or `set_avatar` raises `not_configured` and nobody can change their photo; `20261019010000_bug_fixes.sql` fills it from `covers_base` when that is already set), `uploads_enabled`, `hdr_enabled`, `uhd_enabled` (4K rung), `record_live`, `max_upload_mb` (2048), `max_duration_s` (3600), `max_pending_uploads` (5), `subtitles_enabled`, `subtitle_languages` (`["en","ur","hi","bn"]`).

## NestJS API (`apps/api/.env`)

Media adds `MEDIA_UPLOADS_BUCKET` (private S3 bucket for sources; clients get presigned PUTs) and `MEDIA_BASE_URL` (CloudFront in front of the media bucket), alongside the existing `AWS_*`, `INTERNAL_API_SECRET` (worker callbacks) and Stripe/JWT variables.

## Build-time

| Name | Where |
|---|---|
| `SENTRY_AUTH_TOKEN` | EAS secret, uploads source maps |
| `BRAND` | Which client brand to build (`brands/<id>/brand.json`); default `zynalive`. See `docs/WHITE_LABEL.md` |

## iPhone install profile (`/ios.mobileconfig`)

Built by `npm run build:web` from the brand (see `docs/WHITE_LABEL.md`) and served with
`Content-Type: application/x-apple-aspen-config` (`vercel.json` and `public/_headers`). It holds one
Web Clip: the brand icon on the Home Screen, opening the web app full screen. No secrets.

It is **unsigned**, so iOS shows it as "Not Verified" (it still installs). To show "Verified", sign
it after the build with a code-signing or TLS certificate for the brand's domain (owner action):
`openssl smime -sign -signer cert.pem -inkey key.pem -certfile chain.pem -nodetach -outform der -in dist/ios.mobileconfig -out dist/ios.mobileconfig.signed && mv dist/ios.mobileconfig.signed dist/ios.mobileconfig`.
Keep the key out of the repo (a CI secret).
