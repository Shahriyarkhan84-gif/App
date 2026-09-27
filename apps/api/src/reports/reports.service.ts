import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { AiJobsService } from '../ai-jobs/ai-jobs.service';
import { PLATFORM_ADMIN_ROLES } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

const REPORT_RATE_LIMIT = 20;
const REPORT_RATE_WINDOW_MS = 60 * 60_000;

/** Translated from report_content()/dismiss_report() in 20260924030000_moderation_ai.sql. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiJobs: AiJobsService,
  ) {}

  async reportContent(reporterId: string, targetType: 'user' | 'room' | 'message', targetId: string, reason: string) {
    const recent = await this.prisma.report.count({
      where: { reporterId, createdAt: { gt: new Date(Date.now() - REPORT_RATE_WINDOW_MS) } },
    });
    if (recent >= REPORT_RATE_LIMIT) throw new BadRequestException('slow_down');

    const targetUserId = await this.resolveTargetUser(targetType, targetId);
    if (!targetUserId) throw new NotFoundException('not_found');

    const report = await this.prisma.report.create({
      data: { reporterId, targetType, targetId, targetUserId, reason },
    });
    await this.aiJobs.enqueue('moderate_report', { report_id: report.id }, `report:${report.id}`);
    return report;
  }

  async dismissReport(adminRole: string, reportId: string) {
    if (!(PLATFORM_ADMIN_ROLES as string[]).includes(adminRole)) throw new ForbiddenException();
    const updated = await this.prisma.report.updateMany({
      where: { id: reportId, status: { in: ['open', 'reviewing'] } },
      data: { status: 'dismissed' },
    });
    if (updated.count === 0) throw new NotFoundException('not_found');
    return this.prisma.report.findUniqueOrThrow({ where: { id: reportId } });
  }

  listReports(adminRole: string, status?: string) {
    if (!(PLATFORM_ADMIN_ROLES as string[]).includes(adminRole)) throw new ForbiddenException();
    return this.prisma.report.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private async resolveTargetUser(targetType: 'user' | 'room' | 'message', targetId: string): Promise<string | null> {
    if (targetType === 'user') {
      const user = await this.prisma.user.findUnique({ where: { id: targetId } });
      return user?.id ?? null;
    }
    if (targetType === 'room') {
      const room = await this.prisma.room.findUnique({ where: { id: targetId } });
      return room?.hostId ?? null;
    }
    let messageId: bigint;
    try {
      messageId = BigInt(targetId);
    } catch {
      return null;
    }
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    return message?.senderId ?? null;
  }
}
