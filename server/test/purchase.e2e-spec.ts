import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { REDIS_CLIENT } from '../src/redis/redis.module';
import { PURCHASED_SET_KEY, STOCK_KEY } from '../src/redis/redis.keys';
import {
  Purchase,
  PurchaseDocument,
} from '../src/purchase/schemas/purchase.schema';
import {
  SaleConfig,
  SaleConfigDocument,
} from '../src/sale/schemas/sale-config.schema';

describe('Flash sale API (e2e)', () => {
  let app: INestApplication<App>;
  let purchaseModel: Model<PurchaseDocument>;
  let saleConfigModel: Model<SaleConfigDocument>;
  let redis: Redis;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Rate limiting is a network-abuse concern, not a correctness one —
      // bypass it here so the test suite can fire many requests quickly
      // without tripping the same guard a real abusive client would.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    purchaseModel = moduleFixture.get(getModelToken(Purchase.name));
    saleConfigModel = moduleFixture.get(getModelToken(SaleConfig.name));
    redis = moduleFixture.get(REDIS_CLIENT);
  });

  afterAll(async () => {
    // RedisModule's ioredis client has no Nest lifecycle hook wired up to
    // close it, so app.close() alone leaves the connection open and Jest's
    // worker hangs — quit it explicitly.
    await redis.quit();
    await app.close();
  });

  async function seedSale(overrides: {
    totalStock: number;
    startTime: Date;
    endTime: Date;
  }) {
    await purchaseModel.deleteMany({});
    await saleConfigModel.deleteMany({});
    await saleConfigModel.create({
      productName: 'E2E Test Widget',
      ...overrides,
    });
    await redis.set(STOCK_KEY, overrides.totalStock);
    await redis.del(PURCHASED_SET_KEY);
  }

  interface SaleStatusResponseBody {
    status: 'upcoming' | 'active' | 'ended';
    startTime: string;
    endTime: string;
    stockRemaining: number;
  }

  function seedActiveSale(totalStock: number) {
    return seedSale({
      totalStock,
      startTime: new Date(Date.now() - 60_000),
      endTime: new Date(Date.now() + 10 * 60_000),
    });
  }

  describe('GET /api/sale/status', () => {
    it('reports active status with correct stock remaining', async () => {
      await seedActiveSale(5);

      const res = await request(app.getHttpServer())
        .get('/api/sale/status')
        .expect(200);

      const body = res.body as SaleStatusResponseBody;
      expect(body.status).toBe('active');
      expect(body.stockRemaining).toBe(5);
      expect(body).toHaveProperty('startTime');
      expect(body).toHaveProperty('endTime');
    });
  });

  describe('POST /api/purchase', () => {
    beforeEach(async () => {
      await seedActiveSale(2);
    });

    it('succeeds for a new user and decrements stock', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/purchase')
        .send({ userId: 'e2e-user-1' })
        .expect(200);

      expect(res.body).toEqual({ result: 'success' });

      const status = await request(app.getHttpServer())
        .get('/api/sale/status')
        .expect(200);
      expect((status.body as SaleStatusResponseBody).stockRemaining).toBe(1);
    });

    it('returns already_purchased for a repeat purchase by the same user', async () => {
      await request(app.getHttpServer())
        .post('/api/purchase')
        .send({ userId: 'e2e-user-2' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/purchase')
        .send({ userId: 'e2e-user-2' })
        .expect(200);

      expect(res.body).toEqual({ result: 'already_purchased' });
    });

    it('returns sold_out once stock is depleted', async () => {
      await request(app.getHttpServer())
        .post('/api/purchase')
        .send({ userId: 'e2e-user-3' })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/purchase')
        .send({ userId: 'e2e-user-4' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/purchase')
        .send({ userId: 'e2e-user-5' })
        .expect(200);

      expect(res.body).toEqual({ result: 'sold_out' });
    });

    it('rejects a missing userId with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/purchase')
        .send({})
        .expect(400);
    });

    it('rejects an empty userId with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/purchase')
        .send({ userId: '' })
        .expect(400);
    });

    it('rejects unexpected extra fields with 400 (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .post('/api/purchase')
        .send({ userId: 'e2e-user-6', isAdmin: true })
        .expect(400);
    });
  });

  describe('GET /api/purchase/:userId', () => {
    beforeEach(async () => {
      await seedActiveSale(2);
    });

    it('reports hasPurchased=false for a user who has not bought', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/purchase/never-bought')
        .expect(200);
      expect(res.body).toEqual({ hasPurchased: false });
    });

    it('reports hasPurchased=true after a successful purchase', async () => {
      await request(app.getHttpServer())
        .post('/api/purchase')
        .send({ userId: 'e2e-user-7' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/purchase/e2e-user-7')
        .expect(200);
      expect(res.body).toEqual({ hasPurchased: true });
    });
  });

  describe('sale not active', () => {
    beforeAll(async () => {
      await seedSale({
        totalStock: 5,
        startTime: new Date(Date.now() + 60 * 60_000),
        endTime: new Date(Date.now() + 2 * 60 * 60_000),
      });
    });

    it('GET /api/sale/status reports upcoming', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/sale/status')
        .expect(200);
      expect((res.body as SaleStatusResponseBody).status).toBe('upcoming');
    });

    it('POST /api/purchase returns not_active', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/purchase')
        .send({ userId: 'e2e-user-8' })
        .expect(200);

      expect(res.body).toEqual({ result: 'not_active' });
    });
  });
});
