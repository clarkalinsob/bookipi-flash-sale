import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SaleModule } from '../sale/sale.module';
import { PurchaseService } from './purchase.service';
import { Purchase, PurchaseSchema } from './schemas/purchase.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Purchase.name, schema: PurchaseSchema },
    ]),
    SaleModule,
  ],
  providers: [PurchaseService],
  exports: [PurchaseService],
})
export class PurchaseModule {}
