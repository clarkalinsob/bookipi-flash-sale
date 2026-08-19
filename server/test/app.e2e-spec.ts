import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { REDIS_CLIENT } from '../src/redis/redis.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let redis: Redis;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    redis = moduleFixture.get(REDIS_CLIENT);
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    // RedisModule's ioredis client has no Nest lifecycle hook wired up to
    // close it, so app.close() alone leaves the connection open and Jest's
    // worker hangs — quit it explicitly.
    await redis.quit();
    await app.close();
  });
});
