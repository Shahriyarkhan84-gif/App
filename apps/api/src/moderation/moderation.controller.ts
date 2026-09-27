import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PLATFORM_ADMIN_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApplyModerationDto, ReviewAiActionDto } from './dto/moderation.dto';
import { ModerationService } from './moderation.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...PLATFORM_ADMIN_ROLES)
@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('ai-actions')
  listAiActions(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.moderation.listAiActions(user.role, status);
  }

  @Post('actions')
  applyAction(@CurrentUser() user: JwtPayload, @Body() dto: ApplyModerationDto) {
    return this.moderation.applyModerationAction(
      user.sub,
      user.role,
      dto.targetUserId,
      dto.action,
      dto.reason,
      dto.hours ?? null,
      dto.reportId ?? null,
    );
  }

  @Post('ai-actions/:id/review')
  reviewAiAction(@CurrentUser() user: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: ReviewAiActionDto) {
    return this.moderation.reviewAiAction(user.sub, user.role, BigInt(id), dto.approve);
  }
}
