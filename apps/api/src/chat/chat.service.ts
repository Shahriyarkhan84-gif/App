import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import { AiJobsService } from '../ai-jobs/ai-jobs.service';
import { PrismaService } from '../prisma/prisma.service';

const ROOM_MESSAGE_MAX = 300;
const DM_MAX = 1000;
const ROOM_MESSAGE_RATE_LIMIT = 5;
const ROOM_MESSAGE_RATE_WINDOW_MS = 10_000;
const DUPLICATE_WINDOW_MS = 30_000;
const DM_RATE_LIMIT = 20;
const DM_RATE_WINDOW_MS = 60_000;

const SENDER_SELECT = { id: true, displayName: true, username: true, avatarUrl: true } as const;

/**
 * Translated from send_chat_message()/send_direct_message()/
 * private.filter_text() in supabase/migrations/20260924030000_moderation_ai.sql.
 * The Phase 4 version of this file skipped all of this — anti-spam,
 * duplicate detection, the word filter and the AI moderation job were
 * missing entirely. This closes that gap.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiJobs: AiJobsService,
  ) {}

  async sendRoomMessage(senderId: string, roomId: string, body: string) {
    const sender = await this.prisma.user.findUniqueOrThrow({ where: { id: senderId } });
    if (sender.status !== 'active') throw new ForbiddenException('account_restricted');

    const trimmed = body.trim();
    if (!trimmed || trimmed.length > ROOM_MESSAGE_MAX) throw new BadRequestException('invalid_length');

    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.status !== 'live') throw new BadRequestException('room_not_live');

    // Any active ban (mute/kick/block) silences chat, not just a mute.
    const banned = await this.prisma.roomBan.findFirst({
      where: { roomId, userId: senderId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    if (banned) throw new ForbiddenException('muted_in_room');

    const recentCount = await this.prisma.message.count({
      where: { senderId, createdAt: { gt: new Date(Date.now() - ROOM_MESSAGE_RATE_WINDOW_MS) } },
    });
    if (recentCount >= ROOM_MESSAGE_RATE_LIMIT) throw new BadRequestException('slow_down');

    const duplicate = await this.prisma.message.findFirst({
      where: { senderId, roomId, body: trimmed, createdAt: { gt: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
    });
    if (duplicate) throw new BadRequestException('duplicate_message');

    const filtered = await this.filterText(trimmed);
    const message = await this.prisma.message.create({
      data: { roomId, streamId: room.currentStreamId, senderId, body: filtered },
      include: { sender: { select: SENDER_SELECT } },
    });

    const moderationSetting = await this.prisma.platformSetting.findUnique({ where: { key: 'ai_moderation' } });
    if ((moderationSetting?.value as { mode?: string } | undefined)?.mode === 'all') {
      await this.aiJobs.enqueue('moderate_message', { message_id: message.id.toString() }, `msg:${message.id}`);
    }

    return message;
  }

  async sendDirectMessage(senderId: string, recipientId: string, body: string) {
    if (senderId === recipientId) throw new BadRequestException("Can't message yourself");

    const sender = await this.prisma.user.findUniqueOrThrow({ where: { id: senderId } });
    if (sender.status !== 'active') throw new ForbiddenException('account_restricted');

    const trimmed = body.trim();
    if (!trimmed || trimmed.length > DM_MAX) throw new BadRequestException('invalid_length');

    const blocked = await this.prisma.userBlock.findUnique({
      where: { blockerId_blockedId: { blockerId: recipientId, blockedId: senderId } },
    });
    if (blocked) throw new ForbiddenException('blocked');

    const recentCount = await this.prisma.directMessage.count({
      where: { senderId, createdAt: { gt: new Date(Date.now() - DM_RATE_WINDOW_MS) } },
    });
    if (recentCount >= DM_RATE_LIMIT) throw new BadRequestException('slow_down');

    const filtered = await this.filterText(trimmed);
    return this.prisma.directMessage.create({ data: { senderId, recipientId, body: filtered } });
  }

  roomHistory(roomId: string, take = 50) {
    return this.prisma.message.findMany({
      where: { roomId, status: 'visible' },
      orderBy: { createdAt: 'desc' },
      take,
      include: { sender: { select: SENDER_SELECT } },
    });
  }

  dmThread(userId: string, otherUserId: string, take = 50) {
    return this.prisma.directMessage.findMany({
      where: {
        OR: [
          { senderId: userId, recipientId: otherUserId },
          { senderId: otherUserId, recipientId: userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** Mirrors private.filter_text(): mask/block terms from the word_filters table. */
  private async filterText(body: string): Promise<string> {
    const filters = await this.prisma.wordFilter.findMany();
    let result = body;
    for (const filter of filters) {
      const pattern = new RegExp(this.escapeRegExp(filter.term), 'gi');
      if (!pattern.test(result)) continue;
      if (filter.action === 'block') throw new BadRequestException('message_blocked');
      result = result.replace(new RegExp(this.escapeRegExp(filter.term), 'gi'), '*'.repeat(filter.term.length));
    }
    return result;
  }

  private escapeRegExp(term: string): string {
    return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
