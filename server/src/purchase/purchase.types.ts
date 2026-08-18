export enum PurchaseResult {
  Success = 'success',
  SoldOut = 'sold_out',
  AlreadyPurchased = 'already_purchased',
  NotActive = 'not_active',
}

type LuaResult = 'SUCCESS' | 'SOLD_OUT' | 'ALREADY_PURCHASED';

// Augments ioredis's client type with the custom command registered via
// `defineCommand` in PurchaseService — see purchase.lua.
export interface RedisWithPurchaseCommand {
  attemptPurchase(
    stockKey: string,
    purchasedSetKey: string,
    userId: string,
  ): Promise<LuaResult>;
}
