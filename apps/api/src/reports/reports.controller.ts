import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PLATFORM_ADMIN_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReportContentDto } from './dto/report-content.dto';
import { ReportsService } from './reports.service';

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  report(@CurrentUser() user: JwtPayload, @Body() dto: ReportContentDto) {
    return this.reports.reportContent(user.sub, dto.targetType, dto.targetId, dto.reason);
  }

  @UseGuards(RolesGuard)
  @Roles(...PLATFORM_ADMIN_ROLES)
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.reports.listReports(user.role, status);
  }

  @UseGuards(RolesGuard)
  @Roles(...PLATFORM_ADMIN_ROLES)
  @Post(':id/dismiss')
  dismiss(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.reports.dismissReport(user.role, id);
  }
}
