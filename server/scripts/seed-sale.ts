/**
 * Seeds a SaleConfig + matching Redis stock/purchased-set for manual testing,
 * Playwright fixtures, and CI. Reuses the same env vars and schema/keys as
 * the running app so seeded state always matches what the API will read.
 *
 * Usage: ts-node -r tsconfig-paths/register scripts/seed-sale.ts [--state=active] [--stock=5] [--in=3600]
 * --in only applies to --state=upcoming: seconds from now until the sale starts
 * (default 3600 = 1 hour). Use a short value (e.g. --in=30) for a live demo of
 * the frontend's countdown.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Redis from 'ioredis';
import { SaleConfigSchema } from '../src/sale/schemas/sale-config.schema';
import { STOCK_KEY, PURCHASED_SET_KEY } from '../src/redis/redis.keys';

type SaleState = 'upcoming' | 'active' | 'ended';

function parseArgs(): { state: SaleState; stock: number; inSeconds: number } {
  const args = new Map(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.replace(/^--/, '').split('=');
      return [key, value];
    }),
  );
  const state = (args.get('state') ?? 'active') as SaleState;
  const stock = parseInt(args.get('stock') ?? '5', 10);
  const inSeconds = parseInt(args.get('in') ?? '3600', 10);
  if (!['upcoming', 'active', 'ended'].includes(state)) {
    throw new Error(`Invalid --state: ${state}`);
  }
  return { state, stock, inSeconds };
}

function windowFor(
  state: SaleState,
  inSeconds: number,
): { startTime: Date; endTime: Date } {
  const now = Date.now();
  const hour = 60 * 60_000;
  switch (state) {
    case 'upcoming': {
      const startsIn = inSeconds * 1000;
      return {
        startTime: new Date(now + startsIn),
        endTime: new Date(now + startsIn + hour),
      };
    }
    case 'ended':
      return {
        startTime: new Date(now - 2 * hour),
        endTime: new Date(now - hour),
      };
    case 'active':
    default:
      return {
        startTime: new Date(now - 60_000),
        endTime: new Date(now + hour),
      };
  }
}

async function main() {
  const { state, stock, inSeconds } = parseArgs();
  const { startTime, endTime } = windowFor(state, inSeconds);

  const mongoUri =
    process.env.MONGO_URI ?? 'mongodb://localhost:27017/flash-sale';
  const redisHost = process.env.REDIS_HOST ?? 'localhost';
  const redisPort = parseInt(process.env.REDIS_PORT ?? '6379', 10);

  await mongoose.connect(mongoUri);
  const SaleConfigModel = mongoose.model('SaleConfig', SaleConfigSchema);
  const PurchaseModel = mongoose.model(
    'Purchase',
    new mongoose.Schema({}, { strict: false }),
    'purchases',
  );

  await SaleConfigModel.deleteMany({});
  await PurchaseModel.deleteMany({});
  await SaleConfigModel.create({
    productName: 'Test Widget',
    totalStock: stock,
    startTime,
    endTime,
  });
  await mongoose.disconnect();

  const redis = new Redis({ host: redisHost, port: redisPort });
  await redis.set(STOCK_KEY, stock);
  await redis.del(PURCHASED_SET_KEY);
  redis.disconnect();

  console.log(`Seeded sale: state=${state} stock=${stock}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
