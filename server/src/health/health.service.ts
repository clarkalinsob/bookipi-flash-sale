import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

@Injectable()
export class HealthService {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async ping() {
    const mongoStatus = await this.pingMongo();
    const redisHits = await this.pingRedis();

    return {
      mongo: mongoStatus,
      redis: redisHits > 0 ? 'ok' : 'error',
      redisHitCounter: redisHits,
    };
  }

  private async pingMongo(): Promise<'ok' | 'error'> {
    try {
      const result = await this.mongoConnection.db?.admin().ping();
      return result?.ok === 1 ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }

  private async pingRedis(): Promise<number> {
    return this.redis.incr('health:ping:count');
  }
}
