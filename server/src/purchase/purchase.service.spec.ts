import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PURCHASED_SET_KEY, STOCK_KEY } from '../redis/redis.keys';
import { SaleService } from '../sale/sale.service';
import { PurchaseService } from './purchase.service';
import { Purchase } from './schemas/purchase.schema';
import { PurchaseResult } from './purchase.types';

describe('PurchaseService', () => {
  let service: PurchaseService;
  let redis: {
    defineCommand: jest.Mock;
    attemptPurchase: jest.Mock;
    set: jest.Mock;
    sadd: jest.Mock;
  };
  let purchaseModel: {
    create: jest.Mock;
    exists: jest.Mock;
    countDocuments: jest.Mock;
    distinct: jest.Mock;
  };
  let saleService: { isActive: jest.Mock; getConfig: jest.Mock };

  beforeEach(async () => {
    redis = {
      defineCommand: jest.fn(),
      attemptPurchase: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      sadd: jest.fn().mockResolvedValue(0),
    };
    purchaseModel = {
      create: jest.fn().mockResolvedValue({}),
      exists: jest.fn().mockResolvedValue(null),
      countDocuments: jest.fn().mockResolvedValue(0),
      distinct: jest.fn().mockResolvedValue([]),
    };
    saleService = {
      isActive: jest.fn().mockResolvedValue(true),
      getConfig: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: getModelToken(Purchase.name), useValue: purchaseModel },
        { provide: SaleService, useValue: saleService },
      ],
    }).compile();

    service = module.get(PurchaseService);
  });

  describe('attemptPurchase', () => {
    it('returns not_active without touching Redis when the sale is not active', async () => {
      saleService.isActive.mockResolvedValue(false);

      const result = await service.attemptPurchase('user-1');

      expect(result).toBe(PurchaseResult.NotActive);
      expect(redis.attemptPurchase).not.toHaveBeenCalled();
    });

    it('returns already_purchased when the Lua script reports it, without writing to Mongo', async () => {
      redis.attemptPurchase.mockResolvedValue('ALREADY_PURCHASED');

      const result = await service.attemptPurchase('user-1');

      expect(result).toBe(PurchaseResult.AlreadyPurchased);
      expect(purchaseModel.create).not.toHaveBeenCalled();
    });

    it('returns sold_out when the Lua script reports it, without writing to Mongo', async () => {
      redis.attemptPurchase.mockResolvedValue('SOLD_OUT');

      const result = await service.attemptPurchase('user-1');

      expect(result).toBe(PurchaseResult.SoldOut);
      expect(purchaseModel.create).not.toHaveBeenCalled();
    });

    it('returns success and persists the durable ledger row on a fresh success', async () => {
      redis.attemptPurchase.mockResolvedValue('SUCCESS');

      const result = await service.attemptPurchase('user-1');

      expect(result).toBe(PurchaseResult.Success);
      expect(redis.attemptPurchase).toHaveBeenCalledWith(
        STOCK_KEY,
        PURCHASED_SET_KEY,
        'user-1',
      );
      expect(purchaseModel.create).toHaveBeenCalledWith({ userId: 'user-1' });
    });

    it('still returns success if the Mongo write hits a duplicate key (Redis is authoritative)', async () => {
      redis.attemptPurchase.mockResolvedValue('SUCCESS');
      purchaseModel.create.mockRejectedValue({ code: 11000 });

      const result = await service.attemptPurchase('user-1');

      expect(result).toBe(PurchaseResult.Success);
    });

    it('still returns success if the Mongo write fails for an unrelated reason', async () => {
      redis.attemptPurchase.mockResolvedValue('SUCCESS');
      purchaseModel.create.mockRejectedValue(new Error('Mongo unreachable'));

      const result = await service.attemptPurchase('user-1');

      expect(result).toBe(PurchaseResult.Success);
    });
  });

  describe('hasPurchased', () => {
    it('is true when a Mongo row exists for the user', async () => {
      purchaseModel.exists.mockResolvedValue({ _id: 'abc' });

      await expect(service.hasPurchased('user-1')).resolves.toBe(true);
    });

    it('is false when no Mongo row exists for the user', async () => {
      purchaseModel.exists.mockResolvedValue(null);

      await expect(service.hasPurchased('user-1')).resolves.toBe(false);
    });
  });

  describe('onModuleInit (Redis reconciliation from the Mongo ledger)', () => {
    it('does nothing when no sale is configured', async () => {
      saleService.getConfig.mockResolvedValue(null);

      await service.onModuleInit();

      expect(redis.set).not.toHaveBeenCalled();
    });

    it('seeds stock as totalStock minus actual purchase count, NX', async () => {
      saleService.getConfig.mockResolvedValue({ totalStock: 100 });
      purchaseModel.countDocuments.mockResolvedValue(30);
      purchaseModel.distinct.mockResolvedValue(['user-1', 'user-2']);

      await service.onModuleInit();

      expect(redis.set).toHaveBeenCalledWith(STOCK_KEY, 70, 'NX');
      expect(redis.sadd).toHaveBeenCalledWith(PURCHASED_SET_KEY, [
        'user-1',
        'user-2',
      ]);
    });

    it('never seeds a negative remaining stock', async () => {
      saleService.getConfig.mockResolvedValue({ totalStock: 10 });
      purchaseModel.countDocuments.mockResolvedValue(15);

      await service.onModuleInit();

      expect(redis.set).toHaveBeenCalledWith(STOCK_KEY, 0, 'NX');
    });

    it('skips the SADD call when there are no purchases yet', async () => {
      saleService.getConfig.mockResolvedValue({ totalStock: 100 });
      purchaseModel.countDocuments.mockResolvedValue(0);
      purchaseModel.distinct.mockResolvedValue([]);

      await service.onModuleInit();

      expect(redis.sadd).not.toHaveBeenCalled();
    });
  });
});
