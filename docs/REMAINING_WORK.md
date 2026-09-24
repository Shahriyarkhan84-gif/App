# Remaining work

Status of the 15 products against this repo (not the architecture's "done"
labels, which describe the design). ✅ built & tested · 🟡 partial · ⬜ not started.

| # | Product | Status | What exists / what's missing |
|---|---|---|---|
| 1 | User/viewer app | ✅ | Login, profile, discover (search, HOST-ID lookup, rankings), watch live, chat, gifts, follow, DMs, notifications, wallet |
| 2 | Creator/host system | ✅ | Become host, go live (camera/mic), room admins (≤5), moderation actions, stream summary + AI coaching, earnings & withdrawals |
| 3 | Agency system | 🟡 | Schema, isolation, RPCs (create agency, members, recruit unassigned hosts). **Missing: agency web dashboard, host applications/invites** |
| 4 | Agent system | 🟡 | Agent membership role with no financial access. **Missing: recruitment UI** |
| 5 | Owner/admin platform | 🟡 | Owner command center (AI CEO briefing, AI proposals, reports, withdrawals, settings). **Missing: users/hosts/agencies/rooms/coins/gifts/transactions/audit-log screens (~28 owner screens)** |
| 6 | Live streaming infra | 🟡 | LiveKit tokens/webhooks, adaptive stream, dynacast, 1080p simulcast with 360p/720p fallbacks. **Missing: HDR detection → HDR10/HLG pipeline and 4K (needs LiveKit egress + a transcoding service); upload/VOD pipeline** |
| 7 | Coin + gift economy | ✅ | Ledger, 90/5/5 gift engine, purchase money path, idempotency, concurrency-tested |
| 8 | Payment + withdrawal | 🟡 | Stripe purchases, refunds, chargebacks, withdrawal review. **Missing: local rails (JazzCash/Easypaisa collection), automated payouts; coin→PKR rate decision** |
| 9 | Chat + social | ✅ | Room chat, DMs, follows, blocks, word filters, anti-spam |
| 10 | Ranking + events | 🟡 | Live/creator/gifter/country rankings. **Missing: events, battles (PK)** |
| 11 | Safety + moderation | ✅ | AI moderation, reports, room admin, action ladder, audit logs |
| 12 | AI platform | 🟡 | AI CEO + Finance/Economy/Streaming AI, moderation, fraud, support, creator assist, translation, recommendations. **Missing: subtitles (speech-to-text)** |
| 13 | Marketing + SEO | ⬜ | AI Growth Manager / SEO AI not started |
| 14 | Notifications | 🟡 | In-app (DB + realtime) and email (welcome). **Missing: push (expo-notifications), SMS** |
| 15 | Analytics | 🟡 | PostHog events; DAU/MAU/D7 retention/revenue in AI CEO KPIs. **Missing: ARPU/LTV/CPA/ROAS dashboards (need marketing spend data)** |

## Also pending

- Localization layer (phase 2 in the architecture): UI strings are English.
- Web dashboards for Agency (9 sections) and Owner (14 sections) beyond the command center.
- Component and end-to-end tests for mobile flows (viewer join→chat→gift→leave; host go-live→end→summary) — needs a dev build on a device farm (e.g. Maestro on EAS).
- App-store review: selling coins through Stripe from inside iOS/Android apps may require in-app purchases depending on market; plan IAP (e.g. RevenueCat) for native if needed.
