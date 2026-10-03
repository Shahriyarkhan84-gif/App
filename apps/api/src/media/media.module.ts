import { Module } from '@nestjs/common';

import { InternalMediaController } from './internal-media.controller';
import { MediaStorageService } from './media-storage.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController, InternalMediaController],
  providers: [MediaService, MediaStorageService],
  exports: [MediaService],
})
export class MediaModule {}
