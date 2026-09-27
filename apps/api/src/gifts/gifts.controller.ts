import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { SendGiftDto } from './dto/send-gift.dto';
import { GiftsService } from './gifts.service';

@Controller('gifts')
export class GiftsController {
  constructor(private readonly gifts: GiftsService) {}

  @Get('catalog')
  catalog() {
    return this.gifts.catalog();
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  send(@CurrentUser() user: JwtPayload, @Body() dto: SendGiftDto) {
    return this.gifts.sendGift(user.sub, dto.roomId, dto.giftId, dto.quantity, dto.idempotencyKey);
  }
}
