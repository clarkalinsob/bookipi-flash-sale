import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { STOCK_KEY } from '../redis/redis.keys';
import { SaleConfig, SaleConfigDocument } from './schemas/sale-config.schema';
import { SaleStatus } from './sale.types';

@Injectable()
export class SaleService {
  constructor(
    @InjectModel(SaleConfig.name)
    private readonly saleConfigModel: Model<SaleConfigDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** There is exactly one sale, so this is just "the" config document. */
  async getConfig(): Promise<SaleConfigDocument | null> {
    return this.saleConfigModel.findOne().exec();
  }

  async getStatus(): Promise<SaleStatus> {
    const config = await this.getConfig();
    if (!config) {
      throw new Error('Sale is not configured');
    }

    return {
      status: this.computeStatus(config, new Date()),
      startTime: config.startTime,
      endTime: config.endTime,
      stockRemaining: await this.getStockRemaining(config.totalStock),
    };
  }

  /** Server time only — client-supplied time is never trusted. */
  async isActive(): Promise<boolean> {
    const config = await this.getConfig();
    if (!config) {
      return false;
    }
    return this.computeStatus(config, new Date()) === 'active';
  }

  private computeStatus(
    config: Pick<SaleConfig, 'startTime' | 'endTime'>,
    now: Date,
  ): SaleStatus['status'] {
    if (now < config.startTime) {
      return 'upcoming';
    }
    if (now > config.endTime) {
      return 'ended';
    }
    return 'active';
  }

  private async getStockRemaining(fallback: number): Promise<number> {
    const raw = await this.redis.get(STOCK_KEY);
    return raw !== null ? parseInt(raw, 10) : fallback;
  }
}
