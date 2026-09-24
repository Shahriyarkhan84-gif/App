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

## Financial trust boundary

- Clients have no INSERT/UPDATE on `wallets`, `coin_transactions`, `payments`,
  `gifts`, `creator_earnings`, `withdrawals`, `platform_ledger`.
- `internal_*` functions are executable only by `service_role` (edge functions,
  worker). Coins are credited only from a signature-verified Stripe event.
- Replay: `processed_webhook_events` + idempotent RPCs (status checks under row
  locks, unique ledger idempotency keys).
- Prices come from `coin_packages` / `gift_catalog`; amount + currency are
  re-checked against the Stripe session before crediting.

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
