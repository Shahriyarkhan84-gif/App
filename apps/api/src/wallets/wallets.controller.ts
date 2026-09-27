import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { WalletsService } from './wallets.service';

@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.wallets.getWallet(user.sub);
  }
}
