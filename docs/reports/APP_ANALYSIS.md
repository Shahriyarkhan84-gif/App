# Zynalive app health report

**Date:** 2026-10-19 · **Version checked:** 0.9.63 (commit `5ae7ff3`) · **By:** App Analyst (read-only: no code changed)

> **Update (0.9.64):** the code-side findings (H1, H2 fallback, M1–M6, L1–L9, L11 and the ✗ cells in the screen-states table) are fixed in code; see `docs/CHANGELOG.md`. They go live once both waiting migrations are applied and the functions deployed. Still open: owner actions, H3, H4, L10.

## Summary

### Check results

| Check | Result |
|---|---|
| `npm run check:duplicates` | PASS: "No duplicate app packages." |
| `npm run typecheck` | PASS: no errors |
| `npm run lint` | PASS: no warnings |
| `npm test` | PASS: 12 suites, 42 tests |
| `cd agents && pytest` | PASS with gaps: 13 passed, **25 skipped** ("TEST_DATABASE_URL not set"). No local Postgres here, so the database-backed agent tests did not run. Run with `agents/.venv/bin/python -m pytest`; the system Python has no pytest. |
| `bash supabase/tests/run.sh` | NOT RUN: no local Postgres here (`pg_isready`: no response) |
| `npm run build:web` | NOT RUN: it rewrites `dist/`, and this review only reads code |

### Top 5 things to do next

1. **Apply the waiting database fix, then deploy the two LiveKit functions** (Known). Kicks, stuck lives and safe profile photos depend on it. When you do, also add `avatars_base` to the environment docs (finding L1).
2. **Turn rate limits on** by setting the Upstash secrets (H2). Right now every "max N per minute" limit is probably switched off, including the guard against guessing agency codes.
3. **Make the host ID check prove a live person** (H1). On the website anyone can upload any photo as the "face with CNIC" photo, and Didit approval makes them a host straight away.
4. **Use a production Clerk key in the production build** (H3) before any store release.
5. **Host the two workers on Render** (Known, H4). Until then AI moderation, the owner's approved AI actions, video processing, event results and smart-search updates never run.

### Findings by severity

| Critical | High | Medium | Low |
|---|---|---|---|
| 0 | 4 new + 1 Known | 6 | 11 |

"Known" items are already listed in `docs/REMAINING_WORK.md` or `docs/CHANGELOG.md`. They appear here only where they block something.

---

## Findings

### Critical

None found.

### High

**H1. A host's ID check can be passed with photos from the gallery (no liveness check)**
- Evidence: `src/app/verify-form.tsx:88-89` (on the web the "face with CNIC" photo comes from `launchImageLibraryAsync`, so any saved picture works). `supabase/functions/host-application/index.ts:31-37,83-89` (the server accepts any uploaded image and runs only a face *match*, with a decline threshold of 50, but no liveness check). `docs/REMAINING_WORK.md:32` (auto-approve is ON: a Didit approval makes the person a host at once).
- What goes wrong: someone with a stolen CNIC photo and a photo of its owner can become a verified host on zynalive.com. Verified hosts can withdraw money and join an agency. The phone app forces the camera, but the server cannot tell which app sent the photos.
- Fix: add a liveness step. Either use Didit's hosted session with liveness (`didit-session` already exists but is not deployed), or call Didit's passive-liveness check on the selfie in `host-application`. Until then, turn auto-approve off.
- Owner: security-engineer + backend-developer

**H2. Rate limits are probably switched off (Possible)**
- Evidence: `supabase/functions/_shared/redis.ts:22-24` (`rateLimit` does nothing when the Upstash secrets are missing). `docs/CHANGELOG.md:79` (0.9.48: config-status reported Upstash as "not configured"). `docs/SECURITY.md:27` says host applications are limited to 5 a day "which limits code guessing".
- What goes wrong: with no Upstash, none of these limits apply: checkout (5/min), LiveKit tokens (30/min), host application (5/day), smart search, account deletion and payments-reconcile. A wrong agency code is rejected *before* Didit is called (`host-application/index.ts:72-73`), so all 9,000 four-digit codes can be tried for free. Each try with a right code spends a Didit credit.
- Fix: set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, then confirm with `GET /functions/v1/config-status` (`rate_limits.ready: true`). Also consider a Postgres-counter fallback for `host-application`, so the limit cannot silently vanish.
- Owner: devops-engineer (secrets), backend-developer (fallback)

**H3. The production build uses Clerk's test (development) key**
- Evidence: `eas.json:56` (production profile `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` = `pk_test_…`, the same as development and preview at `eas.json:15,37`).
- What goes wrong: a store build would sign real users into Clerk's development instance. That instance is meant for testing and has development limits and behaviour. Moving to production later means every account has to move.
- Fix: create the Clerk production instance, put its `pk_live_…` key in the production profile, and point `CLERK_ISSUER` at it. Partly known: "Clerk production instance" is in `docs/REMAINING_WORK.md:33`.
- Owner: devops-engineer

**H4. Background workers are not hosted, so several features silently do nothing (Known, impact restated)**
- Evidence: `docs/REMAINING_WORK.md:26` (Render Blueprint not created). `agents/zynalive_agents/worker.py:163-170` (approved AI actions run only in the worker). `docs/ARCHITECTURE.md` "Upload a video" / "Events" flows depend on the worker.
- What goes wrong: chat AI moderation never runs. Owner-approved AI actions (bans, wallet freezes) stay "approved" but are never carried out. Uploaded videos stay "processing" (`src/app/videos/[id].tsx:85`). Events are not finalised automatically, and live rooms are not synced to smart search.
- Fix: create the Render Blueprint (`render.yaml`, `docs/HOSTING.md`). Until then, hide video upload and tell owners that approvals are not applied.
- Owner: devops-engineer

**H-Known. The 2026-10-19 bug-fix migration is committed but not live** (`supabase/migrations/20261019010000_bug_fixes.sql`). `livekit-webhook` and `livekit-enforce` are not deployed with it (`docs/CHANGELOG.md:16`). Until then kicked people keep watching for up to 2 hours (`src/lib/api.ts:53` fails quietly), and anyone can set any address as their profile photo (`src/app/profile-edit.tsx:62-65`).

### Medium

**M1. Every gift makes every viewer send 2 extra database requests**
- Evidence: `src/components/GiftSheet.tsx:156-161` (`GiftToasts` loads the sender's profile and the gift from `gift_catalog` for each gift, for each viewer).
- What goes wrong: in a busy live (1,000 viewers, 10 gifts a second) that is about 20,000 requests a second to a server about 250 ms away. Toasts arrive late and the database slows down for everyone.
- Fix: use the cached gift catalogue (already cached for 10 min elsewhere) and add the sender's name to the realtime payload, or cache names per room.
- Owner: frontend-mobile-developer

**M2. Home listens to every change of every room**
- Evidence: `src/app/(tabs)/index.tsx:89` (`useRealtime('rooms', undefined, …)`). `rooms.viewer_count` changes on every join and leave (`supabase/migrations/20261019010000_bug_fixes.sql:83-86`).
- What goes wrong: each person on Home receives every viewer-count change on the platform. The app ignores most of them (debounced), but the server still checks permissions and sends each one, so the load grows with users times rooms.
- Fix: subscribe only to status changes (for example, a small `room_status` broadcast or a filter on rooms shown), or refresh on a timer.
- Owner: frontend-mobile-developer / database-engineer

**M3. Home can draw up to 200 room cards at once (no virtualised list)**
- Evidence: `src/app/(tabs)/index.tsx:22` (`LIVE_LIMIT = 200`), `:58` (query), `:121` (`list.map` inside a `ScrollView` at `:152`).
- What goes wrong: on cheap Android phones, Home gets slow and uses a lot of memory once many rooms are live.
- Fix: render the grid with `FlatList` (or FlashList) with `numColumns`.
- Owner: frontend-mobile-developer

**M4. After the migration, coin prices may fall back to US dollars for some users (Possible)**
- Evidence: `supabase/migrations/20261019010000_bug_fixes.sql:4` (signed-out callers can no longer run `my_region()`). `src/app/wallet.tsx:53,59` (the wallet ignores an error from `my_region` and silently uses `GLOBAL`). `docs/CHANGELOG.md` 0.9.45 notes that some session tokens reach the database *without* the signed-in role.
- What goes wrong: if that happens, a Pakistani buyer sees USD packages, and checkout then fails with "invalid package" (`supabase/migrations/20261015010000_checkout_reuse.sql:13`). Events (`src/lib/events.ts:53-54`) would show an error instead.
- Fix: in the wallet, show an error (or retry) when `my_region` fails instead of guessing `GLOBAL`, and test a purchase right after applying the migration.
- Owner: frontend-mobile-developer

**M5. The Wallet shows nothing to buy, with no message, when a region has no packages**
- Evidence: `src/app/wallet.tsx:59-60` (packages filtered to the region), `:105` (`pick` is undefined when the list is empty), `:165` (no Buy button), and no empty state in `resolveState` at `:103`. `docs/REMAINING_WORK.md:39` says inactive markets have no packages yet.
- What goes wrong: users from those countries see an empty "Buy coins" area and an empty space where the button should be.
- Fix: add an empty state ("Coins are not on sale in your country yet").
- Owner: frontend-mobile-developer

**M6. After paying in the Android app, the "check with Stripe" safety net may not run until the Wallet is reopened (Possible)**
- Evidence: `src/app/wallet.tsx:66-79` (reconcile runs on focus, or when `returnStatus` changes). `:89-91` (on a phone, the in-app browser returns to the same, still-focused Wallet, so neither may change).
- What goes wrong: Stripe's webhook has received 0 events (Known), so this safety net is the only way coins arrive. The buyer can see "Waiting for payment confirmation" until they leave the Wallet and come back.
- Fix: call `reconcilePayments` right after `openAuthSessionAsync` returns, and poll a few times while `awaiting` is set.
- Owner: payment-engineer

### Low

**L1. A new environment can't save profile photos after the migration.** `supabase/migrations/20261019010000_bug_fixes.sql:107-109` creates `media.avatars_base` only if `covers_base` already exists, and `set_avatar` raises `not_configured` without it (`:122`). `docs/ENVIRONMENT.md:59` doesn't list `avatars_base`. Fix: document it next to `covers_base` (owner: technical-writer).

**L2. Paid but never credited if saving the Stripe reference fails (Possible).** `supabase/functions/coins-checkout/index.ts:103-107` throws after Stripe has made the page. The payment keeps no `provider_ref`, so `internal_credit_payment` can't find it (`supabase/migrations/20260924020000_economy.sql:299-300`), the webhook keeps failing, and after 2 hours the row is closed as failed (`20261017010000_payment_reconcile.sql:13-17`). Fix: fall back to `metadata.payment_id` in the webhook and reconciler (owner: payment-engineer).

**L3. Stuck lives are only swept when someone joins a live.** `supabase/migrations/20261019010000_bug_fixes.sql:79` runs `end_unconnected_lives()` only on join events, so on a quiet night a dead "live" can stay on Home. Fix: also sweep from `go_live` or the worker (owner: database-engineer).

**L4. Viewer count assumes the host is in the room.** `supabase/functions/livekit-webhook/index.ts:25` subtracts 1 for the host even when the host has dropped. Counts are off by one during host reconnects (Possible; owner: live-streaming-engineer).

**L5. `livekit-enforce` tells any signed-in user whether someone is kicked or muted in a room.** `supabase/functions/livekit-enforce/index.ts:31-49` returns `removed`/`listener`/`none` for any `userId`. This is a small privacy leak. Fix: return the same answer every time, or allow only room staff (owner: security-engineer).

**L6. Three screens have no offline state.** `src/app/host/live.tsx:199-203`, `src/app/host/summary.tsx:47-49` and `src/app/(tabs)/profile.tsx:64` show a spinner or a generic error when there's no connection (owner: frontend-mobile-developer).

**L7. People search scans every profile.** `src/app/(tabs)/party.tsx:81` uses `ilike '%term%'` on `profiles`, and no trigram index exists in `supabase/migrations/`. Fine now, slow at scale. Fix: add a `pg_trgm` index (owner: database-engineer).

**L8. No test checks that every table has Row Level Security.** RLS is on for every table today: `supabase/migrations/20260924040000_access.sql:60-66` plus each later migration. But `supabase/tests/10_must_pass.sql` has no assertion that would catch a future table without it. Fix: add one `pg_class.relrowsecurity` check (owner: qa-test-engineer).

**L9. Over-the-air updates can reach older APKs that lack new native code.** `app.json:6` keeps `version` at `1.0.0` with `runtimeVersion.policy: appVersion` (`:107-109`), though native config has changed (0.9.50, 0.9.58). `eas.json` builds on `"image": "latest"`, so builds are not repeatable. Already noted for EAS Observe in `docs/REMAINING_WORK.md:28`. Fix: bump `version` with each native change (owner: devops-engineer).

**L10. The website's Android download link expires on 2026-11-02.** `vercel.json:30` points at an Expo artifact link (`docs/HOSTING.md:120-121`). Known; the permanent fix is blocked by the 50 MB Storage limit. Rebuild and update the link before then (owner: devops-engineer).

**L11. Docs that no longer match the code** (owner: technical-writer):
- `docs/REMAINING_WORK.md:27` says "all repository migrations are applied", but `docs/CHANGELOG.md:16` says `20261019010000_bug_fixes.sql` is not.
- `docs/SECURITY.md:102` lists "anon can execute `my_region()`" as expected. The new migration removes that.
- `docs/ARCHITECTURE.md:101` and `docs/SECURITY.md:34` say only the Stripe webhook credits coins. `payments-reconcile` does too, from Stripe's own data, which is allowed by AGENTS.md.
- `docs/REMAINING_WORK.md:44` asks to fill placeholders in the privacy and account-deletion pages, but they are already filled (`src/app/privacy.tsx:7`).
- `docs/REMAINING_WORK.md:35` says the Clerk webhook isn't deployed. `docs/CHANGELOG.md` 0.9.40 says it is (0.9.48: its secret is missing).

---

## Screen states table

✓ handled · ✗ missing · — not needed for this screen · "inline" = handled inside the content rather than by `StateView`. This is based on reading how each screen builds its state. Form, legal and redirect screens are left out: `(auth)/*`, `privacy`, `terms`, `account-deletion`, `settings`, `menus`, `app`, `checkout-return`, `verify-return`, `sso-callback`.

| Screen | Loading | Success | Error | Empty | Offline | Permission | Disabled |
|---|---|---|---|---|---|---|---|
| Home `(tabs)/index` | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Party `(tabs)/party` | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Messages `(tabs)/messages` | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✗ (restricted users only find out on send) |
| Go live `(tabs)/create` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| Me `(tabs)/profile` | ✓ | ✓ | ✓ | — | ✗ | — | — |
| Wallet | ✓ | ✓ | ✓ | ✗ (M5) | ✓ | — | inline (frozen note only) |
| Earnings | ✓ | ✓ | ✓ | inline | ✓ | — | inline (verify / rate not set) |
| Live room `live/[roomId]` | ✓ | ✓ | ✓ | ✓ (ended) | ✓ | — | ✓ (removed) |
| Party room `party/[roomId]` | ✓ | ✓ | ✓ | ✓ (ended) | ✓ | — | ✓ |
| Host live `host/live` | ✓ | ✓ | ✓ | ✓ | ✗ | — | — |
| Host summary `host/summary` | ✓ | ✓ | ✓ | ✓ | ✗ | — | — |
| Host dashboard | ✓ | ✓ | ✓ | ✓ (not a host) | ✓ | — | — |
| Hosting | ✓ | ✓ | ✓ | — | ✓ | — | inline |
| Verify form | inline | ✓ | inline | — | inline | inline (camera) | — |
| Agency portal | ✓ | ✓ | ✓ | inline | ✓ | — | ✓ |
| Owner `admin/index` | ✓ | ✓ | ✓ | ✓ | ✓ | — (server checks role) | — |
| Chat `chat/[userId]` | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✗ (blocked only on send) |
| User profile `user/[id]` | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Contributions | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Rankings | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Events list / detail | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Frames shop | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Videos list / detail | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ (processing) |
| Video upload | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| Support | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Profile edit | inline | ✓ | inline | — | ✗ | ✗ (photo library permission not explained) | — |
| Delete account | inline | ✓ | inline | — | inline | — | inline |

---

## Owner actions (only you can do these)

1. **Approve and apply** `supabase/migrations/20261019010000_bug_fixes.sql`, then deploy `livekit-webhook` and `livekit-enforce` (Known).
2. **Upstash:** create a Redis database and add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to the Supabase function secrets (H2).
3. **Host verification:** decide whether to turn `host_verification.auto_approve` off until a liveness check is added (H1).
4. **Clerk:** create the production instance, and give the devops agent the `pk_live_` key and issuer URL (H3). Turn bot protection back on (Known).
5. **Render:** create the Blueprint for the AI and media workers (H4, Known).
6. **Stripe:** add the `STRIPE_PUBLISHABLE_KEY` secret, and check that the webhook endpoint in the Stripe Dashboard points at `/functions/v1/stripe-webhook` with the 7 listed events. It has received 0 events (Known).
7. **Agencies:** create at least one agency. With 0 agencies nobody can finish a host application, because an agency code is required (Known).
8. **Secrets:** roll the keys that leaked earlier (Known).
9. **APK link:** make a new build and update `vercel.json` before 2026-11-02, or move to Supabase Pro so the APK can be hosted permanently (Known).
