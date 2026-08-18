import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true })
export class Purchase {
  // Unique index is the durable-side backstop for "one item per user" —
  // Redis (via purchase.lua) is what actually enforces it under load.
  @Prop({ required: true, unique: true, index: true })
  userId: string;
}

export type PurchaseDocument = HydratedDocument<Purchase>;
export const PurchaseSchema = SchemaFactory.createForClass(Purchase);
