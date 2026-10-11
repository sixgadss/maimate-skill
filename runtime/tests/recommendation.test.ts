import { describe, it, expect } from 'vitest';
import { FixtureProvider } from '../src/providers/fixture-provider.js';
import { recommendMeals } from '../src/domain/engine.js';
import { computeScore } from '../src/domain/scoring.js';
import { defaultConfig } from '../src/config.js';
import { context, memory, NOW, product } from './helpers.js';
import type { Product, ProviderResult, OrderQuote, QuoteRequest } from '../src/contracts/provider.js';
import type { MealContext } from '../src/contracts/runtime.js';

async function run(ctx = context(), products?: Product[], transform?: (q: ProviderResult<OrderQuote>) => ProviderResult<OrderQuote>, mem = memory()) {
  const p = new FixtureProvider(() => NOW, { products });
  const coupons = await p.getUserCoupons(ctx.scope);
  return recommendMeals({ products: p.products, coupons: coupons.ok ? coupons.data : [], context: ctx, memory: mem,
    config: defaultConfig(), now: NOW, mode: 'fixture',
    quote: async (r: QuoteRequest) => { const q = await p.calculateOrder(r); return transform ? transform(q) : q; } });
}
describe('deterministic meal selection', () => {
  it('returns at most three distinct satisfying meals with full price within hard budget', async () => {
    const ctx = context(); ctx.hard.budgetMaxFen = 2000; ctx.goals = ['satisfying'];
    const r = await run(ctx);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.options.length).toBeGreaterThan(0); expect(r.options.length).toBeLessThanOrEqual(3);
    expect(new Set(r.options.map(o => o.mealFingerprint)).size).toBe(r.options.length);
    for (const o of r.options) { expect(o.quote.payable.amountFen).toBeLessThanOrEqual(2000);
      expect(o.items.some(i => ['chicken', 'beef', 'fish'].includes(i.productId))).toBe(true); }
    expect(await run(ctx)).toEqual(r);
  });
  it('returns exactly one on chooseOne and favors verified protein after workout', async () => {
    const ctx = context(); ctx.chooseOne = true; ctx.mode = 'post_workout'; ctx.goals = ['protein']; ctx.hard.budgetMaxFen = 2000;
    const r = await run(ctx); expect(r.status).toBe('ready');
    if (r.status === 'ready') { expect(r.options).toHaveLength(1);
      expect(r.options[0]!.items.some(i => i.productId === 'chicken')).toBe(true); }
  });
  it('does not turn unknown nutrition, sugary drinks or tags into verified hard compliance', async () => {
    const p = product(); p.nutrition = null; p.foodTags = null;
    const ctx = context(); ctx.hard.maxEnergyKcal = 600;
    expect(await run(ctx, [p])).toMatchObject({ status: 'unavailable' });
    ctx.hard.maxEnergyKcal = null; ctx.hard.excludedFoodTags = ['chicken'];
    expect(await run(ctx, [p])).toMatchObject({ status: 'unavailable' });
    const sugar = context(); sugar.hard.avoidSugaryDrinks = true;
    const r = await run(sugar); if (r.status !== 'ready') throw new Error('Expected valid no-sugar meals');
    expect(r.options.flatMap(o => o.items).some(i => i.productId === 'cola')).toBe(false);
  });
  it('rejects unavailable or unknown stock and unknown hard allergen data', async () => {
    const p = product(); const c = context(); c.hard.excludedAllergens = ['milk']; p.dietary.allergens = null;
    expect(await run(c, [p])).toMatchObject({ status: 'unavailable' });
    for (const saleStatus of ['unknown', 'unavailable'] as const) {
      expect(await run(context(), [{ ...product(), saleStatus }])).toMatchObject({ status: 'unavailable' });
    }
  });
  it('rejects tampered scope, expired quotes or incomplete fees', async () => {
    for (const tamper of [
      (q: OrderQuote) => { q.request.scope.restaurantId = 'other-store'; },
      (q: OrderQuote) => { q.validUntil = '2026-10-10T03:59:59Z'; },
      (q: OrderQuote) => { q.completeFees = false; },
      (q: OrderQuote) => { q.request.items[0]!.quantity += 1; }
    ]) {
      const result = await run(context(), undefined, q => { if (q.ok) tamper(q.data); return q; });
      expect(result.status).toBe('unavailable');
    }
  });
  it('reorders the exact usual meal rather than making it compete', async () => {
    const m = memory(); m.usual = { sourceOrderId: 'past', userNamed: false, label: null, scope: { mealPeriod: 'lunch', channel: 'pickup', partySize: 1 },
      items: [{ productId: 'fish', variantId: null, configurationRef: null, quantity: 1 }] };
    const c = context(); c.mode = 'usual';
    const r = await run(c, undefined, undefined, m);
    expect(r).toMatchObject({ status: 'ready', options: [{ items: m.usual.items }] });
    if (r.status === 'ready') expect(r.options).toHaveLength(1);
    c.hard.excludedProductIds = ['fish'];
    const changed = await run(c, undefined, undefined, m);
    expect(changed.status).toBe('ready');
    if (changed.status === 'ready') { expect(changed.notices.length).toBeGreaterThan(0);
      expect(changed.options[0]!.items.some(i => i.productId === 'fish')).toBe(false); }
  });
  it('does not loosen impossible budget or equate sides with a meal', async () => {
    const c = context(); c.hard.budgetMaxFen = 1;
    expect(await run(c)).toMatchObject({ status: 'unavailable', reason: 'no_feasible_meal' });
    expect(await run(context(), [{ ...product(), category: 'side' }])).toMatchObject({ status: 'unavailable' });
  });
  it('missing active soft features cannot gain a denominator advantage', () => {
    const c = context(); c.mode = 'post_workout'; c.goals = ['protein'];
    const features = { preference: .5, context: 1, value: .5, nutrition: .8, novelty: .5, availability: 1 };
    expect(computeScore(features, c, 0).total).toBeGreaterThan(computeScore({ ...features, nutrition: null }, c, 0).total);
    c.goals = []; c.mode = 'default';
    expect(computeScore(features, c, 0).weights.nutrition).toBe(0);
  });
});
