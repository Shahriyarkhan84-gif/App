import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { REGION_SEED, RegionsService } from '../regions/regions.service';
import { EventsService, rankScores, rewardFor, validRewards } from './events.service';

/**
 * Mirrors supabase/tests/95_regions_events.sql: admin-only lifecycle,
 * regional + qualifying-gift scoring, battle league points, and
 * finalization (only after the end, rewards + notifications).
 */
describe('EventsService', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const hour = 3_600_000;

  function build(opts: { events?: unknown[]; signup?: Record<string, string | null>; event?: unknown; scores?: unknown[] } = {}) {
    const upserts: { eventId: string; userId: string; role: string; score: bigint }[] = [];
    const tx = {
      event: {
        findMany: jest.fn().mockResolvedValue(opts.events ?? []),
        findUnique: jest.fn().mockResolvedValue(opts.event ?? null),
        update: jest.fn().mockImplementation(({ data }) => ({ ...(opts.event as object), ...data })),
      },
      eventScore: {
        upsert: jest.fn().mockImplementation(({ create }) => upserts.push(create)),
        findMany: jest.fn().mockImplementation(({ where }) => (opts.scores ?? []).filter((s) => (s as { role: string }).role === where.role)),
      },
      eventResult: { createMany: jest.fn() },
      notification: { createMany: jest.fn() },
      auditLog: { create: jest.fn() },
      user: { findUnique: jest.fn().mockImplementation(({ where }) => ({ signupCountry: opts.signup?.[where.id] ?? null })) },
      region: { findMany: jest.fn().mockResolvedValue(REGION_SEED) },
    };
    const prisma = { ...tx, $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)), giftCatalogItem: { count: jest.fn() } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EventsService(prisma as any, new RegionsService(prisma as any));
    return { service, tx, prisma, upserts };
  }

  const gifting = (over: object = {}) => ({
    id: 'ev1', kind: 'gifting', status: 'scheduled', regionCode: null, giftIds: [] as number[],
    startsAt: new Date(now.getTime() - hour), endsAt: new Date(now.getTime() + hour), rewards: [], ...over,
  });

  it('validates rewards and resolves them by rank', () => {
    const rewards = [{ role: 'host' as const, rank_from: 1, rank_to: 1, reward: 'Banner' }, { role: 'gifter' as const, rank_from: 1, rank_to: 3, reward: 'Badge' }];
    expect(validRewards(rewards)).toBe(true);
    expect(validRewards([{ role: 'host', rank_from: 3, rank_to: 1, reward: 'x' }])).toBe(false);
    expect(validRewards([{ role: 'viewer', rank_from: 1, rank_to: 1, reward: 'x' }])).toBe(false);
    expect(rewardFor(rewards, 'gifter', 3)).toBe('Badge');
    expect(rewardFor(rewards, 'gifter', 4)).toBeNull();
  });

  it('ranks by score, then whoever got there first; zero scores are not ranked', () => {
    const t = (m: number) => new Date(now.getTime() + m);
    const ranked = rankScores([
      { userId: 'b', score: 100n, updatedAt: t(2) }, { userId: 'a', score: 100n, updatedAt: t(1) },
      { userId: 'c', score: 300n, updatedAt: t(3) }, { userId: 'z', score: 0n, updatedAt: t(0) },
    ]);
    expect(ranked.map((r) => [r.userId, r.rank])).toEqual([['c', 1], ['a', 2], ['b', 3]]);
  });

  it('only platform admins create events', async () => {
    const { service } = build();
    const input = { title: 'Eid race', kind: 'gifting' as const, startsAt: now, endsAt: new Date(now.getTime() + hour), publish: true };
    await expect(service.upsert('u1', 'USER', null, input, now)).rejects.toThrow(ForbiddenException);
  });

  it('gifting races count qualifying gifts for the host and the sender, within the event region', async () => {
    const { service, tx, upserts } = build({
      events: [gifting({ id: 'pk_race', regionCode: 'PK', giftIds: [3] }), gifting({ id: 'global_race' })],
      signup: { host_pk: 'PK', host_in: 'IN' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.applyGift(tx as any, { hostId: 'host_pk', senderId: 'fan', giftId: 3, coinsTotal: 50n }, now);
    expect(upserts).toEqual([
      { eventId: 'pk_race', userId: 'host_pk', role: 'host', score: 50n }, { eventId: 'pk_race', userId: 'fan', role: 'gifter', score: 50n },
      { eventId: 'global_race', userId: 'host_pk', role: 'host', score: 50n }, { eventId: 'global_race', userId: 'fan', role: 'gifter', score: 50n },
    ]);
    upserts.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.applyGift(tx as any, { hostId: 'host_in', senderId: 'fan', giftId: 1, coinsTotal: 7n }, now);
    // Indian host is outside the PK race, and Roses (1) don't qualify for it anyway.
    expect(upserts.map((u) => u.eventId)).toEqual(['global_race', 'global_race']);
  });

  it('battle leagues give the winner 3 points and each side 1 for a tie', async () => {
    const league = { id: 'league', kind: 'pk_battle', regionCode: null };
    const { service, tx, upserts } = build({ events: [league] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.applyBattle(tx as any, { startedAt: now, hostA: 'a', hostB: 'b', winnerHost: 'a' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.applyBattle(tx as any, { startedAt: now, hostA: 'a', hostB: 'b', winnerHost: null });
    expect(upserts.map((u) => [u.userId, u.score])).toEqual([['a', 3n], ['a', 1n], ['b', 1n]]);
  });

  it('cannot finalize before the end', async () => {
    const { service } = build({ event: gifting() });
    await expect(service.finalize('ev1', 'owner', now)).rejects.toThrow(BadRequestException);
  });

  it('finalizes once ended: snapshots ranks, attaches rewards, notifies winners', async () => {
    const ended = gifting({ endsAt: new Date(now.getTime() - 1), rewards: [{ role: 'host', rank_from: 1, rank_to: 1, reward: 'Home banner' }] });
    const t = (m: number) => new Date(now.getTime() - hour + m);
    const { service, tx } = build({
      event: ended,
      scores: [
        { userId: 'h1', role: 'host', score: 500n, updatedAt: t(1) }, { userId: 'h2', role: 'host', score: 200n, updatedAt: t(2) },
        { userId: 'f1', role: 'gifter', score: 700n, updatedAt: t(1) },
      ],
    });
    const result = await service.finalize('ev1', null, now);
    expect(result.status).toBe('finalized');
    const rows = tx.eventResult.createMany.mock.calls[0][0].data;
    expect(rows).toEqual([
      { eventId: 'ev1', role: 'host', rank: 1, userId: 'h1', score: 500n, reward: 'Home banner' },
      { eventId: 'ev1', role: 'host', rank: 2, userId: 'h2', score: 200n, reward: null },
      { eventId: 'ev1', role: 'gifter', rank: 1, userId: 'f1', score: 700n, reward: null },
    ]);
    expect(tx.notification.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ userId: 'h1', type: 'event_reward', body: 'You finished #1 — Home banner' }),
    ]);
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorKind: 'system', action: 'event_finalized' }) });
  });

  it('a finalized event cannot be finalized again', async () => {
    const { service } = build({ event: gifting({ status: 'finalized', endsAt: new Date(now.getTime() - 1) }) });
    await expect(service.finalize('ev1', null, now)).rejects.toThrow('not_finalizable');
  });
});
