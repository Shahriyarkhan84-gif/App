import { Injectable } from '@nestjs/common';

import { AiJobsService } from '../ai-jobs/ai-jobs.service';
import { PrismaService } from '../prisma/prisma.service';

/** Translated from create_support_ticket() in 20260924030000_moderation_ai.sql. */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiJobs: AiJobsService,
  ) {}

  async createTicket(userId: string, subject: string, body: string) {
    const ticket = await this.prisma.supportTicket.create({ data: { userId, subject, body } });
    await this.aiJobs.enqueue('support_ticket', { ticket_id: ticket.id }, `ticket:${ticket.id}`);
    return ticket;
  }

  myTickets(userId: string) {
    return this.prisma.supportTicket.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }
}
