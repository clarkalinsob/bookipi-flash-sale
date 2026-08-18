import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { PurchaseService } from './purchase.service';
import { PurchaseDto } from './dto/purchase.dto';

@Controller('purchase')
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  // Always 200 — the outcome (success/sold_out/already_purchased/not_active)
  // lives in the response body, not the status code. A 201 default would
  // be wrong for the outcomes where nothing was actually created.
  @Post()
  @HttpCode(HttpStatus.OK)
  async purchase(@Body() dto: PurchaseDto) {
    const result = await this.purchaseService.attemptPurchase(dto.userId);
    return { result };
  }

  @Get(':userId')
  async getPurchaseStatus(@Param('userId') userId: string) {
    const hasPurchased = await this.purchaseService.hasPurchased(userId);
    return { hasPurchased };
  }
}
