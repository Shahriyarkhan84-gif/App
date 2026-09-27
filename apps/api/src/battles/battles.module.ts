import { Module } from '@nestjs/common';

import { RealtimeModule } from '../realtime/realtime.module';
import { BattlesController } from './battles.controller';
import { BattlesService } from './battles.service';

@Module({
  imports: [RealtimeModule],
  controllers: [BattlesController],
  providers: [BattlesService],
  exports: [BattlesService],
})
export class BattlesModule {}
