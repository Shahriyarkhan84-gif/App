import { ReturnBounce } from '@/components/ReturnBounce';

/** Didit redirects here after identity verification. */
export default function VerifyReturn() {
  return <ReturnBounce fallback="/create" />;
}
