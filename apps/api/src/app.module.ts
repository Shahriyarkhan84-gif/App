import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module';
import { BattlesModule } from './battles/battles.module';
import { HostsModule } from './hosts/hosts.module';
import { IvsModule } from './ivs/ivs.module';
import { PrismaModule } from './prisma/prisma.module';
import { StreamsModule } from './streams/streams.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    IvsModule,
    AuthModule,
    UsersModule,
    HostsModule,
    StreamsModule,
    BattlesModule,
  ],
})
export class AppModule {}
