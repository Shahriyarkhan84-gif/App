# Database

Migrations: `supabase/migrations/` (apply with `npx supabase db push`).
Tests: `supabase/tests/run.sh` (throwaway Postgres; needs `initdb`/`pg_ctl`/`psql`, non-root).

| Migration | Contents |
|---|---|
| `…010000_core.sql` | roles, profiles, agencies, agency_members, hosts (Host ID = user's 8-digit ID since `…110000`), rooms, streams, room_admins (max 5), room_bans, viewers, follows, user_blocks, messages, direct_messages, word_filters, notifications, audit_logs, platform_settings |
| `…020000_economy.sql` | wallets, coin_transactions (ledger), gift_catalog, gifts, creator_earnings, earning_entries, platform_ledger, coin_packages, payments, processed_webhook_events, refund_requests, withdrawals + money RPCs + seed catalog/packages |
| `…030000_moderation_ai.sql` | reports, moderation_actions, ai_jobs, ai_reports, ai_actions, message_translations, support_tickets, user_recommendations + social/room/moderation/agency RPCs, rankings |
| `…040000_access.sql` | grants, RLS policies, Realtime publication |
| `…060000_host_verification.sql` | `hosts.verification_status`, `host_verifications`, Didit RPCs; go-live and withdrawals require verification ([HOST_VERIFICATION.md](HOST_VERIFICATION.md)) |
| `…070000_user_number.sql` | `profiles.user_number`: random unique public ID, set by trigger on insert and frozen on update (8 digits since `…100000_user_number_8_digits.sql`) |
| `…080000_verified_badge.sql` | `profiles.verified_at`: set by trigger when host verification is approved (Host badge), cleared if declined |
| `…090000_account_deletion.sql` | `profiles.deleted_at`, `internal_delete_account()` (service role): removes personal data and social graph, anonymises the profile, keeps money/moderation records |
| `…110000_host_id_equals_user_id.sql` | `hosts.host_code` = `profiles.user_number` (set by trigger, frozen); sequence dropped |
| `…190000_signup_country.sql` | `profiles.signup_country` set once at sign-up (edge header, else device region), frozen, cleared on deletion; `ensure_profile(p_display_name, p_region)` |
| `…180000_host_contributions.sql` | `host_contributions()` — per-host gifter ranking; Overall starts when the host joined hosting |
| `…170000_unique_ids.sql` | user IDs issued under an advisory lock (no duplicate from simultaneous sign-ups); one host row per user. IDs are unique, frozen, never reused |
| `…160000_live_cover.sql` | `covers` storage bucket + per-user folder policies, `set_room_cover()`, `go_live()` requires a cover, `platform_settings.media.covers_base` |
| `…140000_permanent_agency_code.sql` | agency codes frozen after insert (`agency_code_permanent`), `regenerate_agency_code()` dropped, unique `agencies.manager_id` (one agency per owner) |
| `…130000_agency_portal.sql` | `agencies.code` is a random unique **4-digit** code (1000–9999, `private.new_agency_code()`, old `AG-` codes reissued); `agency_portal()`, `regenerate_agency_code()`, `create_agency_by_user_number()` |
| `…120000_host_applications.sql` | `host_applications` (no images, CNIC last 4 only), `internal_submit_host_application()`, `review_host_application()`, `private.ensure_host()` |
| `…050000_hardening.sql` | fixed `search_path` on remaining functions; no anon execute by default (Supabase advisor fixes) |

Architecture table names map 1:1 except: `users` → Clerk + `profiles`;
`battles` is not built yet (see REMAINING_WORK.md); `rankings` is computed by
`get_rankings()` instead of stored.

## Conventions

- Identity: `public.requesting_user_id()` = Clerk `sub`.
- Clients read via RLS and write only where a policy allows (follows, blocks,
  own profile fields, read receipts). Everything else goes through
  `security definer` RPCs with `set search_path = ''`.
- `internal_*` functions: service role only. `private.*` helpers: not exposed.
- Errors: RPCs `raise exception '<code>'` (e.g. `insufficient_coins`); the app
  maps codes to copy in `src/lib/errors.ts`.
- Every privileged action writes `audit_logs` (`actor_kind` user/ai/system).
