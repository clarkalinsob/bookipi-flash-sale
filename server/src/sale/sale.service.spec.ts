import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { REDIS_CLIENT } from '../redis/redis.module';
import { STOCK_KEY } from '../redis/redis.keys';
import { SaleService } from './sale.service';
import { SaleConfig } from './schemas/sale-config.schema';

describe('SaleService', () => {
  let service: SaleService;
  let saleConfigModel: { findOne: jest.Mock };
  let redis: { get: jest.Mock };

  const baseConfig = {
    productName: 'Flash Sale Widget',
    totalStock: 100,
  };

  beforeEach(async () => {
    saleConfigModel = { findOne: jest.fn() };
    redis = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaleService,
        { provide: getModelToken(SaleConfig.name), useValue: saleConfigModel },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = module.get(SaleService);
  });

  function mockConfig(
    overrides: Partial<typeof baseConfig & { startTime: Date; endTime: Date }>,
  ) {
    const doc = { ...baseConfig, ...overrides };
    saleConfigModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });
    return doc;
  }

  describe('getStatus', () => {
    it('reports "upcoming" before startTime', async () => {
      mockConfig({
        startTime: new Date(Date.now() + 60_000),
        endTime: new Date(Date.now() + 120_000),
      });
      redis.get.mockResolvedValue(null);

      const status = await service.getStatus();

      expect(status.status).toBe('upcoming');
      expect(status.stockRemaining).toBe(100);
    });

    it('reports "active" between startTime and endTime, using live Redis stock', async () => {
      mockConfig({
        startTime: new Date(Date.now() - 60_000),
        endTime: new Date(Date.now() + 60_000),
      });
      redis.get.mockResolvedValue('42');

      const status = await service.getStatus();

      expect(status.status).toBe('active');
      expect(status.stockRemaining).toBe(42);
    });

    it('reports "ended" after endTime', async () => {
      mockConfig({
        startTime: new Date(Date.now() - 120_000),
        endTime: new Date(Date.now() - 60_000),
      });
      redis.get.mockResolvedValue('0');

      const status = await service.getStatus();

      expect(status.status).toBe('ended');
    });

    it('falls back to config.totalStock when the Redis key is unset', async () => {
      mockConfig({
        startTime: new Date(Date.now() - 60_000),
        endTime: new Date(Date.now() + 60_000),
      });
      redis.get.mockResolvedValue(null);

      const status = await service.getStatus();

      expect(status.stockRemaining).toBe(100);
      expect(redis.get).toHaveBeenCalledWith(STOCK_KEY);
    });

    it('throws when no sale is configured', async () => {
      saleConfigModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.getStatus()).rejects.toThrow(
        'Sale is not configured',
      );
    });
  });

  describe('isActive', () => {
    it('is true within the sale window', async () => {
      mockConfig({
        startTime: new Date(Date.now() - 60_000),
        endTime: new Date(Date.now() + 60_000),
      });

      await expect(service.isActive()).resolves.toBe(true);
    });

    it('is false outside the sale window', async () => {
      mockConfig({
        startTime: new Date(Date.now() + 60_000),
        endTime: new Date(Date.now() + 120_000),
      });

      await expect(service.isActive()).resolves.toBe(false);
    });

    it('is false when no sale is configured', async () => {
      saleConfigModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.isActive()).resolves.toBe(false);
    });
  });
});
