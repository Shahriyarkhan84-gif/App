import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@zynalive/database';

import { BattlesService } from '../battles/battles.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';

type GiftSplit = { hostPct: number; ownerPct: number };
const DEFAULT_SPLIT: GiftSplit = { hostPct: 90, ownerPct: 5 }; // matches the seed row in core.sql

@Injectable()
export class GiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
    private readonly battles: BattlesService,
    private readonly events: EventsService,
  ) {}

  catalog() {
    return this.prisma.giftCatalogItem.findMany({ where: { active: true }, orderBy: { sort: 'asc' } });
  }

  /**
   * Translated from public.send_gift() in
   * supabase/migrations/20260924020000_economy.sql. Every step and its
   * order is load-bearing: the wallet lock is taken first so concurrent
   * sends by the same sender serialize; the idempotency check happens right
   * after the lock and, on a match, short-circuits before any other
   * validation — exactly like the SQL version — so a retried request can
   * never be charged twice or see a different rejection than the original.
   */
  async sendGift(senderId: string, roomId: string, giftId: number, quantity: number, idempotencyKey: string) {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await this.wallets.lockWallet(tx, senderId);

      const existing = await tx.gift.findFirst({ where: { senderId, idempotencyKey } });
      if (existing) return existing;

      const sender = await tx.user.findUniqueOrThrow({ where: { id: senderId } });
      if (sender.status !== 'active') throw new ForbiddenException('account_restricted');
      if (wallet.frozen) throw new ForbiddenException('wallet_frozen');

      const room = await tx.room.findUnique({ where: { id: roomId } });
      if (!room || room.status !== 'live') throw new BadRequestException('room_not_live');
      if (room.hostId === senderId) throw new BadRequestException('cannot_gift_self');

      const activeBan = await tx.roomBan.findFirst({
        where: {
          roomId,
          userId: senderId,
          kind: { in: ['kick', 'block'] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (activeBan) throw new ForbiddenException('banned_from_room');

      const giftCatalog = await tx.giftCatalogItem.findFirst({ where: { id: giftId, active: true } });
      if (!giftCatalog) throw new BadRequestException('invalid_gift');

      const total = BigInt(giftCatalog.coinPrice) * BigInt(quantity);
      if (wallet.coinBalance < total) throw new BadRequestException('insufficient_coins');

      const split = await this.giftSplit(tx);
      const hostShare = (total * BigInt(split.hostPct)) / 100n;
      const ownerShare = (total * BigInt(split.ownerPct)) / 100n;
      const streamShare = total - hostShare - ownerShare; // rounding remainder stays in the stream pool

      const gift = await tx.gift.create({
        data: {
          roomId,
          streamId: room.currentStreamId,
          senderId,
          hostId: room.hostId,
          giftId,
          quantity,
          coinsTotal: total,
          hostShare,
          streamShare,
          ownerShare,
          idempotencyKey,
        },
      });

      await this.wallets.applyCoinDelta(tx, senderId, -total, 'gift_sent', 'gift', gift.id, `gift:${gift.id}`);

      await tx.creatorEarning.upsert({ where: { hostId: room.hostId }, create: { hostId: room.hostId }, update: {} });
      await tx.creatorEarning.update({
        where: { hostId: room.hostId },
        data: { balance: { increment: hostShare }, lifetime: { increment: hostShare } },
      });
      await tx.earningEntry.create({ data: { hostId: room.hostId, delta: hostShare, kind: 'gift', refId: gift.id } });

      if (room.currentStreamId) {
        await tx.stream.update({
          where: { id: room.currentStreamId },
          data: { giftCoins: { increment: total }, poolCoins: { increment: streamShare } },
        });
      }
      await tx.platformLedger.create({
        data: { bucket: 'gift_owner_share', unit: 'coins', amount: ownerShare, refType: 'gift', refId: gift.id },
      });

      // Same effect as the SQL trigger on `gifts`, called explicitly here
      // since this transaction *is* the gift insert.
      await this.battles.applyGiftScore(roomId, total, tx);
      // Same as the events_gift_score trigger: gifting-race scores, in this transaction.
      await this.events.applyGift(tx, { hostId: room.hostId, senderId, giftId, coinsTotal: total });

      return gift;
    });
  }

  private async giftSplit(tx: Prisma.TransactionClient): Promise<GiftSplit> {
    const setting = await tx.platformSetting.findUnique({ where: { key: 'gift_split' } });
    const value = setting?.value as { host_pct?: number; owner_pct?: number } | undefined;
    return {
      hostPct: value?.host_pct ?? DEFAULT_SPLIT.hostPct,
      ownerPct: value?.owner_pct ?? DEFAULT_SPLIT.ownerPct,
    };
  }
}
