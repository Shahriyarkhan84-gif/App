import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@zynalive/database';

import { PLATFORM_ADMIN_ROLES } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Translated from the withdrawals section of
 * supabase/migrations/20260924020000_economy.sql
 * (request_withdrawal / review_withdrawal / mark_withdrawal_paid).
 */
@Injectable()
export class EarningsService {
  constructor(private readonly prisma: PrismaService) {}

  async getEarnings(hostUserId: string) {
    return this.prisma.creatorEarning.upsert({
      where: { hostId: hostUserId },
      create: { hostId: hostUserId },
      update: {},
    });
  }

  async requestWithdrawal(userId: string, coins: number, payoutMethod: { type: string }) {
    const host = await this.prisma.host.findFirst({ where: { userId, status: 'active' } });
    if (!host) throw new ForbiddenException('not_a_host');

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== 'active') throw new ForbiddenException('account_restricted');

    const setting = await this.prisma.platformSetting.findUnique({ where: { key: 'withdrawal' } });
    const config = (setting?.value ?? {}) as { pkr_per_coin?: number | null; min_coins?: number };
    const rate = config.pkr_per_coin;
    if (!rate || rate <= 0) throw new BadRequestException('withdrawals_not_configured');
    if (coins < (config.min_coins ?? 0)) throw new BadRequestException('below_minimum');
    if (!payoutMethod?.type) throw new BadRequestException('invalid_payout_method');

    const coinsBig = BigInt(coins);
    return this.prisma.$transaction(async (tx) => {
      const earnings = await this.lockEarnings(tx, userId);
      if (earnings.balance < coinsBig) throw new BadRequestException('insufficient_earnings');

      await tx.creatorEarning.update({
        where: { hostId: userId },
        data: { balance: { decrement: coinsBig }, held: { increment: coinsBig } },
      });
      const withdrawal = await tx.withdrawal.create({
        data: {
          hostId: userId,
          coins: coinsBig,
          amountMinor: BigInt(Math.floor(coins * rate * 100)),
          payoutMethod,
        },
      });
      await tx.earningEntry.create({
        data: { hostId: userId, delta: -coinsBig, kind: 'withdrawal_hold', refId: withdrawal.id },
      });
      return withdrawal;
    });
  }

  async reviewWithdrawal(reviewerId: string, reviewerRole: string, withdrawalId: string, approve: boolean, note?: string) {
    if (!(PLATFORM_ADMIN_ROLES as string[]).includes(reviewerRole)) throw new ForbiddenException();

    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findFirst({ where: { id: withdrawalId, status: 'requested' } });
      if (!withdrawal) throw new NotFoundException('not_found');
      await this.lockEarnings(tx, withdrawal.hostId);

      if (approve) {
        await tx.creatorEarning.update({ where: { hostId: withdrawal.hostId }, data: { held: { decrement: withdrawal.coins } } });
      } else {
        await tx.creatorEarning.update({
          where: { hostId: withdrawal.hostId },
          data: { held: { decrement: withdrawal.coins }, balance: { increment: withdrawal.coins } },
        });
        await tx.earningEntry.create({
          data: { hostId: withdrawal.hostId, delta: withdrawal.coins, kind: 'withdrawal_release', refId: withdrawal.id },
        });
      }

      const updated = await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: approve ? 'approved' : 'rejected', reviewedBy: reviewerId, reviewNote: note },
      });
      await tx.notification.create({
        data: {
          userId: updated.hostId,
          type: 'withdrawal',
          title: `Withdrawal ${updated.status}`,
          body: note,
          data: { withdrawal_id: updated.id },
        },
      });
      return updated;
    });
  }

  async markWithdrawalPaid(reviewerRole: string, withdrawalId: string, payoutRef: string) {
    if (!(PLATFORM_ADMIN_ROLES as string[]).includes(reviewerRole)) throw new ForbiddenException();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, status: 'approved' },
        data: { status: 'paid', payoutRef },
      });
      if (updated.count === 0) throw new NotFoundException('not_found');

      const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      await tx.earningEntry.create({ data: { hostId: withdrawal.hostId, delta: 0n, kind: 'withdrawal_paid', refId: withdrawal.id } });
      return withdrawal;
    });
  }

  private async lockEarnings(tx: Prisma.TransactionClient, hostId: string) {
    await tx.creatorEarning.upsert({ where: { hostId }, create: { hostId }, update: {} });
    await tx.$executeRaw`SELECT 1 FROM creator_earnings WHERE host_id = ${hostId} FOR UPDATE`;
    return tx.creatorEarning.findUniqueOrThrow({ where: { hostId } });
  }
}
