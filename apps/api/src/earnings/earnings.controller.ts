import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PLATFORM_ADMIN_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { EarningsService } from './earnings.service';
import { MarkWithdrawalPaidDto, ReviewWithdrawalDto } from './dto/review-withdrawal.dto';
import { RequestWithdrawalDto } from './dto/request-withdrawal.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class EarningsController {
  constructor(private readonly earnings: EarningsService) {}

  @Get('earnings/me')
  me(@CurrentUser() user: JwtPayload) {
    return this.earnings.getEarnings(user.sub);
  }

  @Post('withdrawals')
  request(@CurrentUser() user: JwtPayload, @Body() dto: RequestWithdrawalDto) {
    return this.earnings.requestWithdrawal(user.sub, dto.coins, dto.payoutMethod);
  }

  @UseGuards(RolesGuard)
  @Roles(...PLATFORM_ADMIN_ROLES)
  @Post('withdrawals/:id/review')
  review(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ReviewWithdrawalDto) {
    return this.earnings.reviewWithdrawal(user.sub, user.role, id, dto.approve, dto.note);
  }

  @UseGuards(RolesGuard)
  @Roles(...PLATFORM_ADMIN_ROLES)
  @Post('withdrawals/:id/mark-paid')
  markPaid(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: MarkWithdrawalPaidDto) {
    return this.earnings.markWithdrawalPaid(user.role, id, dto.payoutRef);
  }
}
