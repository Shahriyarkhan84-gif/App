# Changelog

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
