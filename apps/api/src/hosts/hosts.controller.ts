import { Controller, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { HostsService } from './hosts.service';

@Controller('hosts')
export class HostsController {
  constructor(private readonly hosts: HostsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('become')
  becomeHost(@CurrentUser() user: JwtPayload) {
    return this.hosts.becomeHost(user.sub);
  }
}
