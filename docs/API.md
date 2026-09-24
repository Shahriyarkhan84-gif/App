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
| `didit-session` | `{ returnTo?, language? }` | `{ url }` | Hosts only; starts Didit ID + selfie verification. 5/hour. |
| `didit-webhook` | Didit event | — | Signature-verified; re-reads the decision from Didit, then updates `hosts.verification_status`. |

## Postgres RPCs (call with `supabase.rpc(name, args)`)

| Area | RPCs |
|---|---|
| Profile | `ensure_profile`, `become_host` |
| Live | `go_live(p_title, p_category)`, `end_live()` |
| Room moderation | `room_moderate(p_room, p_target, p_action, p_minutes)` (`mute/kick/block/unmute/unblock`), `set_room_admin(p_user, p_enabled)` |
| Chat & social | `send_chat_message(p_room, p_body)`, `send_direct_message(p_recipient, p_body)`, `request_translation(p_message_id, p_language)`, `report_content(p_target_type, p_target_id, p_reason)`, `create_support_ticket(p_subject, p_body)` |
| Economy | `send_gift(p_room_id, p_gift_id, p_quantity, p_idempotency_key)`, `request_refund(p_payment_id, p_reason)`, `request_withdrawal(p_coins, p_payout_method)` |
| Discovery | `get_rankings(p_kind: live/creator/gifter/country, p_period: day/week/month)` |
| Owner/admin | `review_withdrawal`, `mark_withdrawal_paid`, `review_refund`, `apply_moderation_action`, `dismiss_report`, `review_ai_action`, `request_ceo_briefing`, `set_platform_setting`, `set_user_role` (super admin), `create_agency`, `add_agency_member`, `assign_host_to_agency` |
| Service role only | `internal_create_payment`, `internal_attach_payment_ref`, `internal_credit_payment`, `internal_refund_payment`, `internal_dispute_payment`, `internal_viewer_event`, `internal_start_host_verification`, `internal_apply_host_verification`, `internal_end_stream_by_livekit_room`, `internal_hide_message`, `internal_ai_moderation`, `internal_execute_ai_action` |
