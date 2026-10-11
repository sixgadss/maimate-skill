import type { BasketItem, Product, OrderQuote } from '../contracts/provider.js';
import type { MealContext } from '../contracts/runtime.js';
import { canonicalFingerprint, scopeSchema, stableHash, validateQuote } from './schemas.js';

export interface FeasibleMeal { items: BasketItem[]; products: Product[]; quote: OrderQuote;
  fingerprint: string; proteinG: number | null; energyKcal: number | null; }
/** Only product facts here; authoritative quote and whole-basket limits are checked later. */
export function productRejection(p:Product,ctx:MealContext):string|null {
  if(p.saleStatus!=='available') return 'NOT_SELLABLE';
  if(ctx.hard.excludedProductIds.includes(p.productId)) return 'EXCLUDED_PRODUCT';
  if(ctx.hard.excludedFoodTags.length && (p.foodTags===null || ctx.hard.excludedFoodTags.some(t=>p.foodTags!.includes(t)))) return 'EXCLUDED_OR_UNKNOWN_TAG';
  if(ctx.hard.excludedAllergens.length && (p.dietary.allergens===null || ctx.hard.excludedAllergens.some(a=>p.dietary.allergens!.includes(a)))) return 'ALLERGEN_OR_UNKNOWN';
  if(ctx.hard.avoidAddedSugar && p.dietary.addedSugar!==false) return 'ADDED_SUGAR_OR_UNKNOWN';
  // Aggregate set sugar cannot identify its drink. No verified set components exist in this milestone.
  if(ctx.hard.avoidSugaryDrinks && p.category==='set') return 'SET_DRINK_COMPONENTS_UNVERIFIED';
  if(ctx.hard.avoidSugaryDrinks && p.category==='drink' && p.dietary.sugarFree!==true && p.nutrition?.sugarG!==0) return 'SUGAR_OR_UNKNOWN';
  if(ctx.hard.maxEnergyKcal!==null && (p.nutrition?.energyKcal===null || p.nutrition?.energyKcal===undefined)) return 'ENERGY_OR_UNKNOWN';
  return null;
}
export function assessCandidate(items: BasketItem[], menu: Product[], rawQuote: OrderQuote, ctx: MealContext, now: string):
  { ok: true; meal: FeasibleMeal } | { ok: false; code: string } {
  const reject = (code: string) => ({ ok: false as const, code });
  let q: OrderQuote;
  try { q = validateQuote(rawQuote); } catch { return reject('INVALID_QUOTE'); }
  if (!q.completeFees || !q.verifiedTotal || !q.sellable) return reject('DATA_UNVERIFIED');
  if (Date.parse(q.validUntil) <= Date.parse(now) || Date.parse(q.observedAt) > Date.parse(now)) return reject('STALE_QUOTE');
  const fingerprint = canonicalFingerprint(items);
  if (q.basketHash !== fingerprint || canonicalFingerprint(q.request.items) !== fingerprint
    || stableHash(scopeSchema.parse(q.request.scope)) !== stableHash(scopeSchema.parse(ctx.scope))) return reject('QUOTE_SCOPE_MISMATCH');
  if (q.pointsRequired || q.request.pointsPlanRef || q.request.tablewareRequested) return reject('UNAUTHORIZED_EXTRAS');
  if (ctx.hard.budgetMaxFen !== null && q.payable.amountFen > ctx.hard.budgetMaxFen) return reject('OVER_BUDGET');
  const products: Product[] = [];
  for (const item of items) {
    const p = menu.find(p => p.productId === item.productId && p.variantId === item.variantId);
    if (!p || p.saleStatus !== 'available' || item.configurationRef !== null) return reject('NOT_SELLABLE');
    const code=productRejection(p,ctx); if(code) return reject(code);
    products.push(p);
  }
  if (!products.some(p => p.category === 'main' || p.category === 'set')) return reject('NO_MAIN');
  const sum = (field: 'proteinG' | 'energyKcal'): number | null => {
    if (products.some(p => p.nutrition?.[field] === null || p.nutrition?.[field] === undefined)) return null;
    return products.reduce((n, p, idx) => n + p.nutrition![field]! * items[idx]!.quantity, 0);
  };
  const proteinG = sum('proteinG'), energyKcal = sum('energyKcal');
  if (ctx.hard.maxEnergyKcal !== null && (energyKcal === null || energyKcal > ctx.hard.maxEnergyKcal)) return reject('ENERGY_OR_UNKNOWN');
  return { ok: true, meal: { items, products, quote: q, fingerprint, proteinG, energyKcal } };
}
