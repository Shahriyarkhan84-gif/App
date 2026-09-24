import { ReturnBounce } from '@/components/ReturnBounce';

/** Stripe redirects here after coin checkout. */
export default function CheckoutReturn() {
  return <ReturnBounce fallback="/wallet" />;
}
