import { Controller, Post, UseGuards } from '@nestjs/common';

import { InternalAuthGuard } from '../common/internal-auth.guard';
import { EventsService } from './events.service';

/** Worker housekeeping — mirrors public.internal_finalize_due_events(). */
@UseGuards(InternalAuthGuard)
@Controller('internal/events')
export class InternalEventsController {
  constructor(private readonly events: EventsService) {}

  @Post('finalize-due')
  finalizeDue() {
    return this.events.finalizeDue();
  }
}
