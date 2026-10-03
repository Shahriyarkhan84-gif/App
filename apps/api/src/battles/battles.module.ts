import { Module } from '@nestjs/common';

import { EventsModule } from '../events/events.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { BattlesController } from './battles.controller';
import { BattlesService } from './battles.service';

@Module({
  imports: [RealtimeModule, EventsModule],
  controllers: [BattlesController],
  providers: [BattlesService],
  exports: [BattlesService],
})
export class BattlesModule {}
