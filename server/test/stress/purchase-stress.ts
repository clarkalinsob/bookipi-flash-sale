/**
 * Phase 2 proof: fire thousands of concurrent purchase attempts directly at
 * PurchaseService (the real Redis/Mongo-backed service, via a Nest
 * application context) and assert, programmatically, that the concurrency
 * mechanism holds — zero oversell, no user ever succeeds twice, even when
 * the same user is racing itself. There is no HTTP layer yet (that's
 * Phase 3), so this exercises the actual bottleneck — the Lua EVAL against
 * shared Redis state — without a web server in between.
 *
 * Requires Mongo + Redis running (`docker compose up -d`). Run with:
 *   npm run test:stress
 */
import 'reflect-metadata';
import { performance } from 'perf_hooks';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import { AppModule } from '../../src/app.module';
import { REDIS_CLIENT } from '../../src/redis/redis.module';
import { PURCHASED_SET_KEY, STOCK_KEY } from '../../src/redis/redis.keys';
import { PurchaseService } from '../../src/purchase/purchase.service';
import {
  Purchase,
  PurchaseDocument,
} from '../../src/purchase/schemas/purchase.schema';
import {
  SaleConfig,
  SaleConfigDocument,
} from '../../src/sale/schemas/sale-config.schema';
import { PurchaseResult } from '../../src/purchase/purchase.types';

const STOCK = 100;
const UNIQUE_USERS = 5_000;
// Per PRD: "no user succeeds twice even under duplicate/racing requests" —
// re-fire a subset of users so their repeat attempts land concurrently with
// everything else, not appended safely at the end.
const RACING_USERS = 200;
const EXTRA_ATTEMPTS_PER_RACING_USER = 2;
const CONCURRENCY = 300;

interface AttemptRecord {
  userId: string;
  result: PurchaseResult;
  latencyMs: number;
}

function buildAttempts(): string[] {
  const attempts: string[] = [];
  for (let i = 0; i < UNIQUE_USERS; i++) {
    attempts.push(`stress-user-${i}`);
  }
  for (let i = 0; i < RACING_USERS; i++) {
    for (let j = 0; j < EXTRA_ATTEMPTS_PER_RACING_USER; j++) {
      attempts.push(`stress-user-${i}`);
    }
  }
  // Shuffle so racing duplicates land interleaved with fresh users, not
  // conveniently batched together.
  for (let i = attempts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [attempts[i], attempts[j]] = [attempts[j], attempts[i]];
  }
  return attempts;
}

async function runWithConcurrency(
  userIds: string[],
  limit: number,
  worker: (userId: string) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function next(): Promise<void> {
    while (cursor < userIds.length) {
      const userId = userIds[cursor++];
      await worker(userId);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => next()));
}

function percentile(sortedLatencies: number[], p: number): number {
  if (sortedLatencies.length === 0) return 0;
  const index = Math.min(
    sortedLatencies.length - 1,
    Math.ceil((p / 100) * sortedLatencies.length) - 1,
  );
  return sortedLatencies[Math.max(index, 0)];
}

async function seed(
  purchaseModel: Model<PurchaseDocument>,
  saleConfigModel: Model<SaleConfigDocument>,
  redis: Redis,
): Promise<void> {
  await purchaseModel.deleteMany({});
  await saleConfigModel.deleteMany({});
  await saleConfigModel.create({
    productName: 'Stress Test Widget',
    totalStock: STOCK,
    startTime: new Date(Date.now() - 60_000),
    endTime: new Date(Date.now() + 10 * 60_000),
  });
  await redis.set(STOCK_KEY, STOCK);
  await redis.del(PURCHASED_SET_KEY);
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  const purchaseService = app.get(PurchaseService);
  const redis = app.get<Redis>(REDIS_CLIENT);
  const purchaseModel = app.get<Model<PurchaseDocument>>(
    getModelToken(Purchase.name),
  );
  const saleConfigModel = app.get<Model<SaleConfigDocument>>(
    getModelToken(SaleConfig.name),
  );

  console.log(
    `Seeding: stock=${STOCK}, uniqueUsers=${UNIQUE_USERS}, racingUsers=${RACING_USERS} (x${EXTRA_ATTEMPTS_PER_RACING_USER} extra attempts each)\n`,
  );
  await seed(purchaseModel, saleConfigModel, redis);

  const attempts = buildAttempts();
  const records: AttemptRecord[] = [];
  const successfulUserIds = new Set<string>();
  const duplicateSuccesses: string[] = [];

  const start = performance.now();
  await runWithConcurrency(attempts, CONCURRENCY, async (userId) => {
    const requestStart = performance.now();
    const result = await purchaseService.attemptPurchase(userId);
    const latencyMs = performance.now() - requestStart;
    records.push({ userId, result, latencyMs });
    if (result === PurchaseResult.Success) {
      if (successfulUserIds.has(userId)) {
        duplicateSuccesses.push(userId);
      }
      successfulUserIds.add(userId);
    }
  });
  const totalDurationMs = performance.now() - start;

  const successCount = records.filter(
    (r) => r.result === PurchaseResult.Success,
  ).length;
  const soldOutCount = records.filter(
    (r) => r.result === PurchaseResult.SoldOut,
  ).length;
  const alreadyPurchasedCount = records.filter(
    (r) => r.result === PurchaseResult.AlreadyPurchased,
  ).length;
  const notActiveCount = records.filter(
    (r) => r.result === PurchaseResult.NotActive,
  ).length;

  const latencies = records.map((r) => r.latencyMs).sort((a, b) => a - b);
  const throughputPerSec = records.length / (totalDurationMs / 1000);

  const mongoCount = await purchaseModel.countDocuments();
  const finalStockRaw = await redis.get(STOCK_KEY);
  const finalStock = finalStockRaw !== null ? parseInt(finalStockRaw, 10) : NaN;
  const purchasedSetSize = await redis.scard(PURCHASED_SET_KEY);

  const checks: Array<{ label: string; pass: boolean; detail: string }> = [
    {
      label: 'Exactly STOCK successes',
      pass: successCount === STOCK,
      detail: `successCount=${successCount}, expected=${STOCK}`,
    },
    {
      label: 'No user ever succeeded twice',
      pass: duplicateSuccesses.length === 0,
      detail:
        duplicateSuccesses.length === 0
          ? 'no duplicate successes observed'
          : `duplicate successes for: ${duplicateSuccesses.join(', ')}`,
    },
    {
      label: 'Mongo ledger matches Redis-confirmed successes',
      pass: mongoCount === STOCK,
      detail: `Purchase.countDocuments()=${mongoCount}, expected=${STOCK}`,
    },
    {
      label: 'Redis stock counter depleted to exactly zero, never negative',
      pass: finalStock === 0,
      detail: `final stock=${finalStock}`,
    },
    {
      label: 'Redis purchased-set size matches successes',
      pass: purchasedSetSize === STOCK,
      detail: `SCARD=${purchasedSetSize}, expected=${STOCK}`,
    },
  ];

  console.log('--- Result breakdown ---');
  console.log(`  success:           ${successCount}`);
  console.log(`  sold_out:          ${soldOutCount}`);
  console.log(`  already_purchased: ${alreadyPurchasedCount}`);
  console.log(`  not_active:        ${notActiveCount}`);
  console.log(`  total attempts:    ${records.length}\n`);

  console.log('--- Throughput / latency ---');
  console.log(`  duration:     ${(totalDurationMs / 1000).toFixed(2)}s`);
  console.log(`  concurrency:  ${CONCURRENCY}`);
  console.log(`  throughput:   ${throughputPerSec.toFixed(1)} req/s`);
  console.log(`  p50 latency:  ${percentile(latencies, 50).toFixed(2)}ms`);
  console.log(`  p95 latency:  ${percentile(latencies, 95).toFixed(2)}ms`);
  console.log(`  p99 latency:  ${percentile(latencies, 99).toFixed(2)}ms\n`);

  console.log('--- Correctness checks ---');
  let allPassed = true;
  for (const check of checks) {
    allPassed = allPassed && check.pass;
    console.log(
      `  [${check.pass ? 'PASS' : 'FAIL'}] ${check.label} — ${check.detail}`,
    );
  }

  await redis.quit();
  await app.close();

  if (!allPassed) {
    console.error('\nSTRESS TEST FAILED — see failing checks above.');
    process.exit(1);
  }
  console.log('\nSTRESS TEST PASSED.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Stress test crashed:', err);
  process.exit(1);
});
