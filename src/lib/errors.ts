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
  insufficient_earnings: "You don't have that many coins in earnings.",
  invalid_payout_method: 'Please add your payout details.',
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
};

export function errorCode(e: unknown): string {
  if (e && typeof e === 'object') {
    const anyE = e as { code?: string; message?: string; context?: unknown };
    if (anyE.message && anyE.message in MESSAGES) return anyE.message;
    if (anyE.code && anyE.code in MESSAGES) return anyE.code;
  }
  return 'unknown';
}

export function friendlyError(e: unknown): string {
  const code = errorCode(e);
  return MESSAGES[code] ?? 'Something went wrong. Please try again.';
}
