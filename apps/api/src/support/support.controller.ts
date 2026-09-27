import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { CreateSupportTicketDto } from './dto/create-ticket.dto';
import { SupportService } from './support.service';

@UseGuards(JwtAuthGuard)
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSupportTicketDto) {
    return this.support.createTicket(user.sub, dto.subject, dto.body);
  }

  @Get('me')
  mine(@CurrentUser() user: JwtPayload) {
    return this.support.myTickets(user.sub);
  }
}
