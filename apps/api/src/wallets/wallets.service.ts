import { Injectable } from '@nestjs/common';
import type { Prisma } from '@zynalive/database';

import { PrismaService } from '../prisma/prisma.service';

export type CoinTxnKind = 'purchase' | 'gift_sent' | 'refund' | 'chargeback' | 'adjustment';

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mirrors private.lock_wallet(): creates the wallet row if missing, then
   * takes a Postgres row lock on it for the rest of the transaction so
   * concurrent spends by the same user serialize instead of racing.
   * Prisma's typed API has no SELECT ... FOR UPDATE, so this drops to raw
   * SQL for the lock only, then reads the row back through the typed API
   * (safe: it's still inside the same transaction, so the lock already
   * held prevents any concurrent writer from changing it in between).
   */
  async lockWallet(tx: Prisma.TransactionClient, userId: string) {
    await tx.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
    await tx.$executeRaw`SELECT 1 FROM wallets WHERE user_id = ${userId} FOR UPDATE`;
    return tx.wallet.findUniqueOrThrow({ where: { userId } });
  }

  /**
   * Mirrors private.apply_coin_delta(): applies a ledgered balance change.
   * Callers MUST already hold the row lock from lockWallet() in the same
   * transaction and MUST have already checked the balance covers a debit —
   * unlike the original Postgres schema, Prisma's schema.prisma has no
   * CHECK constraint syntax, so `coin_balance >= 0` is not enforced at the
   * DB level here; the row lock plus the caller's pre-check are the only
   * safety net against a concurrent overdraw.
   */
  async applyCoinDelta(
    tx: Prisma.TransactionClient,
    userId: string,
    delta: bigint,
    kind: CoinTxnKind,
    refType: string | null,
    refId: string | null,
    idempotencyKey: string,
  ): Promise<bigint> {
    const wallet = await tx.wallet.update({
      where: { userId },
      data: { coinBalance: { increment: delta } },
    });
    await tx.coinTransaction.create({
      data: { userId, delta, balanceAfter: wallet.coinBalance, kind, refType, refId, idempotencyKey },
    });
    return wallet.coinBalance;
  }

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
    const recentTransactions = await this.prisma.coinTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { ...wallet, recentTransactions };
  }
}
