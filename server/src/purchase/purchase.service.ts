import { readFileSync } from 'fs';
import { join } from 'path';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PURCHASED_SET_KEY, STOCK_KEY } from '../redis/redis.keys';
import { SaleService } from '../sale/sale.service';
import { Purchase, PurchaseDocument } from './schemas/purchase.schema';
import { PurchaseResult, RedisWithPurchaseCommand } from './purchase.types';

const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;

@Injectable()
export class PurchaseService implements OnModuleInit {
  private readonly logger = new Logger(PurchaseService.name);
  private readonly redisCmd: Redis & RedisWithPurchaseCommand;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectModel(Purchase.name)
    private readonly purchaseModel: Model<PurchaseDocument>,
    private readonly saleService: SaleService,
  ) {
    this.redis.defineCommand('attemptPurchase', {
      numberOfKeys: 2,
      lua: readFileSync(join(__dirname, 'purchase.lua'), 'utf8'),
    });
    this.redisCmd = this.redis as Redis & RedisWithPurchaseCommand;
  }

  /**
   * Reconciles Redis from the Mongo ledger on boot. This is what makes Mongo
   * the "source of truth if Redis restarts" real rather than aspirational:
   * a fresh Redis (empty stock key) gets its counter rebuilt from
   * totalStock - actualPurchaseCount, not blindly reset to totalStock.
   */
  async onModuleInit(): Promise<void> {
    await this.reconcileFromMongo();
  }

  async attemptPurchase(userId: string): Promise<PurchaseResult> {
    const active = await this.saleService.isActive();
    if (!active) {
      return PurchaseResult.NotActive;
    }

    const result = await this.redisCmd.attemptPurchase(
      STOCK_KEY,
      PURCHASED_SET_KEY,
      userId,
    );

    if (result === 'ALREADY_PURCHASED') {
      return PurchaseResult.AlreadyPurchased;
    }
    if (result === 'SOLD_OUT') {
      return PurchaseResult.SoldOut;
    }

    await this.persistPurchase(userId);
    return PurchaseResult.Success;
  }

  async hasPurchased(userId: string): Promise<boolean> {
    const doc = await this.purchaseModel.exists({ userId });
    return doc !== null;
  }

  /**
   * Redis has already committed the decrement + set membership by this
   * point — that's what the response to the user is based on. The Mongo
   * write is the durable ledger entry, not a second vote on whether the
   * purchase happened. A failure here is logged for reconciliation rather
   * than surfaced as a purchase failure, since telling the user "sold_out"
   * or erroring after Redis already gave away the unit would be worse: it
   * would strand that unit as unsold with no way for anyone to claim it.
   */
  private async persistPurchase(userId: string): Promise<void> {
    try {
      await this.purchaseModel.create({ userId });
    } catch (err: unknown) {
      if (this.isDuplicateKeyError(err)) {
        this.logger.warn(
          'Mongo already had a purchase row for this user despite a fresh Redis SUCCESS — investigate reconciliation drift.',
        );
        return;
      }
      this.logger.error(
        'Failed to persist purchase to Mongo after Redis-confirmed success',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: number }).code === MONGO_DUPLICATE_KEY_ERROR_CODE
    );
  }

  private async reconcileFromMongo(): Promise<void> {
    const config = await this.saleService.getConfig();
    if (!config) {
      return;
    }

    const purchasedCount = await this.purchaseModel.countDocuments();
    const remainingStock = Math.max(config.totalStock - purchasedCount, 0);
    // NX: never clobber a live counter another instance already seeded.
    await this.redis.set(STOCK_KEY, remainingStock, 'NX');

    const purchasedUserIds = await this.purchaseModel.distinct('userId');
    if (purchasedUserIds.length > 0) {
      await this.redis.sadd(PURCHASED_SET_KEY, purchasedUserIds);
    }
  }
}
