import { Module } from '@nestjs/common';

import { RealtimeModule } from '../realtime/realtime.module';
import { InternalModerationController } from './internal-moderation.controller';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

@Module({
  imports: [RealtimeModule],
  controllers: [ModerationController, InternalModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
