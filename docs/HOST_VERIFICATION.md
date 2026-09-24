# Host identity verification (Didit)

Approval marks the user verified (`profiles.verified_at`), which shows the Host badge.

Hosts verify their identity (ID document scan + liveness selfie + face match)
with [Didit](https://didit.me) before they can **go live** or **withdraw
earnings**. Both gates are settings (`platform_settings.host_verification`:
`required_to_go_live`, `required_to_withdraw`, default `true`).

## In-app application (primary)

```
Hosting → "Continue verification" → /verify-form
   full name, phone (+92), CNIC number, CNIC front + back photos, face photo holding the CNIC, agency code (required), consent
   → host-application (edge fn, multipart; photos resized to ≤1600px JPEG in the app)
      → checks: format, agency code exists, not already verified, 5/day per user
      → POST verification.didit.me/v3/id-verification/  (front_image, back_image)  → OCR + authenticity
      → POST verification.didit.me/v3/face-match/       (user_image = face-with-CNIC, ref_image = CNIC portrait)
      → compares typed CNIC with the card's number and typed name with the card's name
      → internal_submit_host_application()  → approved | in_review | declined (+ Host badge, agency link, notification)
Owner command center → Host applications → approve / decline the in_review ones (review_host_application)
```

Decision rules (since `…150000_auto_approve_hosts.sql`):
- Under 18, ID declined or face declined → **declined**.
- Didit ID **Approved** + face match **Approved** + age 18+ → **approved automatically**, instantly:
  Host badge, host role, agency link and notification, no person involved.
- Didit hasn't decided ("In Review" / no result) or the age couldn't be read → **in_review** for a person.
- A typed CNIC number or name that differs from the card never blocks approval (Didit has verified the
  card and matched the face to it); it is kept as a note in `reasons` for the owner. Photos go only to Didit (visible to staff in
Didit's console under Manual Checks); Zynalive stores the name, phone, agency code,
the last 4 CNIC digits and the result (`host_applications`). Needs `DIDIT_API_KEY`.

### Agency code requirements

- **Required.** Every host application must include an agency code; an empty code
  is refused in the app, in `host-application` (`agency_code_required`) and in
  `internal_submit_host_application()`.
- **Must belong to an active agency.** The code is trimmed and upper-cased, then
  matched against `agencies.code` with `status = 'active'`; anything else is
  `invalid_agency_code`. This is checked **before** the photos are sent to Didit,
  so a wrong code costs no Didit check.
- **Format:** exactly 4 digits, 1000–9999 (e.g. `4821`), random and unique per agency. Checked in the app,
  in `host-application` and by a table constraint. Agencies find and share their code in the **Agency portal**
  (Profile → Agency portal). The code is issued once when the agency is created and never changes.
- **On approval** the host is linked to that agency, unless already linked to one.
- Hosting → "What you need" tells users to get the code from their agency first.

## Hosted-page flow (fallback)

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
