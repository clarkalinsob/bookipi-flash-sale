import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PurchaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  userId: string;
}
