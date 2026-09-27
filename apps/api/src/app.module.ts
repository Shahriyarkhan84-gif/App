import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module';
import { BattlesModule } from './battles/battles.module';
import { ChatModule } from './chat/chat.module';
import { EarningsModule } from './earnings/earnings.module';
import { GiftsModule } from './gifts/gifts.module';
import { HostsModule } from './hosts/hosts.module';
import { IvsModule } from './ivs/ivs.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { StreamsModule } from './streams/streams.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    IvsModule,
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
  ],
})
export class AppModule {}
