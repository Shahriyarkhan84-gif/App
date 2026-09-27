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
- Move the Expo app into `apps/mobile`, swap Supabase/Clerk/LiveKit clients
  for the NestJS API + Amazon IVS SDK.
- Kubernetes manifests, CloudFront/S3 for media, CI/CD across all three apps.

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
  Nothing has still been `npm install`ed in the repo itself — do that
  before running `apps/api`/`apps/web` locally. IVS calls need
  `AWS_REGION`/credentials configured (see `apps/api/.env.example`).
