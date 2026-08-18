export type SaleStatusValue = 'upcoming' | 'active' | 'ended';

export interface SaleStatus {
  status: SaleStatusValue;
  startTime: Date;
  endTime: Date;
  stockRemaining: number;
}
