import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

export type RankingKind = 'gifter' | 'creator' | 'country' | 'live';
export type RankingPeriod = 'day' | 'week' | 'month';

type RankingRow = { rank: bigint; subject_id: string; label: string; avatar_url: string | null; score: bigint };

/** Translated from public.get_rankings() in 20260924030000_moderation_ai.sql. */
@Injectable()
export class RankingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRankings(kind: RankingKind, period: RankingPeriod = 'week') {
    const since = this.periodStart(period);

    switch (kind) {
      case 'gifter':
        return this.prisma.$queryRaw<RankingRow[]>`
          SELECT row_number() OVER (ORDER BY sum(g.coins_total) DESC) AS rank, g.sender_id AS subject_id,
                 coalesce(p.display_name, p.username, 'Viewer') AS label, p.avatar_url,
                 sum(g.coins_total)::bigint AS score
          FROM gifts g JOIN users p ON p.id = g.sender_id
          WHERE g.created_at >= ${since}
          GROUP BY g.sender_id, p.display_name, p.username, p.avatar_url
          ORDER BY score DESC LIMIT 50`;
      case 'creator':
        return this.prisma.$queryRaw<RankingRow[]>`
          SELECT row_number() OVER (ORDER BY sum(g.coins_total) DESC) AS rank, g.host_id AS subject_id,
                 coalesce(p.display_name, p.username, 'Host') AS label, p.avatar_url,
                 sum(g.coins_total)::bigint AS score
          FROM gifts g JOIN users p ON p.id = g.host_id
          WHERE g.created_at >= ${since}
          GROUP BY g.host_id, p.display_name, p.username, p.avatar_url
          ORDER BY score DESC LIMIT 50`;
      case 'country':
        return this.prisma.$queryRaw<RankingRow[]>`
          SELECT row_number() OVER (ORDER BY sum(g.coins_total) DESC) AS rank,
                 coalesce(p.country, '??') AS subject_id, coalesce(p.country, 'Unknown') AS label,
                 NULL::text AS avatar_url, sum(g.coins_total)::bigint AS score
          FROM gifts g JOIN users p ON p.id = g.host_id
          WHERE g.created_at >= ${since}
          GROUP BY p.country
          ORDER BY score DESC LIMIT 50`;
      case 'live':
        return this.prisma.$queryRaw<RankingRow[]>`
          SELECT row_number() OVER (ORDER BY r.viewer_count DESC) AS rank, r.id::text AS subject_id, r.title AS label,
                 p.avatar_url, r.viewer_count::bigint AS score
          FROM rooms r JOIN users p ON p.id = r.host_id
          WHERE r.status = 'live'
          ORDER BY r.viewer_count DESC LIMIT 50`;
      default:
        throw new BadRequestException('invalid_kind');
    }
  }

  private periodStart(period: RankingPeriod): Date {
    const days = period === 'day' ? 1 : period === 'month' ? 30 : 7;
    return new Date(Date.now() - days * 86_400_000);
  }
}
