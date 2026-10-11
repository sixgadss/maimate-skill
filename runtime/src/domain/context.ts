import type { Config } from '../config.js';
import type { MemorySnapshot } from '../contracts/memory.js';
import type { MealContext, RecommendRequest, RecommendationResult } from '../contracts/runtime.js';
import { recommendSchema, scopeSchema } from './schemas.js';
export type ContextResolution = { status: 'context'; context: MealContext }
  | Extract<RecommendationResult, { status: 'needs_input' }>;
export function resolveContext(raw: RecommendRequest, memory: MemorySnapshot, config: Config, now: string): ContextResolution {
  const r = recommendSchema.parse(raw), i = r.intent;
  const restaurantId = i.restaurantId ?? config.restaurantId;
  if (!restaurantId) return { status: 'needs_input', field: 'restaurantId',
    question: '准备在哪家门店吃？', reason: '门店会影响菜单与价格。' };
  const channel = i.channel ?? config.channel;
  if (!channel) return { status: 'needs_input', field: 'channel', question: '自取还是外送？', reason: '需要核验该渠道的完整费用。' };
  if (channel === 'delivery' && !i.addressRef) return { status: 'needs_input', field: 'addressRef',
    question: '用哪个已保存的配送地址？', reason: '外送门店和费用依赖地址。' };
  const serviceAt = i.serviceAt ?? now;
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: config.timezone,
    hour: '2-digit', hourCycle: 'h23' }).format(new Date(serviceAt)));
  const mealPeriod = i.mealPeriod ?? (hour < 10 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 22 ? 'dinner' : 'late_night');
  const scope = scopeSchema.parse({ restaurantId, businessEntityId: config.businessEntityId,
    channel, addressRef: i.addressRef ?? null, pickupMethod: null,
    serviceAt, timezone: config.timezone, partySize: i.partySize ?? 1 });
  const active = memory.preferences.filter(p => (p.expiresAt === null || Date.parse(p.expiresAt) > Date.parse(now))
    && (!p.scope.mealPeriod || p.scope.mealPeriod === mealPeriod)
    && (!p.scope.channel || p.scope.channel === channel)
    && (!p.scope.partySize || p.scope.partySize === scope.partySize));
  const sugarException = /今天.*(?:喝|要|选).*普通可乐|今天.*(?:不限制糖|不控制糖)/.test(r.utterance)
    && !/今天.*不(?:喝|要).*普通可乐/.test(r.utterance);
  const addedException = /今天.*(?:不限制添加糖|允许添加糖)/.test(r.utterance);
  if (i.avoidSugaryDrinks === false && !sugarException) throw new Error('Unsourced sugar exception');
  if (i.avoidAddedSugar === false && !addedException) throw new Error('Unsourced added-sugar exception');
  const exceptions = i.sessionPreferenceExceptions ?? [];
  if (exceptions.some(x => !['drink.sugar_policy', 'food.added_sugar'].includes(x))) throw new Error('Unsupported preference exception');
  if (exceptions.includes('drink.sugar_policy') && !sugarException) throw new Error('Unsourced preference exception');
  const excludes = active.filter(p => p.kind === 'explicit' && p.rule === 'exclude');
  const sugar = excludes.some(p => p.key === 'drink.sugar_policy' && p.value === 'avoid_sugary_drinks');
  const added = excludes.some(p => p.key === 'food.added_sugar' && p.value === true);
  return { status: 'context', context: { scope, mealPeriod, timeBudgetMinutes: i.timeBudgetMinutes ?? null,
    mode: i.mode ?? 'default', chooseOne: i.chooseOne ?? false,
    hard: { budgetMaxFen: i.budgetMaxFen ?? null, maxEnergyKcal: i.maxEnergyKcal ?? null,
      excludedProductIds: [...new Set([...(i.excludedProductIds ?? []), ...excludes.flatMap(p => p.target ? [p.target.productId] : [])])],
      excludedFoodTags: [...new Set([...(i.excludedFoodTags ?? []), ...excludes.filter(p => p.key.startsWith('food.tag.')).map(p => p.key.slice(9))])],
      excludedAllergens: [...new Set([...(i.excludedAllergens ?? []), ...excludes.filter(p => p.key.startsWith('allergen:')).map(p => p.key.slice(9))])],
      avoidSugaryDrinks: i.avoidSugaryDrinks ?? (sugar && !sugarException),
      avoidAddedSugar: i.avoidAddedSugar ?? (added && !addedException) },
    goals: i.goal ? [i.goal] : i.mode === 'post_workout' ? ['protein'] : [],
    sessionPreferenceExceptions: sugarException ? [...new Set([...exceptions, 'drink.sugar_policy'])] : exceptions,
    sourceRefs: [r.userTurnRef, ...active.flatMap(p => p.sourceEventIds)] } };
}
