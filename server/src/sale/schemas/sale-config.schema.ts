import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true })
export class SaleConfig {
  @Prop({ required: true })
  productName: string;

  @Prop({ required: true, min: 0 })
  totalStock: number;

  @Prop({ required: true })
  startTime: Date;

  @Prop({ required: true })
  endTime: Date;
}

export type SaleConfigDocument = HydratedDocument<SaleConfig>;
export const SaleConfigSchema = SchemaFactory.createForClass(SaleConfig);
