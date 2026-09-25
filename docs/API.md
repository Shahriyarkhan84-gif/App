# API

## Edge functions (`supabase/functions/`)

All return `{ error: { code, message } }` on failure. User-facing functions require
`Authorization: Bearer <Clerk session JWT>`.

| Function | Body | Returns | Notes |
|---|---|---|---|
| `livekit-token` | `{ roomId, as: 'viewer' \| 'host' }` | `{ token, url }` | 2h token; hosts publish camera+mic in their own live room only; viewers subscribe-only; bans enforced. 30/min. |
| `coins-checkout` | `{ packageId, returnTo? }` | `{ url }` | Stripe Checkout; price from `coin_packages`. 5/min. |
| `stripe-webhook` | Stripe event | — | Signature-verified; credits coins, refunds, disputes. |
| `livekit-webhook` | LiveKit event | — | Viewer counts, viewer records, stream end. |
| `clerk-webhook` | Svix event | — | Profile sync + welcome email. Never sets roles. |
| `delete-account` | `{}` | `{ deleted }` | Deletes the signed-in account: `internal_delete_account()` then the Clerk user. `withdrawal_pending` (409) if a payout is in progress. 3/hour. |
| `host-application` | multipart: `full_name`, `phone`, `cnic`, `agency_code`, files `cnic_front`, `cnic_back`, `selfie` | `{ id, status, reasons }` | Didit ID verification + face match; photos not stored. 5/day. |
| `didit-session` | `{ returnTo?, language? }` | `{ url }` | Hosts only; starts Didit ID + selfie verification. 5/hour. |
| `didit-webhook` | Didit event | — | Signature-verified; re-reads the decision from Didit, then updates `hosts.verification_status`. |

## Postgres RPCs (call with `supabase.rpc(name, args)`)

| Area | RPCs |
|---|---|
| Profile | `ensure_profile(p_display_name?, p_region?)`, `become_host` |
| Live | `set_room_cover(p_path)` (file in `covers/<user id>/`), `go_live(p_title, p_category)` (needs a cover → else `cover_required`), `end_live()` |
| Room moderation | `room_moderate(p_room, p_target, p_action, p_minutes)` (`mute/kick/block/unmute/unblock`), `set_room_admin(p_user, p_enabled)` |
| Chat & social | `send_chat_message(p_room, p_body)`, `send_direct_message(p_recipient, p_body)`, `request_translation(p_message_id, p_language)`, `report_content(p_target_type, p_target_id, p_reason)`, `create_support_ticket(p_subject, p_body)` |
| Economy | `send_gift(p_room_id, p_gift_id, p_quantity, p_idempotency_key)`, `request_refund(p_payment_id, p_reason)`, `request_withdrawal(p_coins, p_payout_method)` |
| Discovery | `get_rankings(p_kind: live/creator/gifter/country, p_period: day/week/month)`, `host_contributions(p_host, p_period: day/week/month/overall)` → `rank, user_id, display_name, username, avatar_url, user_number, coins, since` |
| Agency portal | `agency_portal(p_agency?)` → `{ agency{id,name,code,status}, role, stats{hosts,verified,live_now,in_review,earnings_lifetime}, hosts[], applications[] }` (money and applicant phones only for admins/managers) (codes are permanent; there is no rotation RPC) |
| Owner/admin | `create_agency_by_user_number(p_name, p_user_number)`, `review_withdrawal`, `mark_withdrawal_paid`, `review_refund`, `apply_moderation_action`, `dismiss_report`, `review_ai_action`, `request_ceo_briefing`, `set_platform_setting`, `set_user_role` (super admin), `create_agency`, `add_agency_member`, `assign_host_to_agency` |
| Service role only | `internal_create_payment`, `internal_attach_payment_ref`, `internal_credit_payment`, `internal_refund_payment`, `internal_dispute_payment`, `internal_viewer_event`, `internal_start_host_verification`, `internal_apply_host_verification`, `internal_end_stream_by_livekit_room`, `internal_hide_message`, `internal_ai_moderation`, `internal_execute_ai_action` |
