import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AiJobsModule } from './ai-jobs/ai-jobs.module';
import { AuthModule } from './auth/auth.module';
import { BattlesModule } from './battles/battles.module';
import { ChatModule } from './chat/chat.module';
import { EarningsModule } from './earnings/earnings.module';
import { EventsModule } from './events/events.module';
import { GiftsModule } from './gifts/gifts.module';
import { HostsModule } from './hosts/hosts.module';
import { IvsModule } from './ivs/ivs.module';
import { MediaModule } from './media/media.module';
import { ModerationModule } from './moderation/moderation.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { RankingsModule } from './rankings/rankings.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { RegionsModule } from './regions/regions.module';
import { ReportsModule } from './reports/reports.module';
import { StreamsModule } from './streams/streams.module';
import { SupportModule } from './support/support.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RegionsModule,
    IvsModule,
    AiJobsModule,
    AuthModule,
    UsersModule,
    HostsModule,
    StreamsModule,
    ChatModule,
    RealtimeModule,
    BattlesModule,
    WalletsModule,
    GiftsModule,
    PaymentsModule,
    EarningsModule,
    ModerationModule,
    ReportsModule,
    RankingsModule,
    RecommendationsModule,
    SupportModule,
    MediaModule,
    EventsModule,
  ],
})
export class AppModule {}
