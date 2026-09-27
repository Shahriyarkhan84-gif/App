import { Global, Module } from '@nestjs/common';

import { AiJobsService } from './ai-jobs.service';

@Global()
@Module({
  providers: [AiJobsService],
  exports: [AiJobsService],
})
export class AiJobsModule {}
