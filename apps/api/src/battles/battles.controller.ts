import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { BattlesService } from './battles.service';
import { InviteBattleDto } from './dto/invite-battle.dto';
import { RespondBattleDto } from './dto/respond-battle.dto';

@UseGuards(JwtAuthGuard)
@Controller('battles')
export class BattlesController {
  constructor(private readonly battles: BattlesService) {}

  @Post('invite')
  invite(@CurrentUser() user: JwtPayload, @Body() dto: InviteBattleDto) {
    return this.battles.invite(user.sub, dto.targetRoomId);
  }

  @Post(':id/respond')
  respond(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: RespondBattleDto) {
    return this.battles.respond(user.sub, id, dto.accept);
  }

  @Post(':id/end')
  end(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.battles.end(user.sub, user.role, id);
  }
}
