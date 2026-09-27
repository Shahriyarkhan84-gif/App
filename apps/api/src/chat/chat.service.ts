import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

const ROOM_MESSAGE_MAX = 300;
const DM_MAX = 1000;

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async sendRoomMessage(senderId: string, roomId: string, body: string) {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > ROOM_MESSAGE_MAX) throw new BadRequestException('Invalid message');

    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new BadRequestException('Room not found');

    return this.prisma.message.create({
      data: { roomId, streamId: room.currentStreamId, senderId, body: trimmed },
      include: { sender: { select: { id: true, displayName: true, username: true, avatarUrl: true } } },
    });
  }

  async sendDirectMessage(senderId: string, recipientId: string, body: string) {
    if (senderId === recipientId) throw new BadRequestException("Can't message yourself");
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > DM_MAX) throw new BadRequestException('Invalid message');

    return this.prisma.directMessage.create({
      data: { senderId, recipientId, body: trimmed },
    });
  }

  roomHistory(roomId: string, take = 50) {
    return this.prisma.message.findMany({
      where: { roomId, status: 'visible' },
      orderBy: { createdAt: 'desc' },
      take,
      include: { sender: { select: { id: true, displayName: true, username: true, avatarUrl: true } } },
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
}
