import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

// Prisma maps Postgres bigint columns (coin balances, gift totals, scores, ...)
// to JS BigInt, which neither Express's res.json() nor Socket.IO's default
// parser can serialize. This is the standard fix: every BigInt becomes a
// string wherever it's JSON-encoded, instead of every handler doing it by hand.
declare global {
  interface BigInt {
    toJSON(): string;
  }
}
// eslint-disable-next-line @typescript-eslint/no-extend-native, no-extend-native
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function toJSON(this: bigint) {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const redisAdapter = new RedisIoAdapter(app, redisUrl);
    await redisAdapter.connectToRedis();
    app.useWebSocketAdapter(redisAdapter);
  }

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
