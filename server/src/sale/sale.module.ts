import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SaleController } from './sale.controller';
import { SaleService } from './sale.service';
import { SaleConfig, SaleConfigSchema } from './schemas/sale-config.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SaleConfig.name, schema: SaleConfigSchema },
    ]),
  ],
  controllers: [SaleController],
  providers: [SaleService],
  exports: [SaleService],
})
export class SaleModule {}
