import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { ChatService } from './chat.service';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('rooms/:roomId/messages')
  roomHistory(@Param('roomId') roomId: string, @Query('take') take?: string) {
    return this.chat.roomHistory(roomId, take ? Number(take) : undefined);
  }

  @Get('dms/:userId')
  dmThread(@CurrentUser() user: JwtPayload, @Param('userId') otherUserId: string) {
    return this.chat.dmThread(user.sub, otherUserId);
  }
}
