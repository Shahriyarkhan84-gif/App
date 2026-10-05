# API

## Edge functions (`supabase/functions/`)

All return `{ error: { code, message } }` on failure. User-facing functions require
`Authorization: Bearer <Clerk session JWT>`.

| Function | Body | Returns | Notes |
|---|---|---|---|
| `livekit-token` | `{ roomId, as: 'viewer' \| 'host' }` | `{ token, url }` | 2h token; hosts publish camera+mic in their own live room only; viewers subscribe-only; bans enforced. 30/min. |
| `coins-checkout` | `{ packageId, returnTo? }` | `{ url }` | Stripe Checkout; price from `coin_packages`. 5/min. |
| `stripe-webhook` | Stripe event | — | Signature-verified; credits coins, refunds, disputes. |
| `livekit-webhook` | LiveKit event | — | Viewer counts, viewer records, stream end; with `media.record_live` on, starts participant egress when the host joins and files `egress_ended` recordings into the media pipeline. |
| `clerk-webhook` | Svix event | — | Profile sync + welcome email. Never sets roles. |
| `delete-account` | `{}` | `{ deleted }` | Deletes the signed-in account: `internal_delete_account()` then the Clerk user. `withdrawal_pending` (409) if a payout is in progress. 3/hour. |
| `host-application` | multipart: `full_name`, `phone`, `cnic`, `agency_code`, files `cnic_front`, `cnic_back`, `selfie` | `{ id, status, reasons }` | Didit ID verification + face match; photos not stored. 5/day. |
| `didit-session` | `{ returnTo?, language? }` | `{ url }` | Hosts only; starts Didit ID + selfie verification. 5/hour. |
| `didit-webhook` | Didit event | — | Signature-verified; re-reads the decision from Didit, then updates `hosts.verification_status`. |

## Postgres RPCs (call with `supabase.rpc(name, args)`)

| Area | RPCs |
|---|---|
| Profile | `ensure_profile(p_display_name?, p_region?)`, `become_host`; owner only: `set_profile_verified(p_user, p_verified)` (verified badge; removing it also unpins), `set_profile_pinned(p_user, p_pinned, p_position?)` (verified accounts only, max 20 → `not_verified` / `pin_limit`) |
| Live | `set_room_cover(p_path)` (file in `covers/<user id>/`), `go_live(p_title, p_category)` (needs a cover → else `cover_required`), `end_live()` |
| Media | `create_media_upload(p_title, p_extension, p_description?, p_visibility?)` → asset with fixed `source_path` (upload the file to `uploads/<source_path>`), `submit_media_upload(p_asset_id)`, `update_media(p_asset_id, p_title, p_description, p_visibility)`, `remove_media(p_asset_id, p_reason?)` (owner, or admin takedown), `get_media(p_asset_id)` (also unlisted), `record_media_view(p_asset_id)`. Playback: `<media.media_base>/<playback_path>` (HLS master, VIDEO-RANGE tagged, subtitle tracks). |
| Regions & events | `my_region()`, `event_leaderboard(p_event_id, p_role: host/gifter, p_limit?)`; admins: `upsert_event(p_id?, p_title, p_description, p_kind: gifting/pk_battle, p_region?, p_starts_at, p_ends_at, p_gift_ids?, p_rewards, p_publish)`, `cancel_event(p_id)`, `finalize_event(p_id)` |
| PK battles | `invite_pk_battle(p_target_room_id)`, `respond_pk_battle(p_battle_id, p_accept)` (challenged host: accept/decline; challenger: cancel with `p_accept=false`), `end_pk_battle(p_battle_id)` (either host any time, anyone once the clock runs out) |
| Room moderation | `room_moderate(p_room, p_target, p_action, p_minutes)` (`mute/kick/block/unmute/unblock`), `set_room_admin(p_user, p_enabled)` |
| Chat & social | `send_chat_message(p_room, p_body)`, `send_direct_message(p_recipient, p_body)`, `request_translation(p_message_id, p_language)`, `report_content(p_target_type, p_target_id, p_reason)`, `create_support_ticket(p_subject, p_body)` |
| Economy | `send_gift(p_room_id, p_gift_id, p_quantity, p_idempotency_key)`, `request_refund(p_payment_id, p_reason)`, `request_withdrawal(p_coins, p_payout_method)` |
| Discovery | `get_rankings(p_kind: live/creator/gifter/country, p_period: day/week/month)`, `host_contributions(p_host, p_period: day/week/month/overall)` → `rank, user_id, display_name, username, avatar_url, user_number, coins, since` |
| Agency portal | `agency_portal(p_agency?)` → `{ agency{id,name,code,status}, role, stats{hosts,verified,live_now,in_review,earnings_lifetime}, hosts[], applications[] }` (money and applicant phones only for admins/managers) (codes are permanent; there is no rotation RPC) |
| Owner/admin | `create_agency_by_user_number(p_name, p_user_number)`, `review_withdrawal`, `mark_withdrawal_paid`, `review_refund`, `apply_moderation_action`, `dismiss_report`, `review_ai_action`, `request_ceo_briefing`, `set_platform_setting`, `set_user_role` (super admin), `create_agency`, `add_agency_member`, `assign_host_to_agency` |
| Service role only | `internal_media_started`, `internal_media_probed`, `internal_media_ready`, `internal_media_failed`, `internal_media_subtitles`, `internal_register_live_recording`, `internal_finalize_due_events`, `internal_create_payment`, `internal_attach_payment_ref`, `internal_credit_payment`, `internal_refund_payment`, `internal_dispute_payment`, `internal_viewer_event`, `internal_start_host_verification`, `internal_apply_host_verification`, `internal_end_stream_by_livekit_room`, `internal_hide_message`, `internal_ai_moderation`, `internal_execute_ai_action` |

## NestJS API (`apps/api`) — same rules, REST

| Area | Endpoints |
|---|---|
| Regions | `GET /regions`, `GET /regions/me` (JWT) |
| Payments | `GET /payments/packages/mine` (the buyer's region); `POST /payments/checkout` refuses another region's package (`invalid_package`) |
| Media | `GET /media`, `GET /media/mine`, `POST /media/uploads` → `{ asset, uploadUrl, contentType }` (presigned S3 PUT to the fixed key), `POST /media/:id/submit`, `GET /media/:id`, `PUT /media/:id`, `POST /media/:id/remove`, `POST /media/:id/view` |
| Events | `GET /events`, `GET /events/:id/leaderboard?role=host\|gifter&limit=`; admins: `POST /events`, `PUT /events/:id`, `POST /events/:id/cancel`, `POST /events/:id/finalize` |
| Worker (`x-internal-secret`) | `POST /internal/media/:id/{started,probed,ready,failed,subtitles}`, `POST /internal/media/recordings` (IVS Recording End → replay), `POST /internal/events/finalize-due` |

Sign-up (`/auth/register`, `/auth/otp/verify`, `/auth/google`, `/auth/apple`) records `signupCountry` once from `cloudfront-viewer-country` / `cf-ipcountry`, else the optional `region` field.
