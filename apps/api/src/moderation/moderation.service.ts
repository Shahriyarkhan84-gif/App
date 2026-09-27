import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@zynalive/database';

import { PLATFORM_ADMIN_ROLES } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

type ModerationActionType =
  | 'warning'
  | 'temp_restriction'
  | 'temp_ban'
  | 'permanent_ban'
  | 'content_removal'
  | 'account_review';
type ModerationSource = 'admin' | 'ai' | 'system' | 'room_admin';

const STAFF_ROLES = ['OWNER_ADMIN', 'SUPER_ADMIN'];

/**
 * Translated from the moderation core + AI system sections of
 * supabase/migrations/20260924030000_moderation_ai.sql. `internal*` methods
 * are only reachable through InternalAuthGuard-protected routes — the AI
 * worker calls them, not end users.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Admin-initiated action — the only source allowed to touch staff accounts. */
  async applyModerationAction(
    adminId: string,
    adminRole: string,
    targetUserId: string,
    action: ModerationActionType,
    reason: string,
    hours: number | null,
    reportId: string | null,
  ) {
    if (!(PLATFORM_ADMIN_ROLES as string[]).includes(adminRole)) throw new ForbiddenException();
    return this.applyModeration(targetUserId, action, reason, hours, 'admin', reportId, adminId);
  }

  /** Used by the AI worker for low-impact automatic actions only. */
  async internalAiModeration(targetUserId: string, action: 'warning' | 'content_removal', reason: string, reportId: string | null) {
    return this.applyModeration(targetUserId, action, reason, null, 'ai', reportId, null);
  }

  async internalHideMessage(messageId: bigint, moderation: Record<string, unknown>) {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: 'hidden', moderation: moderation as Prisma.InputJsonValue },
    });
  }

  /** Owner approves/rejects a proposal; execution is a separate step (internalExecuteAiAction). */
  async reviewAiAction(reviewerId: string, reviewerRole: string, actionId: bigint, approve: boolean) {
    if (!(PLATFORM_ADMIN_ROLES as string[]).includes(reviewerRole)) throw new ForbiddenException();

    const updated = await this.prisma.aiAction.updateMany({
      where: { id: actionId, status: 'proposed' },
      data: { status: approve ? 'approved' : 'rejected', reviewedBy: reviewerId },
    });
    if (updated.count === 0) throw new NotFoundException('not_found');
    return this.prisma.aiAction.findUniqueOrThrow({ where: { id: actionId } });
  }

  /** Executes an owner-approved AI proposal — called by the worker after review_ai_action. */
  async internalExecuteAiAction(actionId: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const action = await tx.aiAction.findFirst({ where: { id: actionId, status: 'approved' } });
      if (!action) throw new BadRequestException('not_approved');

      if (['warning', 'temp_restriction', 'temp_ban', 'permanent_ban', 'account_review'].includes(action.actionType)) {
        const hours = (action.params as { hours?: number } | null)?.hours ?? null;
        await this.applyModeration(
          action.targetUserId!,
          action.actionType as ModerationActionType,
          action.rationale,
          hours,
          'ai',
          null,
          null,
          tx,
        );
      } else if (action.actionType === 'freeze_wallet' || action.actionType === 'unfreeze_wallet') {
        await tx.wallet.upsert({
          where: { userId: action.targetUserId! },
          create: { userId: action.targetUserId!, frozen: action.actionType === 'freeze_wallet' },
          update: { frozen: action.actionType === 'freeze_wallet' },
        });
      }

      return tx.aiAction.update({ where: { id: action.id }, data: { status: 'executed' } });
    });
  }

  /** The AI worker proposes a high-impact action; it never executes on its own. */
  async proposeAiAction(
    agent: string,
    actionType: string,
    targetUserId: string | null,
    rationale: string,
    confidence: number | null,
    params: Record<string, unknown>,
  ) {
    return this.prisma.aiAction.create({
      data: { agent, actionType, targetUserId, rationale, confidence, params: params as Prisma.InputJsonValue },
    });
  }

  /** Mirrors private.apply_moderation(): the one place every action (admin or AI) funnels through. */
  private async applyModeration(
    targetUserId: string,
    action: ModerationActionType,
    reason: string,
    hours: number | null,
    source: ModerationSource,
    reportId: string | null,
    actorId: string | null,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;

    let expiresAt: Date | null = null;
    if (action === 'temp_restriction' || action === 'temp_ban') {
      if (!hours || hours < 1 || hours > 24 * 90) throw new BadRequestException('invalid_duration');
      expiresAt = new Date(Date.now() + hours * 3600_000);
    }

    const target = await client.user.findUniqueOrThrow({ where: { id: targetUserId } });
    if (STAFF_ROLES.includes(target.role) && source !== 'admin') throw new ForbiddenException('protected_account');

    const moderationAction = await client.moderationAction.create({
      data: { targetUserId, action, reason, expiresAt, actorId, source, reportId },
    });

    if (action === 'temp_restriction') {
      await client.user.updateMany({ where: { id: targetUserId, status: { not: 'banned' } }, data: { status: 'restricted', statusUntil: expiresAt } });
    } else if (action === 'temp_ban') {
      await client.user.update({ where: { id: targetUserId }, data: { status: 'banned', statusUntil: expiresAt } });
    } else if (action === 'permanent_ban') {
      await client.user.update({ where: { id: targetUserId }, data: { status: 'banned', statusUntil: null } });
    }
    if (action === 'temp_ban' || action === 'permanent_ban') {
      await client.room.updateMany({ where: { hostId: targetUserId, status: 'live' }, data: { status: 'offline', viewerCount: 0 } });
    }
    if (reportId) {
      await client.report.updateMany({ where: { id: reportId }, data: { status: 'actioned' } });
    }

    const notification = await client.notification.create({
      data: {
        userId: targetUserId,
        type: 'moderation',
        title: `Account notice: ${action.replace(/_/g, ' ')}`,
        body: reason,
      },
    });
    this.realtime.emitToUser(targetUserId, 'notification:new', notification);

    return moderationAction;
  }
}
