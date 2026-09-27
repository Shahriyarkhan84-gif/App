import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { RecommendationsService } from './recommendations.service';

@UseGuards(JwtAuthGuard)
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.recommendations.forUser(user.sub);
  }
}
