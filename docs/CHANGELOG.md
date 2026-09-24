# Changelog

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
