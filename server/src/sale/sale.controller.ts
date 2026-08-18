import { Controller, Get } from '@nestjs/common';
import { SaleService } from './sale.service';

@Controller('sale')
export class SaleController {
  constructor(private readonly saleService: SaleService) {}

  @Get('status')
  async getStatus() {
    return this.saleService.getStatus();
  }
}
