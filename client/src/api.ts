const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export type SaleStatusValue = 'upcoming' | 'active' | 'ended';

export interface SaleStatus {
  status: SaleStatusValue;
  startTime: string;
  endTime: string;
  stockRemaining: number;
}

export type PurchaseResult =
  | 'success'
  | 'sold_out'
  | 'already_purchased'
  | 'not_active';

export class ApiError extends Error {}

interface ErrorResponseBody {
  message?: string | string[];
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorResponseBody | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(', ')
      : body?.message;
    throw new ApiError(message ?? `Request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function getSaleStatus(): Promise<SaleStatus> {
  return fetch(`${API_BASE_URL}/sale/status`).then((res) =>
    parseJsonOrThrow<SaleStatus>(res),
  );
}

export function attemptPurchase(
  userId: string,
): Promise<{ result: PurchaseResult }> {
  return fetch(`${API_BASE_URL}/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  }).then((res) => parseJsonOrThrow<{ result: PurchaseResult }>(res));
}
