import { hasMessage, t } from './i18n';

// Maps server error codes (RPC exceptions and edge-function error.code) to
// user-facing copy. Unknown errors get a generic message; details stay server-side.
const MESSAGES: Record<string, string> = {
  not_authenticated: 'Please sign in again.',
  forbidden: "You don't have permission to do that.",
  account_restricted: 'Your account is currently restricted.',
  insufficient_coins: "You don't have enough coins.",
  wallet_frozen: 'Your wallet is on hold while a payment is reviewed.',
  room_not_live: 'This room is no longer live.',
  banned_from_room: "You can't join this room.",
  cannot_gift_self: "You can't send gifts to yourself.",
  muted_in_room: "You're muted in this room.",
  slow_down: "You're sending messages too fast.",
  duplicate_message: 'You just sent that.',
  message_blocked: "That message isn't allowed.",
  invalid_length: 'Message is too long.',
  not_a_host: 'Become a host first.',
  withdrawals_not_configured: 'Withdrawals open soon — the payout rate is being finalised.',
  below_minimum: 'Amount is below the minimum withdrawal.',
  insufficient_earnings: "You don't have that many withdrawable diamonds. New gift earnings unlock after a short safety hold.",
  withdrawals_unavailable: 'Withdrawals are not available in your region yet.',
  invalid_payout_method: 'Check the payout account number and try again.',
  must_follow_host: 'Only people who follow you can be room admins.',
  invalid_admin: "You can't make yourself a room admin.",
  application_required: 'Submit your host application with your agency code first.',
  not_a_party: 'This room is not a party right now.',
  already_live: 'End your live first, then change the room type.',
  seats_full: 'All seats are taken.',
  no_request: 'That person is no longer asking for a seat.',
  not_seated: "You're not on a seat.",
  host_has_seat: 'You already have the host seat.',
  room_admin_limit: 'A room can have at most 5 admins.',
  cannot_moderate_host: "You can't moderate the host.",
  cannot_moderate_admin: 'Only the host can moderate room admins.',
  rate_limited: 'Too many requests — try again in a minute.',
  blocked: "You can't message this person.",
  payment_not_refundable: 'This purchase cannot be refunded.',
  not_configured: 'This feature is not configured yet.',
  verification_required: 'Verify your identity first (Go live tab → Verify identity).',
  agency_code_required: 'Enter your agency code.',
  invalid_agency_code: 'That agency code was not found. Check the 4 digits with your agency.',
  not_agency_member: "You're not part of an agency.",
  user_not_found: 'No user with that ID.',
  already_in_agency: 'That user already belongs to an agency.',
  invalid_period: 'Unknown period.',
  cover_required: 'Add a cover picture to go live.',
  invalid_cover: 'That picture could not be used. Try another one.',
  agency_code_permanent: 'Agency codes are permanent and cannot be changed.',
  invalid_phone: 'Enter a valid mobile number, e.g. 300 1234567.',
  invalid_cnic: 'CNIC number must be 13 digits.',
  invalid_name: 'Enter your full name as on your CNIC.',
  missing_photo: 'Add all three photos.',
  photo_too_large: 'A photo is too large. Retake it and try again.',
  invalid_photo: 'Use a JPEG, PNG or WebP photo.',
  withdrawal_pending: 'You have a withdrawal in progress. Wait for it to be paid or rejected, then try again.',
  auth_provider_error: 'Could not finish deleting your sign-in. Please try again.',
  already_verified: "You're already verified.",
  verification_in_review: 'Your verification is being reviewed.',
  verification_unavailable: 'Verification is temporarily unavailable. Please try again.',
  not_live: 'Go live first to start a battle.',
  invalid_target: 'Pick a host to battle.',
  target_not_live: "That host isn't live right now.",
  cannot_battle_self: "You can't battle your own room.",
  already_in_battle: "You're already in a battle.",
  target_already_in_battle: 'That host is already in a battle.',
  not_invitable: "This invite isn't pending anymore.",
  uploads_disabled: 'Video uploads are temporarily unavailable.',
  invalid_format: 'Use an MP4, MOV, M4V, WebM or MKV video.',
  title_required: 'Add a title.',
  invalid_visibility: 'Choose Public or Unlisted.',
  too_many_pending: 'Wait for your other uploads to finish processing first.',
  already_submitted: 'This video is already uploaded.',
  upload_missing: 'The upload did not finish. Try again.',
  not_found: 'That could not be found.',
  too_long: 'That video is longer than the limit.',
  file_too_large: 'That video is larger than the limit.',
  invalid_package: 'That coin package is not available in your region.',
  invalid_region: 'Unknown region.',
  invalid_rewards: 'Check the rewards: each needs a rank range and a description.',
  invalid_gift: 'That gift is not available.',
  invalid_schedule: 'The event must end after it starts, in the future.',
  event_locked: 'Running or finished events cannot be edited.',
  event_not_ended: 'The event has not ended yet.',
  not_finalizable: 'This event is already finalized or cancelled.',
};

export function errorCode(e: unknown): string {
  if (e && typeof e === 'object') {
    const anyE = e as { code?: string; message?: string; context?: unknown };
    if (anyE.message && anyE.message in MESSAGES) return anyE.message;
    if (anyE.code && anyE.code in MESSAGES) return anyE.code;
  }
  return 'unknown';
}

/** User-facing copy in the current language (English where a code has no translation yet). */
export function friendlyError(e: unknown): string {
  const code = errorCode(e);
  const key = `error.${code}`;
  if (hasMessage(key)) return t(key);
  return MESSAGES[code] ?? t('error.generic');
}
