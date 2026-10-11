import { readFileSync } from 'node:fs';
import type { McDonaldsProvider, Product, OrderReceipt, ProviderResult, ProviderErrorCode,
  SourceMeta, PurchaseScope, QuoteRequest, OrderQuote, CreateOrderRequest, Coupon } from '../contracts/provider.js';
import { canonicalFingerprint, quoteRequestSchema, scopeSchema, stableHash, validateQuote } from '../domain/schemas.js';

export interface FixtureOptions { deliveryFeeFen?: number | null; products?: Product[]; orders?: OrderReceipt[]; }
export class FixtureProvider implements McDonaldsProvider {
  readonly products: Product[];
  readonly orders: OrderReceipt[];
  private fee: number | null;
  constructor(private clock: () => string = () => new Date().toISOString(), options: FixtureOptions = {}) {
    this.fee = options.deliveryFeeFen === undefined ? 400 : options.deliveryFeeFen;
    this.orders = structuredClone(options.orders ?? []);
    const catalog = JSON.parse(readFileSync(new URL('../../fixtures/synthetic/catalog.json', import.meta.url), 'utf8')) as {
      products: Array<{ id: string; name: string; category: Product['category']; priceFen: number;
        energyKcal: number; proteinG: number; sugarG: number; tags: string[]; addedSugar: boolean }> };
    this.products = structuredClone(options.products ?? catalog.products.map(p => ({
      productId: p.id, variantId: null, name: p.name, category: p.category,
      foodTags: p.tags, saleStatus: 'available' as const, menuPrice: { currency: 'CNY' as const, amountFen: p.priceFen },
      nutrition: { energyKcal: p.energyKcal, proteinG: p.proteinG, sugarG: p.sugarG,
        sodiumMg: null, basis: 'per_serving' as const, evidenceId: `fixture:nutrition:${p.id}` },
      dietary: { sugarFree: p.sugarG === 0, addedSugar: p.addedSugar, allergens: [], evidenceId: `fixture:dietary:${p.id}` },
      configurationRefs: [], evidenceId: `fixture:product:${p.id}` })));
  }
  private meta(tool: string): SourceMeta { return { provider: 'synthetic', tool, observedAt: this.clock(),
    validUntil: null, schemaVersion: 'fixture-v1', mode: 'fixture' }; }
  private ok<T>(data: T, tool: string): ProviderResult<T> { return { ok: true, data: structuredClone(data), meta: this.meta(tool) }; }
  private fail<T>(code: ProviderErrorCode, message: string): ProviderResult<T> {
    return { ok: false, error: { code, message, retryable: false } };
  }
  async capabilities() { return this.ok({ menu: true, coupons: true, authoritativeQuote: true, nutrition: true,
    promotions: false, orderHistory: true, points: false, createOrder: false, orderLookup: true,
    upstreamIdempotency: false }, 'capabilities'); }
  async getNearbyRestaurants() { return this.ok([{ id: 'demo-store', businessEntityId: null,
    name: '演示门店', supportedChannels: ['pickup', 'dine_in', 'delivery', 'drive_through'] as PurchaseScope['channel'][],
    available: true, distanceMeters: null }], 'nearby'); }
  async getDeliveryRestaurants(_addressRef: string) { return this.getNearbyRestaurants(); }
  async getMenu(scope: PurchaseScope) {
    const checked = scopeSchema.parse(scope);
    if (checked.restaurantId !== 'demo-store') return this.fail<{ scope: PurchaseScope; products: Product[]; snapshotId: string }>('UNAVAILABLE', 'Unknown synthetic store');
    return this.ok({ scope: checked, products: this.products, snapshotId: stableHash([checked, this.clock()]) }, 'menu');
  }
  async getProductDetails(input: { scope: PurchaseScope; productId: string; variantId: string | null; configurationRef: string | null }) {
    const product = this.products.find(p => p.productId === input.productId && p.variantId === input.variantId);
    if (!product || input.configurationRef) return this.fail<{ product: Product; allowedConfigurations: [] }>('NOT_SELLABLE', 'Unknown synthetic configuration');
    return this.ok({ product, allowedConfigurations: [] }, 'details');
  }
  async getNutrition(input: { scope: PurchaseScope; items: QuoteRequest['items'] }) {
    return this.ok(input.items.map(item => ({ productId: item.productId, variantId: item.variantId,
      configurationRef: item.configurationRef, nutrition: item.configurationRef ? null : this.products.find(p =>
        p.productId === item.productId && p.variantId === item.variantId)?.nutrition ?? null })), 'nutrition');
  }
  async getUserCoupons(_scope: PurchaseScope) {
    const coupons: Coupon[] = [
      { id: 'chicken-discount', title: '演示鸡肉券', held: true, validFrom: null, validUntil: '2099-01-01T00:00:00Z', eligibility: 'needs_quote', stacking: 'verified', evidenceId: 'fixture:coupon:chicken' },
      { id: 'other-discount', title: '演示其他券', held: true, validFrom: null, validUntil: '2099-01-01T00:00:00Z', eligibility: 'needs_quote', stacking: 'verified', evidenceId: 'fixture:coupon:other' },
      { id: 'unheld', title: '演示未持有券', held: false, validFrom: null, validUntil: null, eligibility: 'ineligible', stacking: 'unknown', evidenceId: 'fixture:coupon:unheld' },
      { id: 'expired', title: '演示过期券', held: true, validFrom: null, validUntil: '2020-01-01T00:00:00Z', eligibility: 'ineligible', stacking: 'unknown', evidenceId: 'fixture:coupon:expired' }
    ];
    return this.ok(coupons, 'coupons');
  }
  async getAvailablePromotions(_scope: PurchaseScope) { return this.fail<never[]>('UNSUPPORTED', 'No synthetic campaigns'); }
  async getUserPoints() { return this.fail<{ available: number; evidenceId: string }>('UNSUPPORTED', 'Points spending is disabled'); }
  async getRecentOrders(limit: number) {
    return this.ok({ orders: this.orders.slice(0, limit), coverage: 'partial' as const, since: null, nextCursor: null }, 'orders');
  }
  async calculateOrder(raw: QuoteRequest): Promise<ProviderResult<OrderQuote>> {
    const parsed = quoteRequestSchema.safeParse(raw);
    if (!parsed.success) return this.fail('INVALID_DATA', 'Invalid synthetic basket');
    const r = parsed.data;
    if (r.pointsPlanRef) return this.fail('UNSUPPORTED', 'Points are disabled');
    if (r.scope.restaurantId !== 'demo-store' || (r.scope.channel === 'delivery' && !r.scope.addressRef))
      return this.fail('UNAVAILABLE', 'Synthetic scope is incomplete');
    let subtotal = 0;
    for (const item of r.items) {
      const p = this.products.find(p => p.productId === item.productId && p.variantId === item.variantId);
      if (!p || p.saleStatus !== 'available' || !p.menuPrice || item.configurationRef)
        return this.fail('NOT_SELLABLE', 'Synthetic item is not sellable');
      subtotal += p.menuPrice.amountFen * item.quantity;
    }
    const discount = r.couponIds[0] === 'chicken-discount' && r.items.some(i => i.productId === 'chicken') ? 200 : 0;
    if (r.couponIds.length > 1 || (r.couponIds.length && !discount))
      return this.fail('PROMOTION_INELIGIBLE', 'Synthetic coupon is unavailable or incompatible');
    const delivery = r.scope.channel === 'delivery';
    const fee = delivery ? this.fee : 0;
    const now = this.clock();
    const requiredFees = fee ? [{ kind: 'delivery', amount: { currency: 'CNY' as const, amountFen: fee } }] : [];
    const total = subtotal + (fee ?? 0) - discount;
    const basketHash = canonicalFingerprint(r.items);
    const snapshotHash = stableHash([r, subtotal, requiredFees, discount, total]);
    const q = validateQuote({ quoteId: `fixture:q:${snapshotHash}`, basketHash, snapshotHash, request: r,
      itemsSubtotal: { currency: 'CNY', amountFen: subtotal }, requiredFees,
      discounts: discount ? [{ id: 'chicken-discount', amount: { currency: 'CNY', amountFen: discount }, evidenceId: 'fixture:coupon:chicken' }] : [],
      payable: { currency: 'CNY', amountFen: total }, completeFees: fee !== null, verifiedTotal: fee !== null,
      pointsRequired: 0, sellable: true, observedAt: now,
      validUntil: new Date(Date.parse(now) + 30_000).toISOString(), evidenceId: `fixture:quote:${snapshotHash}` });
    return this.ok(q, 'calculate');
  }
  async createOrder(_r: CreateOrderRequest) { return this.fail<OrderReceipt>('UNSUPPORTED', 'External ordering is disabled'); }
  async getOrder(orderId: string) {
    const order = this.orders.find(o => o.orderId === orderId);
    return order ? this.ok(order, 'order') : this.fail<OrderReceipt>('UNAVAILABLE', 'Unknown synthetic order');
  }
}
