import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { GoLiveDto } from './dto/go-live.dto';
import { StreamsService } from './streams.service';

@Controller('streams')
export class StreamsController {
  constructor(private readonly streams: StreamsService) {}

  @Get('live')
  listLive() {
    return this.streams.listLive();
  }

  @UseGuards(JwtAuthGuard)
  @Post('go-live')
  goLive(@CurrentUser() user: JwtPayload, @Body() dto: GoLiveDto) {
    return this.streams.goLive(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('end')
  end(@CurrentUser() user: JwtPayload) {
    return this.streams.endStream(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('credentials')
  credentials(@CurrentUser() user: JwtPayload) {
    return this.streams.getStreamCredentials(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.streams.getMyRoom(user.sub);
  }
}
