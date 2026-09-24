# Changelog

## 0.4.7 — One ID per person

- A host's Host ID is now the same 8-digit number as their user ID (existing hosts updated). The separate HOST-xxxxxxxx format is gone.

## 0.4.6 — 8-digit IDs

- User IDs are now random 8-digit numbers; every existing account was issued a new one.

## 0.4.5 — Hosting instructions

- New Hosting screen (Me → Verification for hosting): requirements, the 4 steps (become a host → Didit ID + selfie → review → Host badge) with live progress, a context-aware button, Didit walkthrough, tips and privacy note.

## 0.4.4 — Store readiness

- In-app account deletion (Me → Delete account) via the `delete-account` edge function; Clerk deletions go through the same cleanup.
- Public `/privacy` (draft — fill in placeholders) and `/account-deletion` pages for the store listings.
- Android: removed storage and draw-over-apps permissions the app doesn't use.

## 0.4.3 — Host badge

- Passing Didit verification marks the user verified and unlocks a red Host badge, shown on Me, profiles, room cards, Party and the live room. Unverified hosts see "Verification pending".

## 0.4.2 — User IDs

- Every account gets a random, unique 11-digit ID at sign-up (existing accounts backfilled). Shown on Me and profiles; searchable in Party.

## 0.4.1 — Launch flow

- Zynalive logo (red tile, white Z, gold live dot) for the app icon, Android adaptive icon, favicon and native splash.
- Startup: native logo splash → animated loading page (while fonts and the Clerk session load) → animated welcome screen
  with Create account / Sign in / Google → sign-up or sign-in. Animations respect Reduce Motion.

## 0.4.0 — Canvas restyle

- New visual identity from the Zynalive design canvas: red live accent, gold coins, violet earnings;
  Bricolage Grotesque display + DM Sans body (bundled via `@expo-google-fonts`).
- Tabs are now Home · Party · Go live (raised centre button) · Messages · Me.
- Home: Following / Popular / Nearby / New feeds and category chips. Party: search rooms, people and Host IDs.
  Rankings moved to its own screen with a podium.
- Restyled sign-in, go-live camera setup, live room controls, gift sheet and banners, wallet (select a package, then buy) and Me.

## 0.3.0 — Host verification

- Didit identity verification for hosts (ID + liveness + face match); required to go live and to withdraw (configurable).
- `didit-session` / `didit-webhook` edge functions; tests for the database rules and webhook signatures.

## 0.2.0 — Zynalive foundation

- Replaced the Streamly VOD prototype with the Zynalive live-streaming app
  (Home · Discover · Create · Messages · Profile) on Expo SDK 57.
- Postgres schema for identity/RBAC, agencies, hosts, rooms, social, economy,
  moderation and AI, with RLS, column grants and security-definer RPCs.
- Must-pass tests: self-promotion, agency isolation, fabricated payments,
  duplicate webhooks, duplicate/concurrent gifts, refunds/chargebacks, withdrawals, AI boundary.
- Edge functions: livekit-token, livekit-webhook, coins-checkout, stripe-webhook, clerk-webhook.
- LangGraph background agents: AI CEO (Finance/Economy/Streaming in parallel),
  moderation, fraud, support, creator assist, translation, recommendations.

## 0.1.0

- Streamly: VOD streaming prototype on the $20/mo stack.
