# Database

Migrations: `supabase/migrations/` (apply with `npx supabase db push`).
Tests: `supabase/tests/run.sh` (throwaway Postgres; needs `initdb`/`pg_ctl`/`psql`, non-root).

| Migration | Contents |
|---|---|
| `…23000000_drop_mvp_placeholder.sql` | Removes the MVP script's placeholder tables (`users`, `rooms`, `chat_messages`, RLS off) and enums from the live project before the real schema; no-op on fresh databases |
| `…010000_core.sql` | roles, profiles, agencies, agency_members, hosts (Host ID = user's 8-digit ID since `…110000`), rooms, streams, room_admins (max 5), room_bans, viewers, follows, user_blocks, messages, direct_messages, word_filters, notifications, audit_logs, platform_settings |
| `…020000_economy.sql` | wallets, coin_transactions (ledger), gift_catalog, gifts, creator_earnings, earning_entries, platform_ledger, coin_packages, payments, processed_webhook_events, refund_requests, withdrawals + money RPCs + seed catalog/packages |
| `…030000_moderation_ai.sql` | reports, moderation_actions, ai_jobs, ai_reports, ai_actions, message_translations, support_tickets, user_recommendations + social/room/moderation/agency RPCs, rankings |
| `…040000_access.sql` | grants, RLS policies, Realtime publication |
| `…060000_host_verification.sql` | `hosts.verification_status`, `host_verifications`, Didit RPCs; go-live and withdrawals require verification ([HOST_VERIFICATION.md](HOST_VERIFICATION.md)) |
| `…070000_user_number.sql` | `profiles.user_number`: random unique public ID, set by trigger on insert and frozen on update (8 digits since `…100000_user_number_8_digits.sql`) |
| `…080000_verified_badge.sql` | `profiles.verified_at`: set by trigger when host verification is approved (Host badge); the owner's blue tick is the separate `owner_verified_at`, cleared if declined |
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
| `…200000_pk_battles.sql` | `pk_battles` (two rooms, live score, winner), `rooms.current_battle_id`; `invite_pk_battle()`, `respond_pk_battle()`, `end_pk_battle()`; a trigger on `gifts` tallies `score_a`/`score_b` from gifts already sent through `send_gift()` — no changes to the money path itself. Each host still publishes only to their own existing LiveKit room; viewers subscribe to both rooms while a battle is live. |

| `…25010000_media_pipeline.sql` | Upload + HDR pipeline: `media_assets` (probe + HDR metadata, `dynamic_range` sdr/hdr10/hlg, playback/thumbnail paths), `media_renditions` (ladder), `media_views`; private `uploads` bucket (hosts insert only their reserved `<id>/<asset>.<ext>` path) + public `media` bucket; `create_media_upload`, `submit_media_upload`, `update_media`, `remove_media`, `get_media`, `record_media_view`; service role: `internal_media_started/probed/ready/failed`, `internal_register_live_recording`. Every ladder must include an SDR rung. |
| `…25020000_media_subtitles.sql` | `media_subtitles` (per-language WebVTT + HLS playlist, one source track), `media_assets.subtitle_status`; `internal_media_ready` queues `media_subtitles`; `internal_media_subtitles()` |
| `…25030000_regions_events.sql` | `regions` (PK/IN/BD/GLOBAL active; ID/MY/TR/GULF/PH/NP ready), region from `signup_country`, `my_region()`; `coin_packages.region` (+ INR/BDT/USD packages) and `internal_create_payment` refuses other regions' packages; `gift_catalog.regions`; `events`, `event_scores` (kept by triggers on `gifts` and ended `pk_battles`), `event_results`; `upsert_event`, `cancel_event`, `finalize_event`, `event_leaderboard`, `internal_finalize_due_events` |

| `…25040000_revoke_anon_review_host_application.sql` | Security advisor fix: signed-out callers can't execute `review_host_application()` |
| `…20261005010000_round3_fixes.sql` | gift `clawed_coins`/`idempotency_key` private (column grants), mutes unseat party guests, 20 s seat grace on reconnect, `ensure_profile` sets `country`, `request_translation` limits |
| `…20261005020000_pinned_profiles.sql` | `pinned_profiles` (verified IDs pinned on Home; public read, no client writes) + owner RPCs `set_profile_verified`, `set_profile_pinned` |
| `…20261005040000_round5_fixes.sql` | Realtime for `room_bans`/`streams`; ban clears blue tick + pin; `block_user`/`unblock_user` (blocks remove follows, block DMs and follows both ways); `my_withdrawable_coins()`; approved withdrawals can be rejected; disputes `closed` unfreeze wallets; PK invite/accept lock both rooms; seats freed on account deletion; host auto-approval only with `host_verification.auto_approve` |
| `…20261005030000_owner_verified.sql` | `profiles.owner_verified_at` (owner's blue tick, required for Home pins; cleared with its pin on account deletion), visible-only pin limit, empty display-name backfill, `muted_in_room` from `request_seat`/`approve_seat` |
| `20261004010000_avatars.sql` | Public `avatars` storage bucket; signed-in users write only `avatars/<their id>/` (Edit profile → Change photo) |
| `20261004020000_party_rooms.sql` | `rooms.mode` (`live`/`voice`/`video`), `room_seats` (voice 8 / video 6 guest seats), `seat_requests`; RPCs `set_room_mode`, `request_seat`, `approve_seat` (host or live room admin), `remove_from_seat`, `leave_seat`, `set_seat_muted`; seats/requests cleared when the room goes offline; no client write grants. Tests: `supabase/tests/97_party_rooms.sql` |

(Files `20260925…` sort after `20260924…`; the short names above drop the date prefix.)

Architecture table names map 1:1 except: `users` → Clerk + `profiles`;
`rankings` is computed by `get_rankings()` instead of stored.

## Conventions

- Identity: `public.requesting_user_id()` = Clerk `sub`.
- Clients read via RLS and write only where a policy allows (follows, blocks,
  own profile fields, read receipts). Everything else goes through
  `security definer` RPCs with `set search_path = ''`.
- `internal_*` functions: service role only. `private.*` helpers: not exposed.
- Errors: RPCs `raise exception '<code>'` (e.g. `insufficient_coins`); the app
  maps codes to copy in `src/lib/errors.ts`.
- Every privileged action writes `audit_logs` (`actor_kind` user/ai/system).
