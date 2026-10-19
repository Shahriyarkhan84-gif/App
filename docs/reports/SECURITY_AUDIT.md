# Zynalive backend security audit

**Date:** 2026-10-19 · **By:** security-engineer agent (read-only audit of commit `85aaf83`), fixes in 0.9.65 · **Scope:** all migrations, all Edge Functions, the `agents/` worker, app-side money/role/secret paths, `public/pay`, `eas.json`, git history for secrets. Not reviewed: `apps/api`, `apps/web`.

## Result

No Critical or High findings. The money engine (gifts, payments, refunds, disputes, withdrawals, clawbacks) locks the right rows with idempotency keys; every `security definer` function sets `search_path`; every `internal_*` function is service-role only; every table has RLS; Stripe, LiveKit, Clerk and Didit webhooks are signature-checked and replay-protected; committed files hold only publishable keys.

## Findings and status

| # | Finding | Status (0.9.65) |
|---|---|---|
| M1 | Kicked/blocked/unseated people and banned hosts kept LiveKit access with a still-valid 2-hour token | Fixed: `livekit-webhook` checks every join against the database; a room that isn't live is closed in LiveKit; the command center closes a banned host's live |
| M2 | Any account could publish public videos without the ID check | Fixed: `create_media_upload` needs `verification_status = 'approved'` |
| M3 | zynalive.com/pay trusted a Stripe key from its URL (phishing with someone else's session) | Fixed: the page gets the key from `pay-session`, only for Zynalive's own pending sessions |
| M4 | Supabase Auth tokens (direct sign-up with the public key) counted as users | Fixed in SQL (`requesting_user_id()` ignores them). **Owner:** turn off Supabase Auth sign-ups and anonymous sign-ins |
| M5 | One CNIC could verify many host accounts | Fixed: keyed CNIC hash; reuse goes to review. **Owner:** set `CNIC_HASH_KEY` |
| M6 | Unlimited paid AI calls (support tickets, chat) | Fixed: 5 tickets/day; worker `AI_DAILY_JOB_LIMIT` (default 5000). Owner may set cheaper `AI_MODEL_<BRANCH>` models |
| L1 | Reports could steer automatic AI warnings | Fixed: 2+ distinct reporters, fixed warning text, case-insensitive fence, room titles fenced |
| L2 | Banned/deleted owners kept admin rights; owners could ban the super admin | Fixed |
| L3 | Agency managers saw reporters and payout accounts | Fixed: own-or-owner only |
| L4 | Hidden chat readable through translations | Fixed |
| L5 | Hosts' AI coaching readable by everyone | Fixed: `stream_coaching`, host-only |
| L6 | Client could choose pricing region over Tor | Fixed for Tor (`T1`); a missing country header still uses the device region (product choice) |
| L7 | zynalive.com could open any Expo Go project | Fixed: `exp://` only in development |
| L8 | ffmpeg parsed uploads with the service-role key in its environment | Fixed: scrubbed environment, local files only. Still advised: least-privilege DB role for the media worker |
| L9 | `config.toml` missing `verify_jwt = false` for 5 functions | Fixed |
| L10 | Minor: public config-status, fail-open limits, no anti-framing headers, no blanket `internal_*` test, avatar quota | Fixed except avatar quota (open) |
