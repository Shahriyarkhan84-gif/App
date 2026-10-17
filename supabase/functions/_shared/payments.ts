// What a Stripe Checkout session means for its payment row, shared by the webhook and the
// reconciler (payments-reconcile) so both apply exactly the same rules.

/** The fields of a Checkout session this decision needs. */
export type SessionState = {
  mode: string | null;
  status: string | null; // open | complete | expired
  payment_status: string | null; // paid | unpaid | no_payment_required
};

/** credit: paid, add the coins · fail: will never be paid · wait: still open or processing. */
export function sessionOutcome(s: SessionState): 'credit' | 'fail' | 'wait' {
  if (s.mode !== 'payment') return 'wait';
  if (s.status === 'complete' && s.payment_status === 'paid') return 'credit';
  if (s.status === 'expired') return 'fail';
  return 'wait'; // open, or complete but a delayed payment method is still processing
}
