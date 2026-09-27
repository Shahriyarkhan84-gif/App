import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PLATFORM_ADMIN_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.users.findById(user.sub);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PLATFORM_ADMIN_ROLES)
  @Get()
  listAll(@Query('cursor') cursor?: string) {
    return this.users.listAll(cursor);
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.users.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/follow')
  follow(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.users.follow(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/follow')
  unfollow(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.users.unfollow(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/block')
  block(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.users.block(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/block')
  unblock(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.users.unblock(user.sub, id);
  }
}
