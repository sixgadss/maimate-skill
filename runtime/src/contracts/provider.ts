/** Domain contract shared by the fixture provider and validated MCP adapter. */
export type ISODateTime = string;
export type Channel = 'pickup' | 'dine_in' | 'delivery' | 'drive_through';
export type Money = { currency: 'CNY'; amountFen: number };
// Runtime validators require nonnegative Number.isSafeInteger(amountFen).

export interface SourceMeta {
  provider: string;
  tool: string;
  observedAt: ISODateTime;
  validUntil: ISODateTime | null;
  schemaVersion: string;
  mode: 'live' | 'fixture';
  traceId?: string;
}

export type ProviderErrorCode =
  | 'UNSUPPORTED' | 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'TIMEOUT'
  | 'UNAVAILABLE' | 'INVALID_DATA' | 'NOT_SELLABLE'
  | 'PROMOTION_INELIGIBLE' | 'QUOTE_CHANGED' | 'UNKNOWN_WRITE_STATE';

export type ProviderResult<T> =
  | { ok: true; data: T; meta: SourceMeta }
  | { ok: false; error: {
      code: ProviderErrorCode;
      message: string;
      retryable: boolean;
      retryAfterMs?: number;
      traceId?: string;
    } };

export interface ProviderCapabilities {
  menu: boolean;
  coupons: boolean;
  authoritativeQuote: boolean;
  nutrition: boolean;
  promotions: boolean;
  orderHistory: boolean;
  points: boolean;
  createOrder: boolean;
  orderLookup: boolean;
  upstreamIdempotency: boolean;
  // Flags describe verified account capabilities, not public marketing claims.
}

export interface Restaurant {
  id: string;
  businessEntityId: string | null;
  name: string;
  supportedChannels: Channel[];
  available: boolean | null;
  distanceMeters: number | null;
}

export interface PurchaseScope {
  restaurantId: string;
  businessEntityId: string | null;
  channel: Channel;
  addressRef: string | null;
  pickupMethod: string | null;
  serviceAt: ISODateTime;
  timezone: string;
  partySize: number;
}

export interface Nutrition {
  energyKcal: number | null;
  proteinG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  basis: 'per_serving';
  evidenceId: string;
}

export interface Product {
  productId: string;
  variantId: string | null;
  name: string;
  category: 'main' | 'side' | 'drink' | 'set' | 'unknown';
  foodTags: string[] | null; // Verified traits such as chicken; null is unknown.
  saleStatus: 'available' | 'unavailable' | 'unknown';
  menuPrice: Money | null;
  nutrition: Nutrition | null;
  dietary: {
    sugarFree: boolean | null;
    addedSugar: boolean | null;
    allergens: string[] | null;
    evidenceId: string | null;
  };
  configurationRefs: string[];
  evidenceId: string;
}

export interface MenuSnapshot {
  scope: PurchaseScope;
  products: Product[];
  snapshotId: string;
}

export interface ProductDetails {
  product: Product;
  allowedConfigurations: Array<{
    ref: string;
    label: string;
    components: BasketItem[];
    // Ref points to validated native configuration owned by the adapter.
  }>;
}

export interface Coupon {
  id: string;
  title: string;
  held: boolean;
  validFrom: ISODateTime | null;
  validUntil: ISODateTime | null;
  eligibility: 'eligible' | 'ineligible' | 'needs_quote';
  stacking: 'verified' | 'unknown';
  evidenceId: string;
}

export interface Promotion {
  id: string;
  title: string;
  informationalOnly: true;
  evidenceId: string;
}

export interface PointsBalance {
  available: number;
  evidenceId: string;
}

export interface BasketItem {
  productId: string;
  variantId: string | null;
  configurationRef: string | null;
  quantity: number;
}

export interface QuoteRequest {
  scope: PurchaseScope;
  items: BasketItem[];
  couponIds: string[];
  pointsPlanRef: string | null;
  tablewareRequested: boolean;
}

export interface OrderQuote {
  quoteId: string; // Local handle; does not imply an upstream price lock.
  basketHash: string;
  snapshotHash: string;
  request: QuoteRequest;
  itemsSubtotal: Money;
  requiredFees: Array<{ kind: string; amount: Money }>;
  discounts: Array<{ id: string; amount: Money; evidenceId: string }>;
  payable: Money;
  completeFees: boolean;
  verifiedTotal: boolean;
  pointsRequired: number;
  sellable: boolean;
  observedAt: ISODateTime;
  validUntil: ISODateTime;
  evidenceId: string;
}

export interface OrderReceipt {
  orderId: string;
  provider: string;
  scope: PurchaseScope;
  items: BasketItem[];
  status: 'created' | 'awaiting_payment' | 'paid' | 'completed'
    | 'cancelled' | 'failed' | 'unknown';
  payable: Money | null;
  paymentUrl: string | null;
  createdAt: ISODateTime;
  evidenceId: string;
}

export interface OrderHistory {
  orders: OrderReceipt[];
  coverage: 'partial' | 'complete';
  // 'complete' requires an explicit provider guarantee for the requested window.
  since: ISODateTime | null;
  nextCursor: string | null;
}

export interface CreateOrderRequest {
  quoteId: string;
  expectedSnapshotHash: string;
  idempotencyKey: string; // Local duplicate protection unless upstream supports it.
  remark: string | null;
}

export interface McDonaldsProvider {
  capabilities(): Promise<ProviderResult<ProviderCapabilities>>;
  getNearbyRestaurants(input: {
    city?: string;
    keyword?: string;
    coordinates?: { longitude: number; latitude: number };
    channel: Exclude<Channel, 'delivery'>;
  }): Promise<ProviderResult<Restaurant[]>>;
  getDeliveryRestaurants(addressRef: string): Promise<ProviderResult<Restaurant[]>>;
  getMenu(scope: PurchaseScope): Promise<ProviderResult<MenuSnapshot>>;
  getProductDetails(input: {
    scope: PurchaseScope; productId: string;
    variantId: string | null; configurationRef: string | null;
  }): Promise<ProviderResult<ProductDetails>>;
  getNutrition(input: {
    scope: PurchaseScope; items: BasketItem[];
  }): Promise<ProviderResult<
    Array<{
      productId: string;
      variantId: string | null;
      configurationRef: string | null;
      nutrition: Nutrition | null; // Per configured serving, quantity applied once.
    }>
  >>;
  getAvailablePromotions(scope: PurchaseScope): Promise<ProviderResult<Promotion[]>>;
  getUserCoupons(scope: PurchaseScope): Promise<ProviderResult<Coupon[]>>;
  getUserPoints(): Promise<ProviderResult<PointsBalance>>;
  getRecentOrders(limit: number): Promise<ProviderResult<OrderHistory>>;
  calculateOrder(input: QuoteRequest): Promise<ProviderResult<OrderQuote>>;
  createOrder(input: CreateOrderRequest): Promise<ProviderResult<OrderReceipt>>;
  getOrder(orderId: string): Promise<ProviderResult<OrderReceipt>>;
}
