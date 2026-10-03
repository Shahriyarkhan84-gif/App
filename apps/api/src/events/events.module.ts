import { Module } from '@nestjs/common';

import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { InternalEventsController } from './internal-events.controller';

@Module({
  controllers: [EventsController, InternalEventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
