import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { CreateUploadDto, RemoveMediaDto, UpdateMediaDto } from './dto/media.dto';
import { MediaService } from './media.service';

@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  list() {
    return this.media.listPublic();
  }

  @Get('mine')
  mine(@CurrentUser() user: JwtPayload) {
    return this.media.listMine(user.sub);
  }

  /** Reserve an upload: returns the asset and a presigned PUT URL for its fixed key. */
  @Post('uploads')
  createUpload(@CurrentUser() user: JwtPayload, @Body() dto: CreateUploadDto) {
    return this.media.createUpload(user.sub, dto);
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.media.submit(user.sub, id);
  }

  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.media.get(user.sub, user.role, id);
  }

  @Put(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateMediaDto) {
    return this.media.update(user.sub, id, dto);
  }

  @Post(':id/remove')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: RemoveMediaDto) {
    return this.media.remove(user.sub, user.role, id, dto.reason);
  }

  @Post(':id/view')
  async view(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return { viewCount: (await this.media.recordView(user.sub, id)).toString() };
  }
}
