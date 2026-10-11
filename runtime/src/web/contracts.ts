import { z } from 'zod';
export const webMealInput = z.object({
  budgetMaxFen: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  avoidSugaryDrinks: z.boolean(), excludeChicken: z.boolean(),
}).strict();
export type WebMealInput = z.infer<typeof webMealInput>;
export interface WebStatus { mode: 'fixture' | 'live'; state: 'available' | 'unavailable'; restaurantId: string | null; }
export interface RestrictionEvidence {
  restriction: 'sugar' | 'chicken';
  basis: 'no_drink' | 'dietary_metadata' | 'nutrition' | 'food_tags';
  productId: string | null; productName: string | null;
  value: number | boolean | null; evidenceIds: string[];
}
export interface WebMeal {
  items: Array<{ productId: string; name: string; quantity: number }>;
  budgetFen: number; payableFen: number; subtotalFen: number;
  fees: Array<{ label: string; amountFen: number }>;
  discounts: Array<{ label: string; amountFen: number }>;
  reasons: string[]; evidence: string[]; restrictionEvidence: RestrictionEvidence[]; observedAt: string; validUntil: string;
  restaurantId: string; channel: 'pickup'; source: string;
}
export type WebMealResponse =
 | { status: 'ready'; mode: 'fixture' | 'live'; meal: WebMeal }
 | { status: 'needs_input' | 'unavailable'; mode: 'fixture' | 'live'; message: string };
