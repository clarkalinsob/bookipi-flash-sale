/**
 * Shared Redis key names for the single-product flash sale.
 * There is exactly one sale in this system, so keys are static rather than
 * templated per-sale-id (see PRD: "Single product, predefined limited stock").
 */
export const STOCK_KEY = 'sale:stock';
export const PURCHASED_SET_KEY = 'sale:purchased-users';
