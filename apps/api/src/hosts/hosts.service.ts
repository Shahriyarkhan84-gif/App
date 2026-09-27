import { ForbiddenException, Injectable } from '@nestjs/common';

import { IvsService } from '../ivs/ivs.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ivs: IvsService,
  ) {}

  /**
   * Mirrors private.ensure_host() + public.become_host() from
   * supabase/migrations/20260924120000_host_applications.sql: creates the
   * host/room/earnings rows (idempotently) and flips USER -> HOST. Identity
   * verification (Didit, agency codes) is a later phase — this is the bare
   * "can go live" flip the current app's become_host() RPC provides.
   *
   * Also provisions the host's one standing IVS channel (Phase 3): the
   * external AWS call happens before the DB transaction, so a failed
   * provision never leaves a half-written host row.
   */
  async becomeHost(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== 'active') throw new ForbiddenException('Account restricted');

    const existingRoom = await this.prisma.room.findUnique({ where: { hostId: userId } });

    const hostCode = await this.nextHostCode();
    const channel = existingRoom?.ivsChannelArn ? null : await this.ivs.createChannel(hostCode);

    return this.prisma.$transaction(async (tx) => {
      const host = await tx.host.upsert({
        where: { userId },
        create: { userId, hostCode },
        update: {},
      });
      await tx.room.upsert({
        where: { hostId: userId },
        create: channel
          ? {
              hostId: userId,
              ivsChannelArn: channel.channelArn,
              ivsStreamKeyArn: channel.streamKeyArn,
              ivsPlaybackUrl: channel.playbackUrl,
              ivsIngestEndpoint: channel.ingestEndpoint,
            }
          : { hostId: userId },
        update: {},
      });
      await tx.creatorEarning.upsert({ where: { hostId: userId }, create: { hostId: userId }, update: {} });
      if (user.role === 'USER') {
        await tx.user.update({ where: { id: userId }, data: { role: 'HOST' } });
      }
      return host;
    });
  }

  /** Atomic HOST-00000001-style code, matching core.sql's host_code_seq. */
  private async nextHostCode() {
    const counter = await this.prisma.counter.upsert({
      where: { name: 'host_code' },
      create: { name: 'host_code', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `HOST-${String(counter.value).padStart(8, '0')}`;
  }
}
