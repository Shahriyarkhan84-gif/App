# Zynalive architecture

South-Asia-first live streaming and social platform. This repo implements the
**Phase 1 foundation** of the master architecture: the user/host mobile app,
the shared backend, the coin & gift economy, safety, and the AI system running
in the background as LangGraph agents. The status of every product and screen
is tracked in [REMAINING_WORK.md](REMAINING_WORK.md).

```
                        👑 Owner
                           │  (Owner command center — /admin in the app)
                    🧠 AI CEO (LangGraph supervisor)
          ┌────────────────┼────────────────┐
     💰 Finance AI     🎁 Economy AI     📡 Streaming AI      ← parallel branches
   Agency·User·Fraud  Host·Gift·Wallet  LiveKit·Cost·Quality
          └────────────────┼────────────────┘
                     ai_reports + ai_actions (proposals → owner approval)

 Expo app (iOS/Android/Web) ── Clerk JWT ──> Supabase Postgres (RLS + RPCs) ── Realtime ──> app
        │                                        ▲        │ ai_jobs queue
        │ livekit-token (edge fn)                │        ▼
        └────────> LiveKit (WebRTC, simulcast) ──┘   agents/ worker (LangGraph + Claude)
                         │ webhook                     moderation · fraud · support ·
                         ▼                             creator assist · translation ·
                  livekit-webhook (edge fn)            recommendations · AI CEO
 Stripe Checkout ──> stripe-webhook (edge fn) ──> internal_credit_payment() ──> coins

 Upload pipeline:  app ──> uploads/<host>/<asset> ──┐
 Live pipeline:    LiveKit egress (record_live) ────┤──> media worker (WORKER_QUEUES=media)
                                                    │    ffprobe → HDR detection (PQ→HDR10, HLG, SDR)
                                                    │    → 4K HDR · 1080p HDR · SDR fallback ladder
                                                    │    → fMP4 HLS + VIDEO-RANGE master (adaptive bitrate)
                                                    └──> media/<asset>/master.m3u8 ──> expo-video player
                                                         + 🤖 Subtitles (Whisper → Claude translation → HLS tracks)
 Localization layer: src/lib/i18n (en · ur (RTL) · hi · bn), region default language
 Engagement layer:   PK battles + events (gifting races, battle leagues) scored by triggers
 Regional variants:  regions (currency, language, timezone, features) → regional pricing
```

## Components

| Layer | Tech | Where |
|---|---|---|
| Mobile + web app | Expo SDK 57, Expo Router, React Native 0.86 | `src/` |
| Auth | Clerk (email code, Google, Apple) → Supabase third-party auth | `src/app/(auth)`, `src/lib/supabase.tsx` |
| Database | Postgres (Supabase) with RLS; all money/role/moderation writes are `security definer` RPCs | `supabase/migrations/` |
| Realtime | Supabase Realtime (chat, gifts, rooms, wallet, notifications) | `src/lib/hooks.ts` `useRealtime` |
| Live video | LiveKit: tokens minted server-side, adaptive stream + dynacast, 1080p simulcast (360p/720p fallback layers) | `supabase/functions/livekit-*`, `src/components/LiveStage*.tsx` |
| Payments | Stripe Checkout (coin packages), verified webhook, refunds, disputes | `supabase/functions/coins-checkout`, `stripe-webhook` |
| Redis | Upstash — rate limiting for token/checkout endpoints | `supabase/functions/_shared/redis.ts` |
| AI system | LangGraph worker + Claude (structured outputs), Postgres job queue | `agents/` |
| Email | Resend (welcome) | `supabase/functions/_shared/email.ts` |
| Analytics / errors | PostHog, Sentry | `src/lib/analytics.ts`, `src/lib/sentry.ts` |
| Feedback | ProductBridge board link | Profile → Share feedback |
| Web hosting | Vercel (static Expo web export) | `vercel.json` |
| Media pipeline | Supabase Storage (`uploads` private, `media` public) + media worker (ffmpeg: libx264/libx265/zscale; Whisper) | `supabase/migrations/…25010000_media_pipeline.sql`, `agents/zynalive_agents/media/`, `src/app/videos/` |
| Localization | typed catalogs + provider, expo-localization (RTL) | `src/lib/i18n/` |
| Regions & events | `regions`, regional `coin_packages`, `events` + scoring triggers | `…25030000_regions_events.sql`, `src/app/events/` |

"Microservices" from the architecture (auth, streaming, chat, economy, payments,
creator-payouts, agencies, notifications, moderation, recommendations, AI,
analytics) are implemented as **modules of one Postgres schema + a handful of
edge functions + one worker**. That keeps transactions (e.g. gift → earnings →
ledger) atomic. Split out services only when load or team structure demands it.

## Request flows

**Watch live** — app reads `rooms` (RLS) → calls `livekit-token` (verifies
Clerk JWT, account + room bans, room is live) → joins LiveKit as subscriber-only.
Viewer counts come back through the LiveKit webhook into `rooms.viewer_count`
and out to clients via Realtime.

**Go live** — `become_host()` (Host ID = the user's 8-digit ID + room) →
`go_live()` creates a `streams` row and notifies followers → `livekit-token`
with `as: host` grants publish rights for camera + mic only.

**Chat** — `send_chat_message()` checks status, room bans, rate limits,
duplicates and the word filter, inserts, and enqueues `moderate_message` for
the Moderation agent, which can hide the message and warn the sender.

**Gift** — `send_gift(room, gift, qty, idempotency_key)` locks the sender's
wallet, dedupes on the key, debits, splits 90/5/5, credits creator earnings,
and writes ledger rows — one transaction. See [ECONOMY.md](ECONOMY.md).

**Buy coins** — `coins-checkout` creates a pending `payments` row priced from
`coin_packages` (never from the client) and a Stripe Checkout session. Only the
signed Stripe webhook can call `internal_credit_payment()`.

**Upload a video** — `create_media_upload()` reserves the asset and fixes the
object name → the app uploads to `uploads/<host id>/<asset>.<ext>` →
`submit_media_upload()` checks the object exists and queues `media_process` →
the media worker probes, detects HDR, encodes the ladder and calls
`internal_media_ready()` (SDR rung mandatory) → the owner is notified and
`media_subtitles` is queued if the video has audio. Players load
`<media_base>/<asset>/master.m3u8`: HDR displays pick the PQ/HLG variants,
everything else the SDR ladder, and bitrate adapts to the network.

**Live → replay** — with `media.record_live` on, `livekit-webhook` starts a
participant egress when the host joins; on `egress_ended` the recording is
registered with `internal_register_live_recording()` and goes through the same
pipeline. WebRTC live video is SDR, so replays come out SDR; HDR applies to
uploads (true HDR *live* needs an HEVC/HDR ingest such as RTMP/SRT, not built).

**Events** — admins publish an event (global or per region). Triggers on
`gifts` and ended `pk_battles` update `event_scores`; the worker finalizes
ended events (`event_results`, winner notifications).

**AI** — Postgres RPCs enqueue `ai_jobs`; the worker claims them with
`FOR UPDATE SKIP LOCKED`, runs the matching LangGraph graph, and writes results
back. Low-impact actions (hide message, warning) are automatic; anything that
restricts an account or touches money becomes an `ai_actions` proposal that an
owner approves in the command center. See [AI.md](AI.md).
