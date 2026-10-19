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
| `CLERK_SECRET_KEY` | `delete-account` (deletes the Clerk user). Server-side only. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | `livekit-token`, `livekit-webhook` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `coins-checkout`, `stripe-webhook` |
| `STRIPE_PUBLISHABLE_KEY` (`pk_test_…`/`pk_live_…`, same mode as the secret key; public, safe to share) | `coins-checkout`: turns on Zynalive's own payment page (zynalive.com/pay); without it buyers use Stripe's hosted page |
| `SITE_URL` | Stripe return URLs |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | rate limiting (optional; limits off without it) |
| `PINECONE_API_KEY` | `smart-search` (optional; the app falls back to word search and same-category lives without it). `PINECONE_INDEX` (default `zynalive-live`) or `PINECONE_INDEX_HOST` to skip the index lookup |
| `RESEND_API_KEY`, `EMAIL_FROM` | welcome email (optional) |
| `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET` | `didit-session`, `didit-webhook` (host identity verification) |
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
