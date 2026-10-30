# API

## Edge functions (`supabase/functions/`)

All return `{ error: { code, message } }` on failure. User-facing functions require
`Authorization: Bearer <Clerk session JWT>`.

| Function | Body | Returns | Notes |
|---|---|---|---|
| `livekit-token` | `{ roomId, as: 'viewer' \| 'host' \| 'guest' }` | `{ token, url }` | 2h token; hosts publish in their own room only; a seated guest publishes (mic in voice parties, camera+mic in video parties and as the one guest of a solo live); viewers subscribe-only; bans enforced. 30/min. |
| `smart-search` | `{ q }` (2–100 chars, any language) or `{ similarTo: roomId }`, optional `limit` (≤50) | `{ results: [{ id, score }] }` | Live rooms by meaning from Pinecone; the app loads the rooms through RLS. `503 not_configured` without `PINECONE_API_KEY`. 30/min. |
| `iap-verify` | `{ platform: 'android' \| 'ios', productId, purchaseToken? (Play), transactionId? (Apple) }` | `{ status: 'credited', newlyCredited, coins, balance }` · 202 `{ status: 'pending' }` | Asks Google (Play Developer API) or Apple (App Store Server API) about the purchase; credits only a paid purchase tagged with this account (`obfuscatedAccountId` / `appAccountToken`, see `_shared/stores.ts`), then consumes it on Play. 20/min. 400 `invalid_purchase`, `purchase_not_paid`, `test_purchase`; 403 `purchase_not_yours`. Repeat calls return `credited` without crediting again. |
| `store-notifications` | Apple: `{ signedPayload }` (App Store Server Notifications v2). Google: Pub/Sub push `{ message: { data } }` with `?token=STORE_NOTIFY_TOKEN` | `{ ok }` | Refunds: confirms a REFUND with Apple / a voided order with Google, then `internal_refund_payment`. Other notifications are ignored. |
| `coins-checkout` | `{ packageId, returnTo? }` | `{ url }` | Checkout session; price from `coin_packages`. `url` is Zynalive's own page (zynalive.com/pay#…) when `STRIPE_PUBLISHABLE_KEY` is set, otherwise Stripe's hosted page. 5/min. A retry within 30 min returns the same Stripe page. 409 `payment_processing` (already paid, being credited), 409 `checkout_in_progress` (started elsewhere). |
| `stripe-webhook` | Stripe event | — | Signature-verified; credits coins, closes expired/failed checkouts, refunds, disputes. |
| `payments-reconcile` | `{}` | `{ credited, failed, pending }` | Signed-in buyer's open payments checked with Stripe directly and credited/closed with the same RPCs as the webhook (safety net for a late or missed webhook). Called by the Wallet. 10/min. |
| `apk-publish` | GET or POST, no input | `{ status: 'started' \| 'in_progress' \| 'up_to_date', ... }` | Copies the EAS APK named by `platform_settings.android_apk.source` (must be an `https://expo.dev/artifacts/eas/….apk` link) into the public `downloads` bucket (`android/zynalive.apk` + `android/latest.json`) for zynalive.com/download. Callers can only trigger the copy an owner chose; does nothing once done. Public. |
| `livekit-enforce` | `{ roomId, userId }` | `{ ok: true }` (always the same, so it can't reveal who is kicked or muted) | Applies a room decision to LiveKit now (`_shared/livekit_enforce.ts`): room no longer live (ended, host banned) → close the LiveKit room; active kick/block → disconnect; no seat or muted → no publishing. `livekit-webhook` applies the same check to every join, so an old token can't be reused. Only takes access away, from database state, so any signed-in caller is safe. Called after `room_moderate` / `remove_from_seat`. 30/min. |
| `pay-session` | `{ cs }` (Checkout client secret) | `{ pk }` | zynalive.com/pay asks it for the Stripe publishable key; answered only for a pending session Zynalive created, so the page can't be used with someone else's Stripe session. Public, 30/min per IP. |
| `config-status` | GET | `{ features: { <name>: { ready, missing[] } }, stripe_mode, site_url }` | Setup check: which secrets are set (names and yes/no only, never values). Public. |
| `livekit-webhook` | LiveKit event | — | Viewer counts, viewer records, stream end; with `media.record_live` on, starts participant egress when the host joins and files `egress_ended` recordings into the media pipeline. |
| `live-record` | `{ on: boolean }` | `{ recording }` | Host tools → Recorder: starts or stops a participant egress of the caller's own live into the uploads bucket (then the media pipeline, as a replay). Only the live host; needs the `STORAGE_S3_*` secrets (`not_configured` otherwise). 10/min. |
| `clerk-webhook` | Svix event | — | Profile sync + welcome email. Never sets roles. |
| `delete-account` | `{}` | `{ deleted }` | Deletes the signed-in account: `internal_delete_account()` then the Clerk user. `withdrawal_pending` (409) if a payout is in progress. 3/hour. |
| `host-application` | multipart: `full_name`, `phone`, `cnic`, `agency_code`, files `cnic_front`, `cnic_back`, `selfie` | `{ id, status, reasons }` | Didit ID verification + face match; photos not stored. 5/day. |
| `didit-session` | `{ returnTo?, language? }` | `{ url }` | Hosts only; starts Didit ID + selfie verification. 5/hour. |
| `didit-webhook` | Didit event | — | Signature-verified; re-reads the decision from Didit, then updates `hosts.verification_status`. |

## Postgres RPCs (call with `supabase.rpc(name, args)`)

| Area | RPCs |
|---|---|
| Profile | `ensure_profile(p_display_name?, p_region?)`, `become_host`; owner only: `set_profile_verified(p_user, p_verified)` (owner's blue tick `owner_verified_at`, separate from the Didit Host badge; removing it also unpins), `set_profile_pinned(p_user, p_pinned, p_position?)` (owner-verified accounts only, max 20 shown → `not_verified` / `pin_limit`; order is `p_position`, then pin time) |
| Live | `set_room_cover(p_path)` (file in `covers/<user id>/`), `go_live(p_title, p_category)` (needs a cover → else `cover_required`), `end_live()` |
| Media | `create_media_upload(p_title, p_extension, p_description?, p_visibility?)` → asset with fixed `source_path` (upload the file to `uploads/<source_path>`), `submit_media_upload(p_asset_id)`, `update_media(p_asset_id, p_title, p_description, p_visibility)`, `remove_media(p_asset_id, p_reason?)` (owner, or admin takedown), `get_media(p_asset_id)` (also unlisted), `record_media_view(p_asset_id)`. Playback: `<media.media_base>/<playback_path>` (HLS master, VIDEO-RANGE tagged, subtitle tracks). |
| Regions & events | `my_region()`, `event_leaderboard(p_event_id, p_role: host/gifter, p_limit?)`; admins: `upsert_event(p_id?, p_title, p_description, p_kind: gifting/pk_battle, p_region?, p_starts_at, p_ends_at, p_gift_ids?, p_rewards, p_publish)`, `cancel_event(p_id)`, `finalize_event(p_id)` |
| PK battles | `invite_pk_battle(p_target_room_id)`, `respond_pk_battle(p_battle_id, p_accept)` (challenged host: accept/decline; challenger: cancel with `p_accept=false`), `end_pk_battle(p_battle_id)` (either host any time, anyone once the clock runs out) |
| Blocks & payouts | `block_user(p_user)` / `unblock_user(p_user)` (also removes follows both ways), `my_withdrawable_coins()` (balance plus unfolded gift tallies, minus gifts still on hold), `settle_my_earnings()` (folds the caller's pending gift tallies so `creator_earnings` is exact; the Earnings screen calls it first) |
| Room moderation | `room_moderate(p_room, p_target, p_action, p_minutes)` (`mute/kick/block/unmute/unblock`), `set_room_admin(p_user, p_enabled)` |
| Chat & social | `send_chat_message(p_room, p_body)`, `send_direct_message(p_recipient, p_body)`, `request_translation(p_message_id, p_language)`, `report_content(p_target_type, p_target_id, p_reason)`, `create_support_ticket(p_subject, p_body)` |
| Economy | `buy_frame(p_frame_id, p_idempotency_key)` → `frame_purchases` row (price from `frame_catalog`), `equip_frame(p_frame_id \| null)`, `send_gift(p_room_id, p_gift_id, p_quantity, p_idempotency_key)`, `request_refund(p_payment_id, p_reason)`, `request_withdrawal(p_coins, p_payout_method)` |
| Discovery | `get_rankings(p_kind: live/creator/gifter/country, p_period: day/week/month)` (shared cache: 60 s, 15 s for `live`), `host_contributions(p_host, p_period: day/week/month/overall)` → `rank, user_id, display_name, username, avatar_url, user_number, coins, since` |
| Agency portal | `agency_portal(p_agency?)` → `{ agency{id,name,code,status}, role, stats{hosts,verified,live_now,in_review,earnings_lifetime}, hosts[], applications[] }` (money and applicant phones only for admins/managers) (codes are permanent; there is no rotation RPC) |
| Owner/admin | `create_agency_by_user_number(p_name, p_user_number)`, `review_withdrawal`, `mark_withdrawal_paid`, `review_refund`, `apply_moderation_action`, `dismiss_report`, `review_ai_action`, `request_ceo_briefing`, `set_platform_setting`, `set_user_role` (super admin), `create_agency`, `add_agency_member`, `assign_host_to_agency` |
| Service role only | `internal_media_started`, `internal_media_probed`, `internal_media_ready`, `internal_media_failed`, `internal_media_subtitles`, `internal_register_live_recording`, `internal_finalize_due_events`, `internal_create_payment`, `internal_attach_payment_ref`, `internal_credit_payment`, `internal_expire_unstarted_payments`, `internal_refund_payment`, `internal_dispute_payment`, `internal_viewer_event`, `internal_start_host_verification`, `internal_apply_host_verification`, `internal_end_stream_by_livekit_room`, `internal_hide_message`, `internal_ai_moderation`, `internal_execute_ai_action` |

## NestJS API (`apps/api`) — same rules, REST

| Area | Endpoints |
|---|---|
| Regions | `GET /regions`, `GET /regions/me` (JWT) |
| Payments | `GET /payments/packages/mine` (the buyer's region); `POST /payments/checkout` refuses another region's package (`invalid_package`) |
| Media | `GET /media`, `GET /media/mine`, `POST /media/uploads` → `{ asset, uploadUrl, contentType }` (presigned S3 PUT to the fixed key), `POST /media/:id/submit`, `GET /media/:id`, `PUT /media/:id`, `POST /media/:id/remove`, `POST /media/:id/view` |
| Events | `GET /events`, `GET /events/:id/leaderboard?role=host\|gifter&limit=`; admins: `POST /events`, `PUT /events/:id`, `POST /events/:id/cancel`, `POST /events/:id/finalize` |
| Worker (`x-internal-secret`) | `POST /internal/media/:id/{started,probed,ready,failed,subtitles}`, `POST /internal/media/recordings` (IVS Recording End → replay), `POST /internal/events/finalize-due` |

Sign-up (`/auth/register`, `/auth/otp/verify`, `/auth/google`, `/auth/apple`) records `signupCountry` once from `cloudfront-viewer-country` / `cf-ipcountry`, else the optional `region` field.
