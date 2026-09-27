import { Global, Module } from '@nestjs/common';

import { IvsService } from './ivs.service';

@Global()
@Module({
  providers: [IvsService],
  exports: [IvsService],
})
export class IvsModule {}
