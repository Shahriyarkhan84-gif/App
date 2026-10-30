# Security & authorization

## Roles (RBAC)

- Only Clerk sessions are signed-in users: `requesting_user_id()` ignores tokens issued by Supabase
  Auth itself (`…/auth/v1`). Keep Supabase Auth sign-ups and anonymous sign-ins **off** in the dashboard.
- Platform admin rights need an active, not deleted account; only a super admin can action a super admin.

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

- Agency admins/managers see earnings and moderation for **their own hosts only**; agents see
  their agency but **no financials**. They don't see who reported their hosts or their hosts'
  payout account numbers (reports and withdrawals are own-or-owner only).
- Agency staff can recruit only **unassigned** hosts, only into their agency.
- The Agency portal reads everything through `agency_portal()` (security definer): only the caller's own agency;
  earnings totals and applicant phone numbers only for admins/managers; never CNIC digits, photos or Didit data.
- Agency codes are 4 random digits, issued once per agency and **permanent** (a trigger blocks any change,
  even by the owner platform). They are not secret credentials — a code only links a host who
  **passes Didit verification** to that agency. Each owner has exactly one agency. Wrong codes are rejected before any photo is sent to Didit, and
  `host-application` is rate-limited (5/day per user), which limits code guessing. Rate limits use Upstash when it is configured and otherwise a Postgres counter (`internal_rate_limit`), so they never silently switch off.
- Host ID check: Didit checks the document, matches the face on the "holding CNIC" photo against the card, and runs passive liveness on that photo (a gallery, printed or on-screen photo fails it). Auto-approval needs all three Approved; anything else waits for a person.

## Financial trust boundary

- Clients have no INSERT/UPDATE on `wallets`, `coin_transactions`, `payments`,
  `gifts`, `creator_earnings`, `withdrawals`, `platform_ledger`.
- `internal_*` functions are executable only by `service_role` (edge functions,
  worker). Coins are credited only by `internal_credit_payment()` with data Stripe itself returned: the signature-verified webhook, or `payments-reconcile` retrieving the session from Stripe.
- Replay: `processed_webhook_events` + idempotent RPCs (status checks under row
  locks, unique ledger idempotency keys).
- Prices come from `coin_packages` / `gift_catalog`; amount + currency are
  re-checked against the Stripe session before crediting.
- Automatic payouts: the database alone decides which withdrawal is paid without review
  (`private.auto_payout_block`: under the per-payout and daily limits, an account that was already
  paid once, no `account_review` in 30 days, wallet not frozen). `payouts-send` takes only what
  `internal_claim_payouts` hands it (database secret, or the signed-in host's own) and records the
  provider's answer with `internal_payout_result`; the provider is always called with the withdrawal
  id as its idempotency key. A payout the provider was asked about can only be retried, never paid
  by hand or rejected (no double payment). Provider keys are Edge Function secrets.

## Media uploads

- Only hosts who passed the ID check can publish videos (`host_verification.required_to_upload`, on by default).
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

## Age check (18+)

- Birth dates live in `private.birthdates` (no client access) and are set once through `set_birth_date()`; the client never decides adult or minor.
- Minors are `restricted` in `user_status()`, so every action RPC that checks status refuses them, and `internal_create_payment` refuses them (`under_18`). The `/onboarding` screen only explains this.
- Accounts created before the check are `unknown` until they answer; the app sends them to `/onboarding` on next open.

## Account deletion

`internal_delete_account()` is service-role only (called by `delete-account` after verifying the Clerk JWT, and by `clerk-webhook` on `user.deleted`). It is idempotent, refuses while a withdrawal is pending, deletes follows/blocks/DMs/notifications, blanks chat and support text, and anonymises the profile. Payments, ledger, gifts, earnings, withdrawals, reports and audit logs are retained.

## Secrets

- `LIVEKIT_API_SECRET`, `STRIPE_SECRET_KEY`, webhook secrets, Upstash, Resend, Pinecone
  and `ANTHROPIC_API_KEY` live only in Supabase function secrets / the worker
  environment. The app bundles only `EXPO_PUBLIC_*` values (see ENVIRONMENT.md).
- `.env` files are git-ignored; `.env.example` files document names only.
- **Rotate the LiveKit key pair that was shared in chat earlier** (architecture note).

## AI safety

- User content (chat, reports, room titles) is fenced in `<untrusted>` tags (any fence-like tag
  inside it is removed, in any case) and system prompts instruct the model to treat it as data
  (prompt-injection defence).
- An automatic AI warning needs reports from at least 2 different people in 7 days and uses a fixed
  text; the model's words (partly written from the reporter's) are shown only to the owner.
- Paid AI calls are capped: 5 support tickets a day per person, and the worker starts at most
  `AI_DAILY_JOB_LIMIT` AI jobs a day (the rest wait in the queue).
- ffmpeg/ffprobe (parsing untrusted uploads) run with only `PATH` in their environment (no
  service-role key or database URL) and may read local files only (`-protocol_whitelist file`).
- AI may only hide content and issue warnings automatically
  (`internal_ai_moderation` rejects anything else). Restrictions, bans and
  wallet freezes are `ai_actions` proposals executed only after owner approval.
- Staff accounts can't be actioned by AI.

## Supabase security advisor

Expected findings, all by design: *signed-in users can execute SECURITY
DEFINER functions* (every public RPC checks the caller and role inside; that
is the write path — covered by `10_must_pass.sql`), *RLS enabled, no policy* on `media_views` / `processed_webhook_events` (no
client access at all). `10_must_pass.sql` asserts that anon can execute no
other public function. Anything else the advisor reports is a bug.

## Review checklist (per change)

AuthN/AuthZ · input validation (CHECK constraints + RPC validation) · SQLi
(parameterised RPCs, no dynamic SQL from input) · XSS (emails escape HTML) ·
CSRF (bearer tokens, no cookies) · rate limiting (Postgres counters for chat/DM/
reports; Upstash for token/checkout) · IDOR (RLS on every table) · privilege
escalation · session handling (Clerk) · webhook verification (Stripe, Clerk/Svix,
LiveKit) · data exposure (column grants hide email) · logging hygiene (no
secrets or stack traces to clients; `{ error: { code, message } }` shape).
