import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@zynalive/database';

import { PLATFORM_ADMIN_ROLES } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';

/**
 * Translated from the payments section of
 * supabase/migrations/20260924020000_economy.sql
 * (internal_create_payment / internal_credit_payment /
 * internal_refund_payment / internal_dispute_payment / request_refund /
 * review_refund). Coins are credited ONLY from creditPayment(), which the
 * webhook controller calls only after verifying the Stripe signature — the
 * client never gets a path to mark its own payment paid.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
  ) {}

  listPackages() {
    return this.prisma.coinPackage.findMany({ where: { active: true }, orderBy: { sort: 'asc' } });
  }

  async createPayment(userId: string, packageId: number) {
    const pkg = await this.prisma.coinPackage.findFirst({ where: { id: packageId, active: true } });
    if (!pkg) throw new BadRequestException('invalid_package');

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status === 'banned') throw new ForbiddenException('account_restricted');

    return this.prisma.payment.create({
      data: { userId, packageId: pkg.id, coins: pkg.coins, amountMinor: pkg.priceMinor, currency: pkg.currency },
    });
  }

  async attachPaymentRef(paymentId: string, providerRef: string) {
    await this.prisma.payment.updateMany({
      where: { id: paymentId, providerRef: null },
      data: { providerRef },
    });
  }

  /**
   * Credits coins for a verified, paid Checkout Session. Idempotent: a
   * replayed webhook for an already-processed payment changes nothing and
   * reports credited: false.
   */
  async creditPayment(providerRef: string, paymentIntent: string, amountMinor: bigint, currency: string) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPaymentByRef(tx, providerRef);
      if (!payment) throw new NotFoundException('unknown_payment');
      if (payment.status !== 'pending') {
        return { credited: false, reason: 'already_processed', status: payment.status };
      }
      if (payment.amountMinor !== amountMinor || payment.currency.toLowerCase() !== currency.toLowerCase()) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
        return { credited: false, reason: 'amount_mismatch' };
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'paid', paidAt: new Date(), providerPaymentRef: paymentIntent },
      });
      await this.wallets.lockWallet(tx, payment.userId);
      const balance = await this.wallets.applyCoinDelta(
        tx,
        payment.userId,
        payment.coins,
        'purchase',
        'payment',
        payment.id,
        `payment:${payment.id}`,
      );

      await this.recordPurchaseLedger(tx, payment);
      await tx.notification.create({
        data: {
          userId: payment.userId,
          type: 'coins_credited',
          title: 'Coins added',
          body: `${payment.coins} coins were added to your wallet.`,
          data: { payment_id: payment.id },
        },
      });

      return { credited: true, coins: payment.coins, balance };
    });
  }

  /** Money path: agency margin -> platform -> coin reserve / internal -> LiveKit / owner. */
  private async recordPurchaseLedger(tx: Prisma.TransactionClient, payment: { id: string; amountMinor: bigint; currency: string; agencyId: string | null }) {
    const setting = await tx.platformSetting.findUnique({ where: { key: 'purchase_split' } });
    const split = (setting?.value ?? {}) as {
      agency_margin_bps?: number;
      coin_reserve_bps_of_platform?: number;
      livekit_bps_of_internal?: number;
    };
    const agencyBps = BigInt(split.agency_margin_bps ?? 0);
    const reserveBps = BigInt(split.coin_reserve_bps_of_platform ?? 0);
    const internalBps = BigInt(split.livekit_bps_of_internal ?? 0);

    const agency = payment.agencyId ? (payment.amountMinor * agencyBps) / 10000n : 0n;
    const platform = payment.amountMinor - agency;
    const reserve = (platform * reserveBps) / 10000n;
    const internal = platform - reserve;
    const livekit = (internal * internalBps) / 10000n;
    const ownerRevenue = internal - livekit;

    const rows: { bucket: string; amount: bigint }[] = [
      { bucket: 'agency_margin', amount: agency },
      { bucket: 'coin_reserve', amount: reserve },
      { bucket: 'livekit_reserve', amount: livekit },
      { bucket: 'owner_revenue', amount: ownerRevenue },
    ].filter((r) => r.amount !== 0n);

    for (const row of rows) {
      await tx.platformLedger.create({
        data: { bucket: row.bucket, unit: 'minor', currency: payment.currency, amount: row.amount, refType: 'payment', refId: payment.id },
      });
    }
  }

  async refundPayment(paymentIntent: string) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPaymentByIntent(tx, paymentIntent);
      if (!payment) throw new NotFoundException('unknown_payment');
      if (payment.status === 'refunded') return { reversed: false, reason: 'already_refunded' };
      if (payment.status !== 'paid' && payment.status !== 'disputed') {
        return { reversed: false, reason: payment.status };
      }
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'refunded' } });
      const shortfall = await this.reversePaymentCoins(tx, payment, 'refund');
      return { reversed: true, shortfall: shortfall.toString() };
    });
  }

  /** stage: 'opened' freezes the wallet during the dispute; 'won' unfreezes; 'lost' reverses coins and flags the account. */
  async disputePayment(paymentIntent: string, stage: 'opened' | 'won' | 'lost') {
    return this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPaymentByIntent(tx, paymentIntent);
      if (!payment) throw new NotFoundException('unknown_payment');

      if (stage === 'opened') {
        if (payment.status !== 'paid') return { changed: false, status: payment.status };
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'disputed' } });
        await this.wallets.lockWallet(tx, payment.userId);
        await tx.wallet.update({ where: { userId: payment.userId }, data: { frozen: true } });
        return { changed: true, status: stage };
      }

      if (stage === 'won') {
        if (payment.status !== 'disputed') return { changed: false, status: payment.status };
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'paid' } });
        const stillDisputed = await tx.payment.findFirst({ where: { userId: payment.userId, status: 'disputed' } });
        if (!stillDisputed) {
          await tx.wallet.update({ where: { userId: payment.userId }, data: { frozen: false } });
        }
        return { changed: true, status: stage };
      }

      // lost
      if (payment.status !== 'disputed') return { changed: false, status: payment.status };
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'dispute_lost' } });
      await this.reversePaymentCoins(tx, payment, 'chargeback');
      await tx.platformLedger.create({
        data: { bucket: 'chargeback_loss', unit: 'minor', currency: payment.currency, amount: -payment.amountMinor, refType: 'payment', refId: payment.id },
      });
      return { changed: true, status: stage };
    });
  }

  /** Reverses up to the purchased coins; any shortfall is absorbed by the platform and flags the account. */
  private async reversePaymentCoins(
    tx: Prisma.TransactionClient,
    payment: { id: string; userId: string; coins: bigint },
    kind: 'refund' | 'chargeback',
  ): Promise<bigint> {
    const wallet = await this.wallets.lockWallet(tx, payment.userId);
    const debit = wallet.coinBalance < payment.coins ? wallet.coinBalance : payment.coins;
    if (debit > 0n) {
      await this.wallets.applyCoinDelta(tx, payment.userId, -debit, kind, 'payment', payment.id, `${kind}:${payment.id}`);
    }
    const shortfall = payment.coins - debit;
    if (shortfall > 0n) {
      await tx.platformLedger.create({
        data: { bucket: `${kind}_shortfall`, unit: 'coins', amount: -shortfall, refType: 'payment', refId: payment.id },
      });
      await tx.moderationAction.create({
        data: {
          targetUserId: payment.userId,
          action: 'account_review',
          reason: `${kind}: ${shortfall} coins already spent`,
          source: 'system',
        },
      });
    }
    return shortfall;
  }

  async requestRefund(userId: string, paymentId: string, reason: string) {
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, userId, status: 'paid' } });
    if (!payment) throw new BadRequestException('payment_not_refundable');
    return this.prisma.refundRequest.create({ data: { paymentId, userId, reason } });
  }

  async reviewRefund(reviewerId: string, reviewerRole: string, requestId: string, approve: boolean) {
    if (!(PLATFORM_ADMIN_ROLES as string[]).includes(reviewerRole)) throw new ForbiddenException();

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.refundRequest.findFirst({ where: { id: requestId, status: 'requested' } });
      if (!request) throw new NotFoundException('not_found');

      if (approve) {
        const payment = await this.lockPaymentById(tx, request.paymentId);
        if (payment?.status === 'paid') {
          await tx.payment.update({ where: { id: payment.id }, data: { status: 'refunded' } });
          await this.reversePaymentCoins(tx, payment, 'refund');
        }
      }

      const updated = await tx.refundRequest.update({
        where: { id: requestId },
        data: { status: approve ? 'approved' : 'denied', reviewedBy: reviewerId },
      });
      await tx.notification.create({
        data: {
          userId: updated.userId,
          type: 'refund',
          title: `Refund ${updated.status}`,
          data: { payment_id: updated.paymentId },
        },
      });
      return updated;
    });
  }

  private async lockPaymentByRef(tx: Prisma.TransactionClient, providerRef: string) {
    const row = await tx.payment.findUnique({ where: { provider_providerRef: { provider: 'stripe', providerRef } } });
    return this.lockPaymentRow(tx, row);
  }

  private async lockPaymentByIntent(tx: Prisma.TransactionClient, providerPaymentRef: string) {
    const row = await tx.payment.findFirst({ where: { providerPaymentRef } });
    return this.lockPaymentRow(tx, row);
  }

  private async lockPaymentById(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.payment.findUnique({ where: { id } });
    return this.lockPaymentRow(tx, row);
  }

  /** Row-locks a payment already located by a non-locking read, same pattern as WalletsService.lockWallet(). */
  private async lockPaymentRow(tx: Prisma.TransactionClient, row: { id: string } | null) {
    if (!row) return null;
    await tx.$executeRaw`SELECT 1 FROM payments WHERE id = ${row.id} FOR UPDATE`;
    return tx.payment.findUniqueOrThrow({ where: { id: row.id } });
  }
}
