import { Controller, Get, Query } from '@nestjs/common';

import { RankingsService, type RankingKind, type RankingPeriod } from './rankings.service';

@Controller('rankings')
export class RankingsController {
  constructor(private readonly rankings: RankingsService) {}

  @Get()
  get(@Query('kind') kind: RankingKind, @Query('period') period?: RankingPeriod) {
    return this.rankings.getRankings(kind, period);
  }
}
