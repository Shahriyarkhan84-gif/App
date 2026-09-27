import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { GoLiveDto } from './dto/go-live.dto';

@Injectable()
export class StreamsService {
  constructor(private readonly prisma: PrismaService) {}

  // Live-room grid: mirrors `rooms` ordered by viewer count in the current app.
  listLive() {
    return this.prisma.room.findMany({
      where: { status: 'live' },
      orderBy: { viewerCount: 'desc' },
      include: { host: { include: { user: true } } },
    });
  }

  async goLive(hostUserId: string, dto: GoLiveDto) {
    const host = await this.prisma.host.findUnique({ where: { userId: hostUserId } });
    if (!host) throw new ForbiddenException('Only hosts can go live');

    const room = await this.prisma.room.upsert({
      where: { hostId: hostUserId },
      create: { hostId: hostUserId, title: dto.title, category: dto.category, status: 'live' },
      update: { title: dto.title, category: dto.category, status: 'live' },
    });

    // Amazon IVS channel provisioning is a Phase 3 item (see docs/MIGRATION_PLAN.md);
    // room.ivsChannelArn / ivsPlaybackUrl stay null until that lands.
    const stream = await this.prisma.stream.create({
      data: { roomId: room.id, hostId: hostUserId, title: dto.title },
    });
    await this.prisma.room.update({ where: { id: room.id }, data: { currentStreamId: stream.id } });

    return { room, stream };
  }

  async endStream(hostUserId: string) {
    const room = await this.prisma.room.findUnique({ where: { hostId: hostUserId } });
    if (!room?.currentStreamId) throw new BadRequestException('Not currently live');

    const [stream] = await this.prisma.$transaction([
      this.prisma.stream.update({
        where: { id: room.currentStreamId },
        data: { endedAt: new Date() },
      }),
      this.prisma.room.update({
        where: { id: room.id },
        data: { status: 'offline', currentStreamId: null, viewerCount: 0 },
      }),
    ]);
    return stream;
  }
}
