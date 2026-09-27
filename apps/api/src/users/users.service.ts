import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // passwordHash/refreshTokenHash/twoFactorSecret/googleSub/appleSub must
  // NEVER be selected here under any circumstances — not even for the
  // owner's own /users/me, since that response still goes over the wire to
  // a client. This was a real bug: both call sites used to `include: {...}`
  // the bare User relation, which pulls every column by default.
  private static readonly SELF_SELECT = {
    id: true,
    username: true,
    displayName: true,
    avatarUrl: true,
    bio: true,
    country: true,
    language: true,
    email: true,
    phone: true,
    role: true,
    status: true,
    statusUntil: true,
    createdAt: true,
    wallet: true,
    host: true,
  } as const;

  private static readonly PUBLIC_SELECT = {
    id: true,
    username: true,
    displayName: true,
    avatarUrl: true,
    bio: true,
    country: true,
    role: true,
    createdAt: true,
    host: { select: { userId: true, hostCode: true, status: true } },
  } as const;

  /** The caller's own profile — GET /users/me. Includes wallet/email/phone. */
  async findSelf(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: UsersService.SELF_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Someone else's public profile — GET /users/:id. No email/phone/wallet. */
  async findPublicProfile(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: UsersService.PUBLIC_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Admin-only listing (see RolesGuard on the controller route). Cursor-paginated
  // for the eventual admin panel's user-management table.
  listAll(cursor?: string, take = 25) {
    return this.prisma.user.findMany({
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        phone: true,
        displayName: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.username) {
      const taken = await this.prisma.user.findFirst({
        where: { username: dto.username, NOT: { id: userId } },
      });
      if (taken) throw new ConflictException('Username already taken');
    }
    return this.prisma.user.update({ where: { id: userId }, data: dto });
  }

  /** Followee ids for the caller — the Home feed's "following" filter needs this. */
  async myFollowing(userId: string): Promise<string[]> {
    const rows = await this.prisma.follow.findMany({ where: { followerId: userId }, select: { followeeId: true } });
    return rows.map((r) => r.followeeId);
  }

  async follow(followerId: string, followeeId: string) {
    if (followerId === followeeId) throw new BadRequestException("You can't follow yourself");
    await this.prisma.follow.upsert({
      where: { followerId_followeeId: { followerId, followeeId } },
      create: { followerId, followeeId },
      update: {},
    });
    return { ok: true };
  }

  async unfollow(followerId: string, followeeId: string) {
    await this.prisma.follow.deleteMany({ where: { followerId, followeeId } });
    return { ok: true };
  }

  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) throw new BadRequestException("You can't block yourself");
    await this.prisma.$transaction([
      this.prisma.userBlock.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId },
        update: {},
      }),
      // Blocking severs the follow graph both ways, same as the RLS-backed RPC.
      this.prisma.follow.deleteMany({
        where: { OR: [{ followerId: blockerId, followeeId: blockedId }, { followerId: blockedId, followeeId: blockerId }] },
      }),
    ]);
    return { ok: true };
  }

  async unblock(blockerId: string, blockedId: string) {
    await this.prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
    return { ok: true };
  }
}
