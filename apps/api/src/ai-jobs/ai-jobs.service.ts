import { Injectable } from '@nestjs/common';
import { Prisma } from '@zynalive/database';

import { PrismaService } from '../prisma/prisma.service';

export type AiJobKind =
  | 'moderate_message'
  | 'moderate_report'
  | 'fraud_review'
  | 'fraud_sweep'
  | 'support_ticket'
  | 'creator_assist'
  | 'translate_message'
  | 'recommendations'
  | 'ceo_briefing'
  | 'media_process'
  | 'media_subtitles';

/**
 * Mirrors private.enqueue_ai_job(): a Postgres-backed job queue consumed by
 * the LangGraph worker in agents/. dedupeKey mirrors the SQL's
 * `on conflict (dedupe_key) do nothing` — enqueuing the same job twice
 * (e.g. two chat messages racing the same moderation job) is a no-op.
 */
@Injectable()
export class AiJobsService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(kind: AiJobKind, payload: Record<string, unknown>, dedupeKey?: string, runAfter?: Date, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    try {
      return await client.aiJob.create({
        data: { kind, payload: payload as Prisma.InputJsonValue, dedupeKey, runAfter: runAfter ?? new Date() },
      });
    } catch (err) {
      // Matches `on conflict (dedupe_key) do nothing`: a duplicate dedupeKey
      // means an equivalent job is already queued, not a real failure.
      if (dedupeKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return client.aiJob.findUniqueOrThrow({ where: { dedupeKey } });
      }
      throw err;
    }
  }
}
