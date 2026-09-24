import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';

import { HttpError, requireEnv } from './cors.ts';

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

/**
 * Verifies the Clerk session token sent by the app and returns the Clerk user id.
 * CLERK_ISSUER is your Clerk Frontend API URL, e.g. https://example.clerk.accounts.dev
 */
export async function requireUser(req: Request): Promise<{ userId: string }> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'not_authenticated');

  const issuer = requireEnv('CLERK_ISSUER').replace(/\/$/, '');
  jwks ??= createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  try {
    const { payload } = await jwtVerify(token, jwks, { issuer });
    if (!payload.sub) throw new Error('no sub');
    return { userId: payload.sub };
  } catch {
    throw new HttpError(401, 'not_authenticated', 'Invalid session');
  }
}
