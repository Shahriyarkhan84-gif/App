import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@zynalive/database';

import { PLATFORM_ADMIN_ROLES } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_BATTLE_DURATION_SECONDS = 180;

/**
 * Translated from supabase/migrations/20260924200000_pk_battles.sql
 * (invite_pk_battle / respond_pk_battle / end_pk_battle). Each host keeps
 * streaming to their own IVS channel — no channel merge; the app plays both
 * playback URLs side by side while a battle is live. The SQL's score trigger
 * on `gifts` becomes GiftsService calling applyGiftScore() once the gift-send
 * flow lands in Phase 5 (see docs/MIGRATION_PLAN.md) — the column and the
 * increment logic are ready for it below.
 */
@Injectable()
export class BattlesService {
  constructor(private readonly prisma: PrismaService) {}

  async invite(challengerUserId: string, targetRoomId: string) {
    const myRoom = await this.prisma.room.findUnique({ where: { hostId: challengerUserId } });
    if (!myRoom || myRoom.status !== 'live') throw new BadRequestException('You must be live to start a battle');
    if (myRoom.currentBattleId) throw new BadRequestException('Already in a battle');

    const target = await this.prisma.room.findUnique({ where: { id: targetRoomId } });
    if (!target || target.status !== 'live') throw new BadRequestException('Target is not live');
    if (target.hostId === challengerUserId) throw new BadRequestException("Can't battle yourself");
    if (target.currentBattleId) throw new BadRequestException('Target is already in a battle');

    const battle = await this.prisma.$transaction(async (tx) => {
      const created = await tx.pkBattle.create({ data: { roomAId: myRoom.id, roomBId: target.id } });
      await tx.room.updateMany({
        where: { id: { in: [myRoom.id, target.id] } },
        data: { currentBattleId: created.id },
      });
      return created;
    });

    await this.notify(target.hostId, 'pk_battle_invite', 'PK battle invite', 'A host wants to battle you live.', {
      battle_id: battle.id,
      room_id: myRoom.id,
    });
    return battle;
  }

  async respond(userId: string, battleId: string, accept: boolean) {
    const battle = await this.prisma.pkBattle.findUnique({ where: { id: battleId } });
    if (!battle || battle.status !== 'invited') throw new BadRequestException('Not invitable');

    const [roomA, roomB] = await Promise.all([
      this.prisma.room.findUniqueOrThrow({ where: { id: battle.roomAId } }),
      this.prisma.room.findUniqueOrThrow({ where: { id: battle.roomBId } }),
    ]);
    const isChallenger = roomA.hostId === userId;
    if (roomB.hostId !== userId && !isChallenger) throw new ForbiddenException();
    if (isChallenger && accept) throw new ForbiddenException('Only the challenged host can accept');

    if (accept) {
      const durationSeconds = await this.battleDurationSeconds();
      const updated = await this.prisma.pkBattle.update({
        where: { id: battleId },
        data: {
          status: 'live',
          startedAt: new Date(),
          endsAt: new Date(Date.now() + durationSeconds * 1000),
        },
      });
      await this.notify(roomA.hostId, 'pk_battle_accepted', 'Battle accepted', 'Your PK battle is live.', {
        battle_id: updated.id,
      });
      return updated;
    }

    const status = isChallenger ? 'cancelled' : 'declined';
    const [updated] = await this.prisma.$transaction([
      this.prisma.pkBattle.update({ where: { id: battleId }, data: { status } }),
      this.prisma.room.updateMany({
        where: { id: { in: [battle.roomAId, battle.roomBId] } },
        data: { currentBattleId: null },
      }),
    ]);
    await this.notify(
      isChallenger ? roomB.hostId : roomA.hostId,
      `pk_battle_${status}`,
      status === 'cancelled' ? 'Cancelled battle' : 'Declined battle',
      null,
      { battle_id: updated.id },
    );
    return updated;
  }

  async end(userId: string, role: string, battleId: string) {
    const battle = await this.prisma.pkBattle.findUnique({ where: { id: battleId } });
    if (!battle || battle.status !== 'live') throw new BadRequestException('Not live');

    const [roomA, roomB] = await Promise.all([
      this.prisma.room.findUniqueOrThrow({ where: { id: battle.roomAId } }),
      this.prisma.room.findUniqueOrThrow({ where: { id: battle.roomBId } }),
    ]);
    const isAdmin = (PLATFORM_ADMIN_ROLES as string[]).includes(role);
    const isParticipant = userId === roomA.hostId || userId === roomB.hostId;
    if (battle.endsAt && battle.endsAt > new Date() && !isParticipant && !isAdmin) {
      throw new ForbiddenException();
    }

    const winnerRoomId =
      battle.scoreA === battle.scoreB ? null : battle.scoreA > battle.scoreB ? battle.roomAId : battle.roomBId;
    const [updated] = await this.prisma.$transaction([
      this.prisma.pkBattle.update({
        where: { id: battleId },
        data: { status: 'ended', endedAt: new Date(), winnerRoomId },
      }),
      this.prisma.room.updateMany({
        where: { id: { in: [battle.roomAId, battle.roomBId] } },
        data: { currentBattleId: null },
      }),
    ]);

    await Promise.all([
      this.notify(roomA.hostId, 'pk_battle_ended', 'Battle ended', this.resultMessage(winnerRoomId, battle.roomAId), {
        battle_id: updated.id,
      }),
      this.notify(roomB.hostId, 'pk_battle_ended', 'Battle ended', this.resultMessage(winnerRoomId, battle.roomBId), {
        battle_id: updated.id,
      }),
    ]);
    return updated;
  }

  /** Called by the gift-send flow (Phase 5) to keep score live, same as the SQL trigger. */
  async applyGiftScore(roomId: string, coinsTotal: bigint, tx: Prisma.TransactionClient = this.prisma) {
    const room = await tx.room.findUnique({ where: { id: roomId } });
    if (!room?.currentBattleId) return;
    const battle = await tx.pkBattle.findFirst({ where: { id: room.currentBattleId, status: 'live' } });
    if (!battle) return;

    const field = room.id === battle.roomAId ? 'scoreA' : 'scoreB';
    await tx.pkBattle.update({ where: { id: battle.id }, data: { [field]: { increment: coinsTotal } } });
  }

  private resultMessage(winnerRoomId: string | null, myRoomId: string): string {
    if (winnerRoomId === null) return "It's a tie.";
    return winnerRoomId === myRoomId ? 'You won!' : 'You lost this one.';
  }

  private async battleDurationSeconds(): Promise<number> {
    const setting = await this.prisma.platformSetting.findUnique({ where: { key: 'pk_battle' } });
    const value = setting?.value as { duration_seconds?: number } | undefined;
    return value?.duration_seconds ?? DEFAULT_BATTLE_DURATION_SECONDS;
  }

  private async notify(userId: string, type: string, title: string, body: string | null, data: Record<string, unknown>) {
    await this.prisma.notification.create({ data: { userId, type, title, body, data: data as Prisma.InputJsonValue } });
  }
}
