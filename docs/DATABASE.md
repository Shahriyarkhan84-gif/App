# Database

Migrations: `supabase/migrations/` (apply with `npx supabase db push`).
Tests: `supabase/tests/run.sh` (throwaway Postgres; needs `initdb`/`pg_ctl`/`psql`, non-root).

| Migration | Contents |
|---|---|
| `…010000_core.sql` | roles, profiles, agencies, agency_members, hosts (`HOST-00000001` ids), rooms, streams, room_admins (max 5), room_bans, viewers, follows, user_blocks, messages, direct_messages, word_filters, notifications, audit_logs, platform_settings |
| `…020000_economy.sql` | wallets, coin_transactions (ledger), gift_catalog, gifts, creator_earnings, earning_entries, platform_ledger, coin_packages, payments, processed_webhook_events, refund_requests, withdrawals + money RPCs + seed catalog/packages |
| `…030000_moderation_ai.sql` | reports, moderation_actions, ai_jobs, ai_reports, ai_actions, message_translations, support_tickets, user_recommendations + social/room/moderation/agency RPCs, rankings |
| `…040000_access.sql` | grants, RLS policies, Realtime publication |
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
