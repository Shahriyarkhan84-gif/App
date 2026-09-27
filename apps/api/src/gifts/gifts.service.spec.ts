import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { GiftsService } from './gifts.service';

/**
 * Unit-level mirror of the gift-split, insufficient-balance, self-gift and
 * idempotent-replay cases from supabase/tests/10_must_pass.sql (section 5,
 * "A duplicated gift request cannot double-charge", and the Heart-gift math
 * check). This environment has no live Postgres to run the real SQL suite
 * against, so these exercise GiftsService.sendGift()'s actual control flow
 * and arithmetic against a hand-built fake Prisma client, rather than
 * re-testing Prisma itself — every call GiftsService makes is asserted, so
 * a change to the call sequence or the split math breaks this test.
 */
describe('GiftsService.sendGift', () => {
  const senderId = 'user_sender';
  const hostId = 'user_host';
  const roomId = 'room_1';
  const idempotencyKey = 'idem-key-123';

  function buildTx(overrides: {
    wallet?: { coinBalance: bigint; frozen: boolean };
    existingGift?: unknown;
    room?: { id: string; hostId: string; status: string; currentStreamId: string | null };
    ban?: unknown;
    giftCatalog?: { id: number; coinPrice: number; active: boolean } | null;
    giftSplit?: { host_pct: number; owner_pct: number } | null;
  }) {
    const created: Record<string, unknown> = {};
    const tx = {
      gift: {
        findFirst: jest.fn().mockResolvedValue(overrides.existingGift ?? null),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          const gift = { id: 'gift_1', ...data };
          created.gift = gift;
          return gift;
        }),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: senderId, status: 'active' }),
      },
      room: {
        findUnique: jest.fn().mockResolvedValue(
          overrides.room ?? { id: roomId, hostId, status: 'live', currentStreamId: null },
        ),
      },
      roomBan: {
        findFirst: jest.fn().mockResolvedValue(overrides.ban ?? null),
      },
      giftCatalogItem: {
        findFirst: jest.fn().mockResolvedValue(
          overrides.giftCatalog === undefined ? { id: 3, coinPrice: 10, active: true } : overrides.giftCatalog,
        ),
      },
      creatorEarning: { upsert: jest.fn(), update: jest.fn() },
      earningEntry: { create: jest.fn() },
      stream: { update: jest.fn() },
      platformLedger: { create: jest.fn() },
      platformSetting: {
        findUnique: jest.fn().mockResolvedValue(
          overrides.giftSplit === undefined
            ? { value: { host_pct: 90, owner_pct: 5 } }
            : overrides.giftSplit
              ? { value: overrides.giftSplit }
              : null,
        ),
      },
    };
    return { tx, created };
  }

  function buildService(tx: unknown, wallet: { coinBalance: bigint; frozen: boolean }) {
    const prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
    const wallets = {
      lockWallet: jest.fn().mockResolvedValue(wallet),
      applyCoinDelta: jest.fn().mockResolvedValue(wallet.coinBalance),
    };
    const battles = { applyGiftScore: jest.fn().mockResolvedValue(undefined) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new GiftsService(prisma as any, wallets as any, battles as any);
    return { service, prisma, wallets, battles };
  }

  it('splits coins so host + stream + owner shares always sum to the total charged', async () => {
    const wallet = { coinBalance: 1000n, frozen: false };
    const { tx, created } = buildTx({ wallet });
    const { service, wallets, battles } = buildService(tx, wallet);

    // Heart (id 3) = 10 coins, quantity 5 -> 50 coins total, matching the
    // "Heart (id 3) = 10 coins x 2" fixture's shape in 10_must_pass.sql.
    const gift = (await service.sendGift(senderId, roomId, 3, 5, idempotencyKey)) as {
      coinsTotal: bigint;
      hostShare: bigint;
      streamShare: bigint;
      ownerShare: bigint;
    };

    expect(gift.coinsTotal).toBe(50n);
    expect(gift.hostShare).toBe(45n); // 90%
    expect(gift.ownerShare).toBe(2n); // 5%
    expect(gift.streamShare).toBe(3n); // remainder, not a straight 5%
    expect(gift.hostShare + gift.streamShare + gift.ownerShare).toBe(gift.coinsTotal);

    expect(wallets.applyCoinDelta).toHaveBeenCalledWith(tx, senderId, -50n, 'gift_sent', 'gift', 'gift_1', 'gift:gift_1');
    expect(battles.applyGiftScore).toHaveBeenCalledWith(roomId, 50n, tx);
    void created;
  });

  it('rejects when the wallet balance is below the gift total (insufficient_coins)', async () => {
    const wallet = { coinBalance: 5n, frozen: false }; // costs 50, has 5
    const { tx } = buildTx({ wallet });
    const { service, wallets } = buildService(tx, wallet);

    await expect(service.sendGift(senderId, roomId, 3, 5, idempotencyKey)).rejects.toThrow(BadRequestException);
    expect(wallets.applyCoinDelta).not.toHaveBeenCalled();
  });

  it('rejects a host gifting their own room (cannot_gift_self)', async () => {
    const wallet = { coinBalance: 1000n, frozen: false };
    const { tx } = buildTx({ wallet, room: { id: roomId, hostId: senderId, status: 'live', currentStreamId: null } });
    const { service } = buildService(tx, wallet);

    await expect(service.sendGift(senderId, roomId, 3, 5, idempotencyKey)).rejects.toThrow(BadRequestException);
  });

  it('rejects a sender kicked/blocked from the room (banned_from_room)', async () => {
    const wallet = { coinBalance: 1000n, frozen: false };
    const { tx } = buildTx({ wallet, ban: { kind: 'block', expiresAt: null } });
    const { service } = buildService(tx, wallet);

    await expect(service.sendGift(senderId, roomId, 3, 5, idempotencyKey)).rejects.toThrow(ForbiddenException);
  });

  it('replays a duplicate idempotency key without charging the wallet again', async () => {
    const wallet = { coinBalance: 1000n, frozen: false };
    const existingGift = { id: 'gift_existing', senderId, idempotencyKey, coinsTotal: 50n };
    const { tx } = buildTx({ wallet, existingGift });
    const { service, wallets, battles } = buildService(tx, wallet);

    const result = await service.sendGift(senderId, roomId, 3, 5, idempotencyKey);

    expect(result).toBe(existingGift);
    expect(wallets.applyCoinDelta).not.toHaveBeenCalled();
    expect(battles.applyGiftScore).not.toHaveBeenCalled();
    // Nothing past the idempotency check should even run.
    expect((tx as { room: { findUnique: jest.Mock } }).room.findUnique).not.toHaveBeenCalled();
  });
});
