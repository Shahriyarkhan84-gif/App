import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PLATFORM_ADMIN_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpsertEventDto } from './dto/upsert-event.dto';
import { EventsService } from './events.service';

@UseGuards(JwtAuthGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.events.listFor(user.sub);
  }

  @Get(':id/leaderboard')
  leaderboard(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Query('role') role = 'host', @Query('limit') limit?: string) {
    const n = Number.parseInt(limit ?? '', 10);
    return this.events.leaderboard(id, role === 'gifter' ? 'gifter' : 'host', Number.isFinite(n) ? n : 50, user.role);
  }

  // Admin: create / edit / cancel / finalize. The service re-checks the role.
  @UseGuards(RolesGuard)
  @Roles(...PLATFORM_ADMIN_ROLES)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: UpsertEventDto) {
    return this.events.upsert(user.sub, user.role, null, { ...dto, regionCode: dto.region ?? null });
  }

  @UseGuards(RolesGuard)
  @Roles(...PLATFORM_ADMIN_ROLES)
  @Put(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpsertEventDto) {
    return this.events.upsert(user.sub, user.role, id, { ...dto, regionCode: dto.region ?? null });
  }

  @UseGuards(RolesGuard)
  @Roles(...PLATFORM_ADMIN_ROLES)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.events.cancel(user.sub, user.role, id);
  }

  @UseGuards(RolesGuard)
  @Roles(...PLATFORM_ADMIN_ROLES)
  @Post(':id/finalize')
  finalize(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.events.finalizeAsAdmin(user.sub, user.role, id);
  }
}
