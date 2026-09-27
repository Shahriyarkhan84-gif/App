import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Reads user_recommendations (20260924030000_moderation_ai.sql) — the
 * scores themselves are computed by the AI worker's 'recommendations' job,
 * not by this API; this is just the read surface for the app.
 */
@Injectable()
export class RecommendationsService {
  constructor(private readonly prisma: PrismaService) {}

  // Same whitelist-only rule as StreamsService.listLive(): never
  // `include: { user: true }` here — it would leak the recommended host's
  // passwordHash/refreshTokenHash/twoFactorSecret/email/phone to the caller.
  forUser(userId: string, take = 20) {
    return this.prisma.userRecommendation.findMany({
      where: { userId },
      orderBy: { score: 'desc' },
      take,
      include: {
        room: {
          include: {
            host: {
              select: {
                userId: true,
                hostCode: true,
                user: { select: { id: true, username: true, displayName: true, avatarUrl: true, country: true, role: true } },
              },
            },
          },
        },
      },
    });
  }
}
