# Full-stack migration plan

Zynalive started on Expo + Supabase (Postgres/RLS/RPCs) + Clerk + LiveKit. The
product direction is now a from-scratch platform on:

- **API**: NestJS + Prisma + PostgreSQL + Redis + Socket.IO
- **Streaming**: Amazon IVS (RTMP ingest / HLS playback) for one-way live,
  WebRTC for interactive multi-guest sessions
- **Web**: Next.js (viewer web app, creator dashboard, admin dashboard)
- **Mobile**: stays Expo/React Native, repointed at the new API instead of
  Supabase
- **Auth**: custom JWT issued by the API (email + phone OTP, Google, Apple,
  2FA) — Clerk is retired
- **Infra**: Docker, Kubernetes, CloudFront, S3, CI/CD

This is a ground-up rewrite, not a data migration — there is no production
data to carry over. The existing Supabase schema (`supabase/migrations/`) and
RPCs stay in the repo as the source of truth for *business rules* (gift
splits, RLS-equivalent authorization, financial invariants) while every table
and rule is re-implemented in Prisma + NestJS services. Nothing in
`supabase/` is deleted until its NestJS/Prisma equivalent has passed the
same test cases the SQL suite (`supabase/tests/`) already covers.

## Why phased, not all-at-once

The feature list this migration targets (multi-host live, AI moderation,
subscriptions, clip generation, admin panel, web + mobile + dashboards, full
DevOps) is a multi-month build for a real team. Each phase below is a
complete, independently useful slice, committed and pushed on its own.

## Repo layout (target)

```
apps/
  mobile/   -- existing Expo app (moves here once the API has parity)
  api/      -- NestJS backend
  web/      -- Next.js viewer/creator/admin web app
packages/
  database/ -- Prisma schema + generated client, shared by api (and web via tRPC/REST types)
supabase/   -- kept as the reference implementation until retired per-domain
```

The Expo app stays at the repo root for now (moving it is a large, disruptive
change of its own — CI, EAS config, and every relative import would need to
move in lockstep). It moves into `apps/mobile` in the phase that repoints it
at the new API.

## Phases

### Phase 1 — Foundation (this change)
- Prisma schema translating the core Supabase tables (identity, agencies,
  hosts, rooms, streams, social graph, wallets, gifts, payments, withdrawals).
- NestJS skeleton: Prisma integration, JWT auth module (email/password +
  Google/Apple stubs), Users module, Streams module (list live rooms, go
  live, end stream) as real, working vertical slices.
- Next.js skeleton: home feed page reading from the new API.
- `docker-compose.yml` for local Postgres + Redis + API + web.

### Phase 2 — Auth & identity parity
- Full JWT auth (refresh tokens, phone OTP via an SMS provider, 2FA).
- Role/permission guards equivalent to `current_app_role()` /
  `is_platform_admin()`.
- Profile CRUD, follow graph, blocks.

### Phase 3 — Streaming core
- Amazon IVS channel provisioning per host (replaces LiveKit room-per-host).
- Go-live / end-stream lifecycle, viewer counts, stream summaries.
- WebRTC guest/multi-host layer for PK-battle-equivalent and multi-guest
  rooms (IVS handles one-way broadcast; guests need a separate interactive
  path, same as the current LiveKit-based PK battles).

### Phase 4 — Chat & realtime
- Socket.IO gateway for room chat, DMs, notifications (replaces Supabase
  Realtime).
- Redis pub/sub for horizontal scale-out across API instances.

### Phase 5 — Economy
- Wallet, coin packages, Stripe + Apple/Google IAP webhooks, gift engine with
  the same host/stream/owner split invariants as `20260924020000_economy.sql`,
  creator earnings, withdrawals. Every financial rule gets a Jest test
  mirroring its `supabase/tests/10_must_pass.sql` case before the SQL
  equivalent is retired.

### Phase 6 — AI moderation & discovery
- Chat/content moderation pipeline, recommendation engine, search.

### Phase 7 — Dashboards & admin
- Creator dashboard (Next.js): analytics, earnings, scheduled events, clips.
- Admin dashboard (Next.js): user/creator/report/gift/revenue management.

### Phase 8 — Mobile repoint + infra

Unlike Phases 1–7, which only ever added new, isolated files, this phase
edits the live, shipped Expo app — the one thing in this repo real users
depend on today. It's sequenced screen-by-screen, not as one cutover:

1. **Foundation (additive, done)** — `src/lib/api-client.ts`: token
   storage (`expo-secure-store`), authenticated `apiFetch()` with
   auto-refresh-on-401. Nothing imports it yet.
2. **Auth + data screens move together, not separately (revised after
   inspecting the code — see Status).** `src/lib/supabase.tsx` authenticates
   *every* Supabase query app-wide with the Clerk session's JWT
   (`accessToken: async () => (await getToken()) ?? null`) — Postgres RLS
   reads the Clerk user id straight from that JWT. A user can't be
   "signed in" via the new API while every data screen still needs a live
   Clerk session underneath it; auth and Supabase-dependent screens are one
   coupled system today, not two. So the real order is:
   1. Build the parallel session layer (`src/lib/auth-api.ts` +
      `src/lib/zyna-auth.tsx`) — additive, done, not wired into
      `_layout.tsx` or any gated route yet.
   2. Build the API-backed equivalents of the Supabase-dependent hooks the
      screens actually use (`useProfile`, room/feed reads, ...) *before*
      touching a single screen — this is the real bulk of the work, not a
      per-screen `fetch` swap. Response field names also need mapping:
      `apps/api` returns Prisma's camelCase (`displayName`, `avatarUrl`),
      the existing `Profile` type (`src/lib/types.ts`) expects the
      snake_case Supabase's RPCs return.
   3. Once enough of those exist, cut sign-in/sign-up and their dependent
      screens over together, behind both systems still present in the tree
      so a broken cutover is a revert, not a rewrite.
3. *(folded into step 2 above)*
4. **Realtime** — add `socket.io-client` (not yet a dependency; deferred
   rather than added unused) and a `src/lib/realtime.ts` wrapper once a
   screen actually needs it (chat first), replacing `useRealtime()`'s
   Supabase Realtime subscriptions.
5. **Streaming** — swap the LiveKit host/viewer components for an IVS HLS
   player (viewers) and an RTMP publish flow (hosts, likely
   `react-native-nodemediaclient` or a custom native module — Amazon IVS
   has no first-party Expo/RN broadcast SDK, unlike LiveKit's). This is
   its own significant sub-effort, not a drop-in swap.
6. **Money screens last** (wallet, gifts, withdrawals, host verification) —
   only after 2–5 are proven, given Phase 5's trust-boundary work.
7. **Repo move + infra** — once every screen is repointed and Supabase/
   Clerk/LiveKit packages are unused, move the app into `apps/mobile` (a
   single mechanical commit at that point, not before — moving it earlier
   just adds churn to every step above), update EAS config and CI, then
   add Kubernetes manifests and CloudFront/S3 for media.

Steps 2–6 each touch a live screen and deserve their own review/testing
pass, not a single sweeping diff — see the Status section for what's
actually been done vs. planned.

## Status

- **Phase 1 — done.** Prisma schema, NestJS skeleton, Next.js skeleton,
  docker-compose.
- **Phase 2 — done.** Full JWT auth: register/login, refresh-token rotation
  with hashed storage, logout/revocation; phone OTP sign-in behind a
  pluggable `SmsProvider` (console-log stub); Google and Apple ID-token
  verification via `google-auth-library` / `apple-signin-auth`; TOTP 2FA
  (`otplib`) with setup/enable/disable and a login-challenge step; a
  `RolesGuard` + `@Roles()` decorator mirroring
  `is_platform_admin()`/`current_app_role()`, applied to an admin-only user
  listing; profile CRUD and the follow/block graph (blocking severs follows
  both ways, matching the RPC behavior).
- **Phase 3 (streaming core) — done.** `HostsModule.becomeHost()` provisions
  one standing Amazon IVS channel per host via `IvsService`
  (`@aws-sdk/client-ivs`) and stores its ARN/playback URL/ingest endpoint on
  `Room`; `goLive()`/`endStream()` flip status against that channel;
  `GET /streams/credentials` fetches a fresh stream-key value from IVS on
  demand (never persisted in plaintext). `BattlesModule` translates
  `invite_pk_battle`/`respond_pk_battle`/`end_pk_battle` from
  `20260924200000_pk_battles.sql` 1:1, including the notify-both-hosts and
  clear-`currentBattleId` behavior; `applyGiftScore()` is wired and ready but
  unused until the gift-send flow lands in Phase 5.
- **Phase 4 (chat & realtime) — done.** `RealtimeGateway` (Socket.IO):
  JWT-authenticated handshake, every client auto-joins `user:<id>`, explicit
  `room:join`/`room:leave` for room channels, `chat:send`/`dm:send` persist
  via `ChatService` then broadcast. `RedisIoAdapter`
  (`@socket.io/redis-adapter` + `ioredis`) fans events out across API
  instances when `REDIS_URL` is set. `ChatModule` adds REST history
  (`GET /chat/rooms/:roomId/messages`, `GET /chat/dms/:userId`) for initial
  load. `BattlesService.notify()` now pushes `notification:new` over the
  gateway instead of only inserting a row, and `respond()`/`end()` emit
  `battle:started` (carrying each side's *opponent* IVS playback URL) and
  `battle:ended` — this closes the "cross-room viewing" item deferred from
  Phase 3: since IVS playback is plain HLS, dual-viewing needs no WebRTC,
  just telling each client the other room's URL. True guest co-hosting
  (someone who isn't a host *publishing* into a room) is a distinct,
  not-yet-built capability that would need real WebRTC/SFU infra — it's out
  of scope for PK battles.
- Verified for real this time, not just visually: `apps/api` +
  `packages/database` were `npm install`ed and `npx tsc --noEmit` run
  against the actual installed deps in an isolated scratch copy (so the
  real Expo app's `node_modules` was never touched) — 0 errors after
  dropping `declaration: true` from `apps/api/tsconfig.json` (unnecessary
  for an application, and it was the source of a handful of TS2742 errors).
- **Phase 5 (economy) — done.** `WalletsService` holds the two shared
  money-primitives everything else builds on: `lockWallet()` (row-locks via
  raw `SELECT ... FOR UPDATE`, then re-reads through the typed API — Prisma
  has no native row-lock method) and `applyCoinDelta()` (ledgered balance
  change). `GiftsService.sendGift()` is a close translation of
  `send_gift()`: same order of operations (lock → idempotency check that
  short-circuits *before* any other validation → status/frozen/room/ban/
  catalog checks → split → charge → earnings/ledger/stream totals →
  `BattlesService.applyGiftScore()`). `PaymentsService` covers
  `internal_create_payment`/`internal_credit_payment`/
  `internal_refund_payment`/`internal_dispute_payment`/`request_refund`/
  `review_refund`; `StripeWebhookController` verifies the signature against
  the raw body (`rawBody: true` in `main.ts`) and uses
  `ProcessedWebhookEvent` for replay protection. `EarningsService` covers
  `request_withdrawal`/`review_withdrawal`/`mark_withdrawal_paid`. Added a
  minimal `ModerationAction` model (just `account_review` flagging) since
  the chargeback/refund-shortfall path needs it — the full action ladder is
  still Phase 6.
  **Not ported:** Apple/Google IAP webhooks (Stripe only so far) and
  `private.audit()` call sites (no `AuditLog` model yet — real gap, not
  fabricated as done).
  **Verified for real:** the same isolated-scratch-copy method as Phase
  4 — `npm install` + `tsc --noEmit`, 0 errors, plus `npx jest` actually
  run and passing (5/5) against a hand-built fake Prisma transaction that
  asserts the exact call sequence: split math sums to the charged total,
  insufficient-balance/self-gift/banned-from-room rejections, and an
  idempotent replay that never touches the wallet a second time. This is a
  unit-level mirror of `supabase/tests/10_must_pass.sql`'s gift-split and
  duplicate-gift cases — there is no live Postgres in this environment to
  run the real integration-level SQL suite equivalent against.
- **Phase 6 (AI moderation & discovery) — done.** Translated from
  `20260924030000_moderation_ai.sql`:
  - `ModerationService`: `applyModerationAction()` (admin), the shared
    `applyModeration()` every path funnels through (protected-account check
    for staff, temp/permanent ban → user status + force the room offline,
    report → `actioned`, realtime notification), `internalAiModeration()`
    (low-impact only: warning/content_removal), `reviewAiAction()`,
    `internalExecuteAiAction()` (executes an *approved* proposal — AI never
    acts directly), `proposeAiAction()`. `internal*` routes sit behind a new
    `InternalAuthGuard` (shared-secret header) standing in for Postgres's
    `service_role`, since a plain NestJS app has no equivalent concept —
    the AI worker (`agents/`) will need this secret once it's repointed at
    this API.
  - `AiJobsService.enqueue()`: the Postgres-backed job queue the LangGraph
    worker already consumes, with the same dedupe-key-as-idempotency
    behavior as `on conflict (dedupe_key) do nothing` (via catching the
    unique-constraint error, not a racy read-then-write).
  - `ReportsModule`: `report_content()` (rate-limited, resolves the target
    user per type, enqueues `moderate_report`), `dismiss_report()`, admin
    listing.
  - **Real gap fixed, not just ported:** Phase 4's `ChatService` shipped
    without send_chat_message()'s anti-spam (5 msgs/10s), duplicate-message,
    word-filter (mask/block), or any-active-ban (not just mute) checks, or
    the `moderate_message` AI job enqueue. All of that is now in place —
    this was a real correctness hole in production chat, caught while
    working through the SQL file phase-by-phase rather than trusting the
    earlier pass was complete.
  - `RankingsModule.getRankings()`: raw SQL (window functions + grouped
    aggregation don't fit Prisma's query builder), one query per kind
    (gifter/creator/country/live), translated statement-for-statement.
  - `RecommendationsModule`/`SupportModule`: read/write surface for
    `user_recommendations` and `support_tickets` — the actual scoring and
    AI replies are computed by the worker via the job queue, not by this API.
  - **Verified for real:** same isolated-scratch-copy method — `tsc --noEmit`
    against the real dependencies (0 errors; this caught and fixed a real
    bug, an untyped `Record<string, unknown>` passed where Prisma's
    `InputJsonValue` was required) and `npx jest` re-run to confirm Phase
    5's gift tests still pass unchanged.
- **Phase 7 (dashboards & admin) — creator + admin done, no clips/scheduled
  events yet.** Three small backend additions the dashboards needed and
  didn't have: `GET /streams/me` (a host's own room), `GET
  /moderation/ai-actions` (list, for the review queue), `GET /withdrawals`
  (list, for the payout queue).
  - `apps/web` gained client-side JWT auth (`AuthProvider`, `useAuth()`,
    token in `localStorage` — explicitly noted as an MVP shortcut; a real
    deployment should move to httpOnly cookies + server-side refresh), a
    `/login` page, and `RequireAuth`/`adminOnly` route guards.
  - `/creator`: wallet balance, earnings, own room/live status, a
    withdrawal-request form.
  - `/admin`: open reports (dismiss), AI proposals awaiting review
    (approve/reject — the same "AI proposes, owner approves" boundary from
    Phase 6, now with a UI), pending withdrawals (approve/reject).
  - Not built: creator analytics/clips/scheduled-events, and the rest of
    the admin surface (user management beyond the existing `GET /users`,
    revenue reports, feature flags) — explicitly deferred, not silently
    dropped.
  - **Verified for real, and it caught two real bugs an isolated `tsc`
    check on the API alone wouldn't have:** `apps/web` was `npm install`ed
    and **actually built** (`next build`) in an isolated scratch copy. That
    caught (1) `next.config.ts` isn't supported on Next 14.2 — needed
    `next.config.mjs` instead, and (2) the home page's `fetchLiveRooms()`
    let a network exception (API unreachable) crash the whole page instead
    of degrading to an empty feed, which `next build`'s static prerendering
    surfaced immediately. Both are fixed in the committed files, not just
    in the scratch copy. `next lint` (added `eslint`/`eslint-config-next`,
    which weren't there before) also ran clean. The API side was re-verified
    the same way as every other phase (`tsc --noEmit` + `npx jest` against
    real dependencies).
- **Phase 8 (mobile repoint + infra) — session-layer foundation done, no
  screen touched yet.**
  - `src/lib/api-client.ts`: `expo-secure-store` token storage,
    `apiFetch()` with auto-refresh-on-401 (mirrors `@supabase/supabase-js`'s
    own retry-on-401 behavior), errors thrown with the same string codes
    the SQL/RPC errors used so `friendlyError()` keeps working unchanged.
  - `src/lib/auth-api.ts`: pure wrappers for register/login/OTP/Google/
    Apple/2FA against `apps/api`'s `/auth/*`.
  - `src/lib/zyna-auth.tsx`: `ZynaAuthProvider`/`useZynaAuth()` — named
    `Zyna*` specifically to not collide with `@clerk/clerk-expo`'s own
    `useAuth()` while both exist in the tree. **Not** added to
    `src/app/_layout.tsx` and no screen imports it yet — see the phase
    plan above for why (it's coupled to the Supabase data layer, not a
    standalone swap).
  - **Real discovery that reshaped the plan, not just an implementation
    detail:** inspecting `src/lib/supabase.tsx` before touching any auth
    screen showed the Clerk session JWT authenticates every single
    Supabase query app-wide (`accessToken: async () => (await getToken())`)
    — Postgres RLS reads the Clerk user id from it directly. The original
    plan's steps 2 ("auth") and 3 ("read-only data screens") were written
    as if separable; they're not — a signed-in user needs the new API for
    both auth *and* every data read simultaneously, or neither. Revised
    into a single combined step in the plan above rather than silently
    building toward a two-step plan that can't actually ship.
  - Caught a real bug in the new session code itself, same class the
    codebase already hit once in `PkBattle.tsx`: the initial
    `useEffect(() => void reload(), [])` called `setState` synchronously
    from the effect body (`react-hooks/set-state-in-effect`, real ESLint
    failure, not hypothetical). Fixed with the same deferred-`setTimeout`
    pattern `ProfileProvider` already uses, for consistency.
  - **Verified for real** against the app's actual, already-installed
    `node_modules` (no scratch copy needed — these files live inside the
    already-`npm install`ed Expo project): `npx tsc --noEmit` and
    `npx expo lint` both clean.
  - Added `EXPO_PUBLIC_API_URL` to `.env.example`/`env.ts`, not yet in
    `missingRequiredEnv` since nothing requires it yet.
  - Not started: the API-backed replacements for `useProfile()` and the
    other Supabase-dependent hooks (the real bulk of this step), the
    actual screen cutover, realtime, streaming, money screens, the repo
    move.
- Nothing has still been `npm install`ed in the repo itself — do that
  before running `apps/api`/`apps/web` locally. IVS calls need
  `AWS_REGION`/credentials configured, Stripe needs
  `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, and the AI worker needs
  `INTERNAL_API_SECRET` (see `apps/api/.env.example`).
