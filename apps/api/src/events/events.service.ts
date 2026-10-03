import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Event, Prisma } from '@zynalive/database';

import { PLATFORM_ADMIN_ROLES } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RegionsService } from '../regions/regions.service';

export type EventRole = 'host' | 'gifter';
export type EventReward = { role: EventRole; rank_from: number; rank_to: number; reward: string };

export type UpsertEventInput = {
  title: string;
  description?: string | null;
  kind: 'gifting' | 'pk_battle';
  regionCode?: string | null;
  startsAt: Date;
  endsAt: Date;
  giftIds?: number[] | null;
  rewards?: EventReward[];
  publish: boolean;
};

const MAX_DAYS = 62;
const WIN_POINTS = 3n;
const TIE_POINTS = 1n;

/** Mirrors private.validate_event_rewards(). */
export function validRewards(rewards: unknown): rewards is EventReward[] {
  if (!Array.isArray(rewards) || rewards.length > 20) return false;
  return rewards.every(
    (r) =>
      r && (r.role === 'host' || r.role === 'gifter') &&
      Number.isInteger(r.rank_from) && Number.isInteger(r.rank_to) &&
      r.rank_from >= 1 && r.rank_to >= r.rank_from && r.rank_to <= 999 &&
      typeof r.reward === 'string' && r.reward.length >= 1 && r.reward.length <= 120,
  );
}

export function rewardFor(rewards: EventReward[], role: EventRole, rank: number): string | null {
  return rewards.find((r) => r.role === role && rank >= r.rank_from && rank <= r.rank_to)?.reward ?? null;
}

/** Stable ranking: score desc, earliest to reach it first, then user id (same as the SQL). */
export function rankScores<T extends { userId: string; score: bigint; updatedAt: Date }>(rows: T[]): (T & { rank: number })[] {
  return rows
    .filter((r) => r.score > 0n)
    .sort((a, b) => (a.score === b.score ? a.updatedAt.getTime() - b.updatedAt.getTime() || a.userId.localeCompare(b.userId) : a.score > b.score ? -1 : 1))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Engagement events, translated from supabase/migrations/20260925030000_regions_events.sql.
 * Scores are applied from inside the gift and battle transactions
 * (GiftsService.sendGift → applyGift, BattlesService.end → applyBattle),
 * the same effect as the SQL triggers — never from a client request.
 */
@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regions: RegionsService,
  ) {}

  private assertAdmin(role: string) {
    if (!(PLATFORM_ADMIN_ROLES as string[]).includes(role)) throw new ForbiddenException('forbidden');
  }

  async upsert(actorId: string, actorRole: string, id: string | null, input: UpsertEventInput, now = new Date()) {
    this.assertAdmin(actorRole);
    const title = input.title.trim();
    if (title.length < 3 || title.length > 80) throw new BadRequestException('invalid_title');
    if (input.regionCode && !(await this.prisma.region.findUnique({ where: { code: input.regionCode } }))) {
      throw new BadRequestException('invalid_region');
    }
    const rewards = input.rewards ?? [];
    if (!validRewards(rewards)) throw new BadRequestException('invalid_rewards');
    if (input.endsAt <= input.startsAt || input.endsAt <= now) throw new BadRequestException('invalid_schedule');
    if (input.endsAt.getTime() - input.startsAt.getTime() > MAX_DAYS * 86_400_000) throw new BadRequestException('invalid_schedule');
    const giftIds = input.kind === 'gifting' ? input.giftIds ?? [] : [];
    if (giftIds.length) {
      const found = await this.prisma.giftCatalogItem.count({ where: { id: { in: giftIds } } });
      if (found !== new Set(giftIds).size) throw new BadRequestException('invalid_gift');
    }

    const data = {
      title,
      description: input.description?.trim() || null,
      kind: input.kind,
      regionCode: input.regionCode ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      giftIds,
      rewards: rewards as Prisma.InputJsonValue,
    };
    let event: Event;
    if (!id) {
      event = await this.prisma.event.create({ data: { ...data, status: input.publish ? 'scheduled' : 'draft', createdBy: actorId } });
    } else {
      const existing = await this.prisma.event.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('not_found');
      if (existing.status === 'cancelled' || existing.status === 'finalized' || (existing.status === 'scheduled' && existing.startsAt <= now)) {
        throw new BadRequestException('event_locked');
      }
      event = await this.prisma.event.update({ where: { id }, data: { ...data, ...(input.publish ? { status: 'scheduled' } : {}) } });
    }
    await this.audit(actorId, 'event_saved', event.id, { status: event.status, kind: event.kind, region: event.regionCode });
    return event;
  }

  async cancel(actorId: string, actorRole: string, id: string) {
    this.assertAdmin(actorRole);
    const { count } = await this.prisma.event.updateMany({ where: { id, status: { in: ['draft', 'scheduled'] } }, data: { status: 'cancelled' } });
    if (!count) throw new NotFoundException('not_found');
    await this.audit(actorId, 'event_cancelled', id);
    return this.prisma.event.findUniqueOrThrow({ where: { id } });
  }

  /** Published events for the user's region plus global ones. */
  async listFor(userId: string) {
    const region = await this.regions.userRegion(userId);
    return this.prisma.event.findMany({
      where: { status: { in: ['scheduled', 'finalized'] }, OR: [{ regionCode: null }, { regionCode: region }] },
      orderBy: { endsAt: 'desc' },
      take: 50,
    });
  }

  async leaderboard(eventId: string, role: EventRole, limit = 50, viewerRole = 'USER') {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    const isAdmin = (PLATFORM_ADMIN_ROLES as string[]).includes(viewerRole);
    if (!event || (!isAdmin && event.status !== 'scheduled' && event.status !== 'finalized')) throw new NotFoundException('not_found');
    const scores = await this.prisma.eventScore.findMany({ where: { eventId, role }, orderBy: { score: 'desc' }, take: 500 });
    const ranked = rankScores(scores).slice(0, Math.min(Math.max(limit, 1), 100));
    const users = await this.prisma.user.findMany({
      where: { id: { in: ranked.map((r) => r.userId) } },
      select: { id: true, displayName: true, username: true, avatarUrl: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const rewards = event.rewards as EventReward[];
    return ranked.map((r) => ({
      rank: r.rank, userId: r.userId, score: r.score.toString(), reward: rewardFor(rewards, role, r.rank), user: byId.get(r.userId) ?? null,
    }));
  }

  // Scoring (called inside the gift / battle transactions) ------------------------

  private async bump(tx: Prisma.TransactionClient, eventId: string, userId: string, role: EventRole, points: bigint) {
    await tx.eventScore.upsert({
      where: { eventId_role_userId: { eventId, role, userId } },
      create: { eventId, userId, role, score: points },
      update: { score: { increment: points } },
    });
  }

  /** Mirrors private.events_apply_gift(). */
  async applyGift(tx: Prisma.TransactionClient, gift: { hostId: string; senderId: string; giftId: number; coinsTotal: bigint }, now = new Date()) {
    const live = await tx.event.findMany({ where: { status: 'scheduled', kind: 'gifting', startsAt: { lte: now }, endsAt: { gt: now } } });
    if (!live.length) return;
    const hostRegion = await this.regions.userRegion(gift.hostId, tx);
    for (const e of live) {
      if (e.regionCode && e.regionCode !== hostRegion) continue;
      if (e.giftIds.length && !e.giftIds.includes(gift.giftId)) continue;
      await this.bump(tx, e.id, gift.hostId, 'host', gift.coinsTotal);
      await this.bump(tx, e.id, gift.senderId, 'gifter', gift.coinsTotal);
    }
  }

  /** Mirrors private.events_apply_battle(): win 3, tie 1 each. */
  async applyBattle(tx: Prisma.TransactionClient, battle: { startedAt: Date | null; hostA: string; hostB: string; winnerHost: string | null }) {
    if (!battle.startedAt) return;
    const leagues = await tx.event.findMany({
      where: { status: 'scheduled', kind: 'pk_battle', startsAt: { lte: battle.startedAt }, endsAt: { gt: battle.startedAt } },
    });
    for (const e of leagues) {
      const inRegion = async (host: string) => !e.regionCode || (await this.regions.userRegion(host, tx)) === e.regionCode;
      if (battle.winnerHost === null) {
        for (const host of [battle.hostA, battle.hostB]) if (await inRegion(host)) await this.bump(tx, e.id, host, 'host', TIE_POINTS);
      } else if (await inRegion(battle.winnerHost)) {
        await this.bump(tx, e.id, battle.winnerHost, 'host', WIN_POINTS);
      }
    }
  }

  // Finalization ------------------------------------------------------------------

  async finalize(eventId: string, actorId: string | null, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id: eventId } });
      if (!event || event.status !== 'scheduled') throw new BadRequestException('not_finalizable');
      if (event.endsAt > now) throw new BadRequestException('event_not_ended');
      const rewards = event.rewards as EventReward[];
      const results: { eventId: string; role: EventRole; rank: number; userId: string; score: bigint; reward: string | null }[] = [];
      for (const role of ['host', 'gifter'] as const) {
        const scores = await tx.eventScore.findMany({ where: { eventId, role } });
        for (const r of rankScores(scores).slice(0, 100)) {
          results.push({ eventId, role, rank: r.rank, userId: r.userId, score: r.score, reward: rewardFor(rewards, role, r.rank) });
        }
      }
      if (results.length) await tx.eventResult.createMany({ data: results });
      const finalized = await tx.event.update({ where: { id: eventId }, data: { status: 'finalized', finalizedAt: now } });
      const winners = results.filter((r) => r.reward);
      if (winners.length) {
        await tx.notification.createMany({
          data: winners.map((r) => ({
            userId: r.userId, type: 'event_reward', title: event.title,
            body: `You finished #${r.rank} — ${r.reward}`, data: { event_id: event.id, rank: r.rank, role: r.role },
          })),
        });
      }
      await tx.auditLog.create({
        data: { actorId, actorKind: actorId ? 'user' : 'system', action: 'event_finalized', targetType: 'event', targetId: eventId },
      });
      return finalized;
    });
  }

  async finalizeAsAdmin(actorId: string, actorRole: string, eventId: string) {
    this.assertAdmin(actorRole);
    return this.finalize(eventId, actorId);
  }

  /** Worker housekeeping (internal endpoint). */
  async finalizeDue(now = new Date()) {
    const due = await this.prisma.event.findMany({ where: { status: 'scheduled', endsAt: { lte: now } }, orderBy: { endsAt: 'asc' }, take: 50 });
    for (const e of due) await this.finalize(e.id, null, now);
    return { finalized: due.length };
  }

  private audit(actorId: string, action: string, targetId: string, details: Record<string, unknown> = {}) {
    return this.prisma.auditLog.create({ data: { actorId, action, targetType: 'event', targetId, details: details as Prisma.InputJsonValue } });
  }
}
