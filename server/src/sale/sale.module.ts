import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SaleService } from './sale.service';
import { SaleConfig, SaleConfigSchema } from './schemas/sale-config.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SaleConfig.name, schema: SaleConfigSchema },
    ]),
  ],
  providers: [SaleService],
  exports: [SaleService],
})
export class SaleModule {}
