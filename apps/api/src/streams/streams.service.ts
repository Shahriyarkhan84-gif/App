import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import { IvsService } from '../ivs/ivs.service';
import { PrismaService } from '../prisma/prisma.service';
import type { GoLiveDto } from './dto/go-live.dto';

@Injectable()
export class StreamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ivs: IvsService,
  ) {}

  // Live-room grid: mirrors `rooms` ordered by viewer count in the current app.
  listLive() {
    return this.prisma.room.findMany({
      where: { status: 'live' },
      orderBy: { viewerCount: 'desc' },
      include: { host: { include: { user: true } } },
    });
  }

  async goLive(hostUserId: string, dto: GoLiveDto) {
    const room = await this.prisma.room.findUnique({ where: { hostId: hostUserId } });
    if (!room) throw new ForbiddenException('Only hosts can go live — call POST /hosts/become first');
    if (!room.ivsChannelArn) {
      // Shouldn't happen for a host created after Phase 3 landed; older/manual
      // rows may lack a channel until they re-run POST /hosts/become.
      throw new BadRequestException('No streaming channel provisioned for this host');
    }

    const updatedRoom = await this.prisma.room.update({
      where: { id: room.id },
      data: { title: dto.title, category: dto.category, status: 'live' },
    });
    const stream = await this.prisma.stream.create({
      data: { roomId: room.id, hostId: hostUserId, title: dto.title },
    });
    await this.prisma.room.update({ where: { id: room.id }, data: { currentStreamId: stream.id } });

    return { room: updatedRoom, stream };
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

  /**
   * RTMP ingest endpoint + a fresh stream key value, fetched from IVS on
   * demand — the key value itself is never persisted in plaintext, only its
   * ARN (room.ivsStreamKeyArn).
   */
  async getStreamCredentials(hostUserId: string) {
    const room = await this.prisma.room.findUnique({ where: { hostId: hostUserId } });
    if (!room?.ivsChannelArn || !room.ivsStreamKeyArn || !room.ivsIngestEndpoint) {
      throw new BadRequestException('No streaming channel provisioned for this host');
    }
    const streamKeyValue = await this.ivs.getStreamKeyValue(room.ivsStreamKeyArn);
    return {
      ingestEndpoint: `rtmps://${room.ivsIngestEndpoint}:443/app/`,
      streamKeyValue,
      playbackUrl: room.ivsPlaybackUrl,
    };
  }
}
