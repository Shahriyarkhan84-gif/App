import { Global, Module } from '@nestjs/common';

import { RegionsController } from './regions.controller';
import { RegionsService } from './regions.service';

@Global()
@Module({
  controllers: [RegionsController],
  providers: [RegionsService],
  exports: [RegionsService],
})
export class RegionsModule {}
