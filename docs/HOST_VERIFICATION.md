# Host identity verification (Didit (approval also marks the user verified — `profiles.verified_at` — which shows the Host badge))

Hosts verify their identity (ID document scan + liveness selfie + face match)
with [Didit](https://didit.me) before they can **go live** or **withdraw
earnings**. Both gates are settings (`platform_settings.host_verification`:
`required_to_go_live`, `required_to_withdraw`, default `true`).

## Flow

```
Create tab → "Verify identity" → didit-session (edge fn)
   → POST verification.didit.me/v3/session/ {workflow_id, vendor_data: clerk user id, callback}
   → internal_start_host_verification()  (hosts.verification_status = pending)
   → app opens Didit's hosted URL → user scans ID + selfie
   → Didit redirects to SITE_URL/verify-return?to=zynalive://… (closes the in-app browser)
Didit → didit-webhook (edge fn)
   → verify X-Signature (HMAC-SHA256 of "{X-Timestamp}:{canonical JSON}") or X-Signature-Simple, ≤ 5 min old
   → replay check (processed_webhook_events)
   → GET /v3/session/{id}/decision/  ← authoritative status, never trust the body alone
   → internal_apply_host_verification() → hosts.verification_status + notification
```

Statuses: `unverified → pending → (in_review) → approved | declined`. Expired or
abandoned sessions return the host to `unverified`. Only the host's most recent
session changes their status, so a late webhook for an old session can't undo
a newer result. Declined hosts can retry.

## Privacy

Only a non-PII summary is stored (`host_verifications.summary`: per-check
statuses, document type, issuing country). Names, dates of birth, document
numbers and images stay in Didit. Users can read only their own verification
rows; owners can read all.

## Setup

1. Create a Didit account at [business.didit.me](https://business.didit.me).
2. Create a KYC workflow with features `OCR` → `LIVENESS` (passive) → `FACE_MATCH`
   (decline threshold 50). Copy its workflow ID.
3. API & Webhooks: copy the API key; add a webhook destination
   `https://<project>.supabase.co/functions/v1/didit-webhook`, version v3,
   event `status.updated`; copy its signing secret.
4. Set Supabase secrets `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET`
   (and `SITE_URL`, already used by Stripe returns).

## Tests

- `supabase/tests/20_host_verification.sql`: clients can't set their own status,
  gating, idempotent replays, stale-session protection, RLS.
- `supabase/functions/_shared/didit_test.ts`: webhook signature verification against
  vectors produced by Didit's reference Python implementation (Unicode, escapes,
  whole-number floats), plus tamper / wrong-secret / stale-timestamp rejection.
