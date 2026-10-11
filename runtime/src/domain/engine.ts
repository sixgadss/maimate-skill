import type { Coupon, Product, ProviderResult, OrderQuote, QuoteRequest } from '../contracts/provider.js';
import type { MealContext, RecommendationResult } from '../contracts/runtime.js';
import type { MemorySnapshot } from '../contracts/memory.js';
import type { Config } from '../config.js';
import type { BasketItem } from '../contracts/provider.js';
import type { Evidence, RecommendationOption } from '../contracts/runtime.js';
import { assessCandidate, type FeasibleMeal } from './constraints.js';
import { canonicalFingerprint, stableHash } from './schemas.js';
import { generateCandidates } from './candidates.js';
import { rankMeals } from './scoring.js';
import { selectMeals } from './selection.js';
export interface EngineInput { products: Product[]; coupons: Coupon[]; context: MealContext; memory: MemorySnapshot;
  config: Config; now: string; clock?:()=>string; mode: 'live' | 'fixture'; quote: (r: QuoteRequest) => Promise<ProviderResult<OrderQuote>>; }
export async function recommendMeals(input: EngineInput): Promise<RecommendationResult> {
  const { context: ctx, memory, now } = input;
  const rejected = new Map<string, number>();
  const notices: string[] = [];
  const evidence = new Map<string, Evidence>();
  const reject = (code: string) => rejected.set(code, (rejected.get(code) ?? 0) + 1);
  const quoteMeal = async (items: BasketItem[]): Promise<FeasibleMeal | null> => {
    const usable = input.coupons.filter(c => c.held && c.eligibility !== 'ineligible'
      && (!c.validFrom || Date.parse(c.validFrom) <= Date.parse(now)) && (!c.validUntil || Date.parse(c.validUntil) > Date.parse(now))).slice(0, 6);
    const plans = [[], ...usable.map(c => [c.id])] as string[][];
    let best: FeasibleMeal | null = null;
    for (const couponIds of plans) {
      let response: ProviderResult<OrderQuote>;
      try { response = await input.quote({ scope: ctx.scope, items, couponIds, pointsPlanRef: null, tablewareRequested: false }); }
      catch { reject('PROVIDER_FAILURE'); continue; }
      if (!response.ok) { reject(response.error.code); continue; }
      if (response.meta.mode !== input.mode || response.data.request.couponIds.join('|') !== couponIds.join('|')) { reject('SOURCE_MISMATCH'); continue; }
      const result = assessCandidate(items, input.products, response.data, ctx, input.clock?.()??now);
      if (!result.ok) { reject(result.code); continue; }
      if (!best || result.meal.quote.payable.amountFen < best.quote.payable.amountFen) best = result.meal;
      evidence.set(result.meal.quote.evidenceId, { id: result.meal.quote.evidenceId, kind: 'quote', sourceRef: response.meta.tool,
        observedAt: response.meta.observedAt, certainty: 'verified', facts: { payableFen: result.meal.quote.payable.amountFen } });
    }
    return best;
  };
  let feasible: FeasibleMeal[] = [];
  let rankingContext = ctx;
  if (ctx.mode === 'usual') {
    const usual = memory.usual;
    const matches = usual && (!usual.scope.channel || usual.scope.channel === ctx.scope.channel)
      && (!usual.scope.mealPeriod || usual.scope.mealPeriod === ctx.mealPeriod) && (!usual.scope.partySize || usual.scope.partySize === ctx.scope.partySize);
    const meal = matches ? await quoteMeal(usual.items) : null;
    if (meal) feasible = [meal];
    else { notices.push(usual ? '上次组合不符合本次可售或限制，以下是重新核验的替代方案。' : '还没有适用于这一餐的历史组合，先替你选一份。');
      rankingContext = { ...ctx, mode: 'default' }; }
  }
  if (!feasible.length) {
    let drafts = generateCandidates(input.products, rankingContext, input.config.maxCandidates);
    if (ctx.goals.includes('no_repetition') && memory.recentCompletedSoloMeals[0]) {
      const last = memory.recentCompletedSoloMeals[0];
      const mains = new Set(input.products.filter(p => ['main', 'set'].includes(p.category)).map(p => p.productId));
      const repeated = last.items.filter(i => mains.has(i.productId)).map(i => i.productId);
      drafts = drafts.filter(items => !items.some(i => repeated.includes(i.productId)));
    }
    for (let batch = 0; batch < 2 && !feasible.length; batch++) {
      const slice = drafts.slice(batch * input.config.quoteBatchSize, (batch + 1) * input.config.quoteBatchSize);
      for (let start = 0; start < slice.length; start += input.config.quoteConcurrency) {
        const results = await Promise.all(slice.slice(start, start + input.config.quoteConcurrency).map(quoteMeal));
        feasible.push(...results.filter((m): m is FeasibleMeal => m !== null));
      }
    }
  }
  if (!feasible.length) {
    const uncertain = [...rejected.keys()].some(c => ['INVALID_QUOTE', 'DATA_UNVERIFIED', 'STALE_QUOTE', 'SOURCE_MISMATCH', 'QUOTE_SCOPE_MISMATCH', 'PROVIDER_FAILURE'].includes(c));
    return { status: 'unavailable', reason: uncertain ? 'data_unverified' : 'no_feasible_meal',
      explanation: uncertain ? '当前价格、费用或可售数据无法完整核验。' : '已核验的候选中没有符合本次限制的一餐。',
      nextAction: '保留当前限制，稍后重查或指定其他门店。', rejectedReasons: [...rejected].map(([code, count]) => ({ code, count })) };
  }
  const ranked = rankMeals(feasible, rankingContext, memory, now);
  const selected = selectMeals(ranked, rankingContext);
  const contextEvidence: Evidence = { id: 'context:current', kind: 'context', sourceRef: ctx.sourceRefs[0] ?? 'context',
    observedAt: now, certainty: 'explicit', facts: { budgetMaxFen: ctx.hard.budgetMaxFen, mode: ctx.mode } };
  evidence.set(contextEvidence.id, contextEvidence);
  const options = selected.map(({ meal: m, role }): RecommendationOption => {
    const reasons: RecommendationOption['reasons'] = [];
    if (ctx.hard.budgetMaxFen !== null) reasons.push({ code: 'WITHIN_BUDGET', evidenceIds: [m.quote.evidenceId, contextEvidence.id] });
    if (ctx.mode === 'usual' && !notices.length) reasons.push({ code: 'USUAL_REORDER', evidenceIds: [m.quote.evidenceId] });
    for (const p of m.products) {
      evidence.set(p.evidenceId, { id: p.evidenceId, kind: 'menu', sourceRef: p.productId, observedAt: now,
        certainty: 'verified', facts: { name: p.name, category: p.category, containsChicken: p.foodTags===null?null:p.foodTags.includes('chicken'), sugarFree: p.dietary.sugarFree, dietaryEvidenceId: p.dietary.evidenceId } });
      if (p.nutrition) evidence.set(p.nutrition.evidenceId, { id: p.nutrition.evidenceId, kind: 'nutrition', sourceRef: p.productId,
        observedAt: now, certainty: 'verified', facts: { proteinG: p.nutrition.proteinG, energyKcal: p.nutrition.energyKcal, sugarG: p.nutrition.sugarG } });
    }
    if (ctx.goals.includes('protein') && m.proteinG !== null) reasons.push({ code: 'VERIFIED_PROTEIN',
      evidenceIds: m.products.flatMap(p => p.nutrition ? [p.nutrition.evidenceId] : []) });
    return { candidateId: m.fingerprint, role, items: m.items, itemNames: m.products.map(p => p.name),
      mealFingerprint: m.fingerprint, quote: m.quote, score: m.score, reasons };
  });
  return { status: 'ready', recommendationId: stableHash([ctx, options.map(o => o.quote.snapshotHash)]), mode: input.mode,
    context: ctx, options, evidence: [...evidence.values()], validUntil: new Date(Math.min(...options.map(o => Date.parse(o.quote.validUntil)))).toISOString(),
    missingData: selected.some(x => x.meal.proteinG === null) ? ['nutrition'] : [], notices, searchCoverage: 'bounded' };
}
