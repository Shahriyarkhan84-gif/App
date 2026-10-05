# Remaining work

Status of the 15 products against this repo (not the architecture's "done"
labels, which describe the design). ✅ built & tested · 🟡 partial · ⬜ not started.

| # | Product | Status | What exists / what's missing |
|---|---|---|---|
| 1 | User/viewer app | ✅ | Login, profile, home feeds (following/popular/nearby/new), Party search (rooms, people, 8-digit ID), rankings, watch live, chat, gifts, follow, DMs, notifications, wallet |
| 2 | Creator/host system | ✅ | Become host, Didit identity verification, go live (camera/mic), room admins (≤5), moderation actions, stream summary + AI coaching, earnings & withdrawals |
| 3 | Agency system | 🟡 | Schema, isolation, RPCs (create agency, members, recruit unassigned hosts). 4-digit agency codes used in host verification; in-app **Agency portal** (code + share/rotate, stats, hosts, applications); owner creates agencies by manager's 8-digit ID. **Missing: agency web dashboard (9 sections), adding agents/managers from the portal** |
| 4 | Agent system | 🟡 | Agent membership role with no financial access. **Missing: recruitment UI** |
| 5 | Owner/admin platform | 🟡 | Owner command center (AI CEO briefing, AI proposals, reports, withdrawals, settings). **Missing: users/hosts/agencies/rooms/coins/gifts/transactions/audit-log screens (~28 owner screens)** |
| 6 | Live streaming infra | ✅ | LiveKit tokens/webhooks, adaptive stream, dynacast, 1080p simulcast. **Upload/VOD pipeline + HDR detection → HDR10/HLG → 4K HDR · 1080p HDR · SDR fallback → adaptive HLS** (media worker), live recordings → replays. Limit: live WebRTC is SDR; HDR *live* would need an HEVC/HDR ingest (RTMP/SRT) |
| 7 | Coin + gift economy | ✅ | Ledger, 90/5/5 gift engine, purchase money path, idempotency, concurrency-tested |
| 8 | Payment + withdrawal | 🟡 | Stripe purchases, refunds, chargebacks, withdrawal review. **Missing: local rails (JazzCash/Easypaisa collection), automated payouts; coin→PKR rate decision** |
| 9 | Chat + social | ✅ | Room chat, DMs, follows, blocks, word filters, anti-spam |
| 10 | Ranking + events | ✅ | Rankings, PK battles, **events** (gifting races, PK battle leagues, per region, leaderboards, rewards, auto-finalize). Coin prizes are paid by an owner, not automatically |
| 11 | Safety + moderation | ✅ | AI moderation, reports, room admin, action ladder, audit logs |
| 12 | AI platform | ✅ | AI CEO + all 7 branches incl. **subtitles** (Whisper + Claude translation, VOD and live replays). Live captions during a stream not built |
| 13 | Marketing + SEO | ⬜ | AI Growth Manager / SEO AI not started |
| 14 | Notifications | 🟡 | In-app (DB + realtime) and email (welcome). **Missing: push (expo-notifications), SMS** |
| 15 | Analytics | 🟡 | PostHog events; DAU/MAU/D7 retention/revenue in AI CEO KPIs. **Missing: ARPU/LTV/CPA/ROAS dashboards (need marketing spend data)** |

## Also pending

- Design canvas screens not built yet: likes, agency web dashboard. Voice/video party rooms and the host dashboard are built; `livekit-token` and `livekit-webhook` are deployed to the hosted project (2026-10-05); going live needs the `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and `CLERK_ISSUER` Edge Function secrets and the LiveKit Cloud webhook pointed at `/functions/v1/livekit-webhook`. Other functions (checkout, Stripe/Clerk/Didit webhooks, delete-account, host-application) are not deployed yet.

- Localization: the layer and ur/hi/bn catalogs exist; screens outside tabs, states, profile menu, settings, videos and events still show English (move their strings into `src/lib/i18n/en.ts` as they're touched). Server notification copy is English.
- Regions: withdrawals are PKR-only (`pkr_per_coin`); other regions need their own payout rate + rails before `features.withdrawals` is switched on. Inactive markets (ID, MY, TR, Gulf, PH, NP) need coin packages before activation.
- Media: resumable (TUS) uploads for very large files; storage lifecycle rule to purge removed videos; AI visual moderation of uploads (reports + admin takedown only for now); host-profile video tab.
- NestJS stack: the media worker still talks to Supabase; pointing it at `apps/api` means calling the `/internal/media/*` endpoints and reading IVS recordings from S3.
- Web dashboards for Agency (9 sections) and Owner (14 sections) beyond the command center.
- End-to-end tests for mobile flows (viewer join→chat→gift→leave; host go-live→end→summary) — needs a dev build on a device farm (e.g. Maestro on EAS). Component tests exist (`npm test`, jest-expo + React Native Testing Library) for shared UI, the tab bar, theme and time formatting; extend them as screens change.
- Store review: Google Play requires Play Billing for coins bought inside the Android app (Stripe is fine on the web). Plan: RevenueCat or `react-native-iap` + a server-side receipt check that credits coins through the same ledger path.
- Store listing: fill the placeholders in `src/app/privacy.tsx` / `account-deletion.tsx` ([COMPANY LEGAL NAME], [SUPPORT EMAIL], [RETENTION PERIOD], [MINIMUM AGE]) and publish the web build so `/privacy` and `/account-deletion` have public URLs.
