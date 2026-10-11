import type { BasketItem, Product } from '../contracts/provider.js';
import type { MealContext } from '../contracts/runtime.js';
import { canonicalFingerprint } from './schemas.js';
import { productRejection } from './constraints.js';

export function generateCandidates(products: Product[], ctx: MealContext, max = 80): BasketItem[][] {
  const usable = [...products].filter(p => productRejection(p,ctx)===null)
    .sort((a, b) => a.productId.localeCompare(b.productId) || (a.variantId ?? '').localeCompare(b.variantId ?? ''));
  const mains = usable.filter(p => p.category === 'main' || p.category === 'set').slice(0, 6);
  const sides = usable.filter(p => p.category === 'side').slice(0, 6);
  const drinks = usable.filter(p => p.category === 'drink').slice(0, 6);
  const item = (p: Product): BasketItem => ({ productId: p.productId, variantId: p.variantId,
    configurationRef: null, quantity: ctx.scope.partySize });
  const candidates: BasketItem[][] = mains.map(p => [item(p)]);
  for (const extras of [sides, drinks]) for (const main of mains.filter(p => p.category !== 'set'))
    for (const extra of extras) candidates.push([item(main), item(extra)]);
  for (const main of mains.filter(p => p.category !== 'set')) for (const side of sides)
    for (const drink of drinks) candidates.push([item(main), item(side), item(drink)]);
  const seen = new Set<string>();
  return candidates.filter(items => { const fp = canonicalFingerprint(items); if (seen.has(fp)) return false; seen.add(fp); return true; }).slice(0, max);
}
