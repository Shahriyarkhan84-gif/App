import { UsersService } from './users.service';

/**
 * Regression test for a real bug found while building the mobile client
 * (Phase 8, docs/MIGRATION_PLAN.md): GET /users/:id was a public,
 * unauthenticated endpoint that used `include: { wallet: true, host: true }`
 * on the bare User relation, which pulls every column by default —
 * including passwordHash, refreshTokenHash, twoFactorSecret, googleSub and
 * appleSub. Same bug existed in StreamsService.listLive() and
 * RecommendationsService.forUser() via `include: { host: { include: { user:
 * true } } }`. This locks down the fix: both user-lookup paths must always
 * pass an explicit `select` that excludes those fields, never a bare
 * `include`/`select: { ...: true }` on the whole User relation.
 */
describe('UsersService — never leaks credential fields', () => {
  const SENSITIVE_FIELDS = ['passwordHash', 'refreshTokenHash', 'twoFactorSecret', 'googleSub', 'appleSub'];

  function buildService() {
    const findUnique = jest.fn().mockResolvedValue({ id: 'u1' });
    const prisma = { user: { findUnique } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new UsersService(prisma as any);
    return { service, findUnique };
  }

  it('findSelf() selects fields explicitly and excludes every credential field', async () => {
    const { service, findUnique } = buildService();
    await service.findSelf('u1');

    const call = findUnique.mock.calls[0][0];
    expect(call).not.toHaveProperty('include');
    expect(call.select).toBeDefined();
    for (const field of SENSITIVE_FIELDS) {
      expect(call.select).not.toHaveProperty(field);
    }
  });

  it('findPublicProfile() selects fields explicitly and excludes every credential field (and email/phone)', async () => {
    const { service, findUnique } = buildService();
    await service.findPublicProfile('u1');

    const call = findUnique.mock.calls[0][0];
    expect(call).not.toHaveProperty('include');
    expect(call.select).toBeDefined();
    for (const field of [...SENSITIVE_FIELDS, 'email', 'phone']) {
      expect(call.select).not.toHaveProperty(field);
    }
  });
});
