// Deletes the signed-in user's account (Google Play / App Store requirement):
// anonymises their data via internal_delete_account(), then deletes the Clerk user.
// Financial records are kept (see migration 20260924090000_account_deletion.sql).
import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json, requireEnv, rpcError } from '../_shared/cors.ts';
import { rateLimit } from '../_shared/redis.ts';
import { adminClient } from '../_shared/supabase.ts';

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    await rateLimit('delete-account', userId, 3, '1 h');
    const clerkSecret = requireEnv('CLERK_SECRET_KEY');

    const { error } = await adminClient().rpc('internal_delete_account', { p_user: userId });
    if (error) rpcError(error);

    // Retry-safe: the database step is idempotent and Clerk returns 404 once deleted.
    const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${clerkSecret}` },
    });
    if (!res.ok && res.status !== 404) {
      console.error('clerk delete failed', res.status, await res.text());
      throw new HttpError(502, 'auth_provider_error', 'Could not finish deleting your sign-in. Please try again.');
    }
    return json({ deleted: true });
  }),
);
