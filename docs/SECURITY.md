# Security & authorization

## Roles (RBAC)

`USER · HOST · AGENCY_MEMBER · AGENCY_ADMIN · OWNER_ADMIN · SUPER_ADMIN`
(`profiles.role`). Enforced server-side only:

- `profiles.role` / `status` have **no client UPDATE grant** (column-level
  grants allow only `username, display_name, avatar_url, bio, country, language`).
- Only `SUPER_ADMIN` can call `set_user_role`, and never on themselves.
- `profiles.user_number` (public 8-digit ID) is assigned by a trigger on insert and can't be changed by anyone, service role included.
- `become_host`, `create_agency`, `add_agency_member` set roles as side effects
  of authorized actions, never from client input.

## Agency isolation

`admin_agency_ids()` / `member_agency_ids()` scope every agency query:

- Agency admins/managers see earnings, withdrawals, reports and moderation for
  **their own hosts only**; agents see their agency but **no financials**.
- Agency staff can recruit only **unassigned** hosts, only into their agency.
- The Agency portal reads everything through `agency_portal()` (security definer): only the caller's own agency;
  earnings totals and applicant phone numbers only for admins/managers; never CNIC digits, photos or Didit data.
- Agency codes are 4 random digits, issued once per agency and **permanent** (a trigger blocks any change,
  even by the owner platform). They are not secret credentials — a code only links a host who
  **passes Didit verification** to that agency. Each owner has exactly one agency. Wrong codes are rejected before any photo is sent to Didit, and
  `host-application` is rate-limited (5/day per user), which limits code guessing.

## Financial trust boundary

- Clients have no INSERT/UPDATE on `wallets`, `coin_transactions`, `payments`,
  `gifts`, `creator_earnings`, `withdrawals`, `platform_ledger`.
- `internal_*` functions are executable only by `service_role` (edge functions,
  worker). Coins are credited only from a signature-verified Stripe event.
- Replay: `processed_webhook_events` + idempotent RPCs (status checks under row
  locks, unique ledger idempotency keys).
- Prices come from `coin_packages` / `gift_catalog`; amount + currency are
  re-checked against the Stripe session before crediting.

## Media uploads

- Hosts reserve an upload with `create_media_upload()`, which fixes the object
  name (`<own id>/<asset id>.<ext>`); the `uploads` bucket policy only allows
  inserting that exact reserved path while it's `awaiting_upload`. The bucket
  is private (only the service-role media worker reads sources).
- Processing state, probe results, renditions and subtitles are written only by
  the service role (`internal_media_*`); every ladder must contain an SDR rung,
  and all output paths must stay inside the asset's folder.
- Outputs are in the public `media` bucket under unguessable asset UUIDs (like
  covers); "unlisted" means not listed, not access-controlled. Removed videos
  stop resolving in the app; purge storage objects with a lifecycle rule.
- Live recordings are registered only by the signature-verified LiveKit
  webhook and only into the room host's own folder. The NestJS API accepts IVS
  recordings only from the room's own channel prefix.
- Transcripts are user speech and are passed to Claude as `<untrusted>` data.

## Regions & events

- The pricing region comes from the frozen `signup_country`; clients can't write
  it, and editing `country` has no effect on price (must-pass §4b).
- Events are created, edited, cancelled and finalized only by platform admins
  (audited). Scores come only from triggers on real gifts and ended battles;
  clients have no write grants on `event_scores`/`event_results`, and a retried
  gift (same idempotency key) never scores twice.

## Host identity verification

Verification status is written only by the service role from a signature-verified
Didit webhook, after re-reading the decision from Didit's API. Clients can't write
`hosts` or `host_verifications`. Only a non-PII summary is stored. See HOST_VERIFICATION.md.

## Host applications

CNIC photos and the full CNIC number are sent to Didit and never stored by Zynalive. Decisions are written only by `internal_submit_host_application()` (service role, after Didit's responses) or `review_host_application()` (platform admins). Clients can read only their own applications and have no write grants.

## Account deletion

`internal_delete_account()` is service-role only (called by `delete-account` after verifying the Clerk JWT, and by `clerk-webhook` on `user.deleted`). It is idempotent, refuses while a withdrawal is pending, deletes follows/blocks/DMs/notifications, blanks chat and support text, and anonymises the profile. Payments, ledger, gifts, earnings, withdrawals, reports and audit logs are retained.

## Secrets

- `LIVEKIT_API_SECRET`, `STRIPE_SECRET_KEY`, webhook secrets, Upstash, Resend
  and `ANTHROPIC_API_KEY` live only in Supabase function secrets / the worker
  environment. The app bundles only `EXPO_PUBLIC_*` values (see ENVIRONMENT.md).
- `.env` files are git-ignored; `.env.example` files document names only.
- **Rotate the LiveKit key pair that was shared in chat earlier** (architecture note).

## AI safety

- User content is fenced in `<untrusted>` tags and system prompts instruct the
  model to treat it as data (prompt-injection defence).
- AI may only hide content and issue warnings automatically
  (`internal_ai_moderation` rejects anything else). Restrictions, bans and
  wallet freezes are `ai_actions` proposals executed only after owner approval.
- Staff accounts can't be actioned by AI.

## Review checklist (per change)

AuthN/AuthZ · input validation (CHECK constraints + RPC validation) · SQLi
(parameterised RPCs, no dynamic SQL from input) · XSS (emails escape HTML) ·
CSRF (bearer tokens, no cookies) · rate limiting (Postgres counters for chat/DM/
reports; Upstash for token/checkout) · IDOR (RLS on every table) · privilege
escalation · session handling (Clerk) · webhook verification (Stripe, Clerk/Svix,
LiveKit) · data exposure (column grants hide email) · logging hygiene (no
secrets or stack traces to clients; `{ error: { code, message } }` shape).
