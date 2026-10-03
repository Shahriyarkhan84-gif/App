import { Module } from '@nestjs/common';

import { EventsModule } from '../events/events.module';

import { BattlesModule } from '../battles/battles.module';
import { WalletsModule } from '../wallets/wallets.module';
import { GiftsController } from './gifts.controller';
import { GiftsService } from './gifts.service';

@Module({
  imports: [WalletsModule, BattlesModule, EventsModule],
  controllers: [GiftsController],
  providers: [GiftsService],
  exports: [GiftsService],
})
export class GiftsModule {}
