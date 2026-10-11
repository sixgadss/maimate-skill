import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { BasketItem, OrderQuote } from '../contracts/provider.js';

export const safeInt = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const iso = z.string().datetime({ offset: true });
export const moneySchema = z.object({ currency: z.literal('CNY'), amountFen: safeInt }).strict();
export const itemSchema = z.object({ productId: z.string().min(1), variantId: z.string().nullable(),
  configurationRef: z.string().nullable(), quantity: safeInt.min(1).max(100) }).strict();
export const channelSchema = z.enum(['pickup', 'dine_in', 'delivery', 'drive_through']);
export const mealPeriodSchema = z.enum(['breakfast', 'lunch', 'dinner', 'late_night']);
export const scopeSchema = z.object({ restaurantId: z.string().min(1), businessEntityId: z.string().nullable(),
  channel: channelSchema, addressRef: z.string().nullable(), pickupMethod: z.string().nullable(),
  serviceAt: iso, timezone: z.string().min(1), partySize: safeInt.min(1).max(20) }).strict();
export const quoteRequestSchema = z.object({ scope: scopeSchema, items: z.array(itemSchema).min(1).max(40),
  couponIds: z.array(z.string()).max(10), pointsPlanRef: z.string().nullable(),
  tablewareRequested: z.boolean() }).strict();
export const quoteSchema = z.object({ quoteId: z.string().min(1), basketHash: z.string(), snapshotHash: z.string(),
  request: quoteRequestSchema, itemsSubtotal: moneySchema,
  requiredFees: z.array(z.object({ kind: z.string(), amount: moneySchema })),
  discounts: z.array(z.object({ id: z.string(), amount: moneySchema, evidenceId: z.string() })),
  payable: moneySchema, completeFees: z.boolean(), verifiedTotal: z.boolean(), pointsRequired: safeInt,
  sellable: z.boolean(), observedAt: iso, validUntil: iso, evidenceId: z.string().min(1) }).strict();

export const intentSchema = z.object({ mode: z.enum(['default', 'value', 'post_workout', 'explore', 'hurry', 'usual']).optional(),
  chooseOne: z.boolean().optional(), budgetMaxFen: safeInt.optional(), partySize: safeInt.min(1).max(20).optional(),
  channel: channelSchema.optional(), restaurantId: z.string().min(1).optional(), addressRef: z.string().optional(),
  serviceAt: iso.optional(), mealPeriod: mealPeriodSchema.optional(), timeBudgetMinutes: safeInt.min(1).optional(),
  goal: z.enum(['satisfying', 'protein', 'lower_energy', 'no_repetition']).optional(),
  maxEnergyKcal: z.number().finite().nonnegative().optional(), excludedAllergens: z.array(z.string()).optional(),
  avoidSugaryDrinks: z.boolean().optional(), avoidAddedSugar: z.boolean().optional(),
  excludedFoodTags: z.array(z.string()).optional(), excludedProductIds: z.array(z.string()).optional(),
  sessionPreferenceExceptions: z.array(z.string()).optional() }).strict();
export const recommendSchema = z.object({ userTurnRef: z.string().min(1).max(200),
  utterance: z.string().min(1).max(5000), intent: intentSchema }).strict();

export function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function canonicalFingerprint(items: BasketItem[]): string {
  const normalized = new Map<string, { item: BasketItem; quantity: number }>();
  for (const raw of items) {
    const item = itemSchema.parse(raw);
    const key = JSON.stringify([item.productId, item.variantId, item.configurationRef]);
    const quantity = (normalized.get(key)?.quantity ?? 0) + item.quantity;
    if (!Number.isSafeInteger(quantity) || quantity > 100) throw new Error('Invalid combined quantity');
    normalized.set(key, { item, quantity });
  }
  return stableHash([...normalized.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, v.quantity]));
}
export function validateQuote(input: unknown): OrderQuote {
  const q = quoteSchema.parse(input);
  const total = q.itemsSubtotal.amountFen + q.requiredFees.reduce((n, x) => n + x.amount.amountFen, 0)
    - q.discounts.reduce((n, x) => n + x.amount.amountFen, 0);
  if (!Number.isSafeInteger(total) || total !== q.payable.amountFen) throw new Error('Quote arithmetic mismatch');
  if (Date.parse(q.validUntil) <= Date.parse(q.observedAt)) throw new Error('Invalid quote validity');
  return q;
}
