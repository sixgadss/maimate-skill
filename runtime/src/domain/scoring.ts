import type { MealContext, ScoreBreakdown, ScoreFeature } from '../contracts/runtime.js';
import type { MemorySnapshot } from '../contracts/memory.js';
import type { FeasibleMeal } from './constraints.js';

const names: ScoreFeature[] = ['preference', 'context', 'value', 'nutrition', 'novelty', 'availability'];
const profiles = { default: [.25,.20,.20,.15,.10,.10], value: [.20,.15,.45,.05,.05,.10],
  post_workout: [.20,.20,.15,.30,.05,.10], explore: [.20,.20,.15,.10,.25,.10], hurry: [.25,.35,.15,.05,.05,.15],
  usual: [.25,.20,.20,.15,.10,.10] };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function computeScore(features: Record<ScoreFeature, number | null>, context: MealContext, penalty: number): ScoreBreakdown {
  const weights = Object.fromEntries(names.map((name, index) => [name,
    name === 'nutrition' && !context.goals.some(g => ['protein', 'lower_energy'].includes(g)) ? 0 : profiles[context.mode][index]!])) as Record<ScoreFeature, number>;
  const sum = names.reduce((n, name) => n + weights[name], 0);
  for (const name of names) weights[name] /= sum;
  const values = Object.fromEntries(names.map(n => [n, features[n] === null ? null : clamp(features[n]!)])) as Record<ScoreFeature, number | null>;
  const coverage = names.reduce((n, name) => n + (values[name] === null ? 0 : weights[name]), 0);
  const total = names.reduce((n, name) => n + weights[name] * (values[name] ?? 0), 0);
  const repeatPenalty = context.mode === 'usual' ? 0 : Math.min(.1, Math.max(0, penalty));
  return { weights, values, coverage, repeatPenalty, total: clamp(total - repeatPenalty) };
}
export interface RankedMeal extends FeasibleMeal { score: ScoreBreakdown; fit: number; novelty: number | null; matchedPreferenceIds: string[]; }
export function rankMeals(meals: FeasibleMeal[], ctx: MealContext, memory: MemorySnapshot, now: string): RankedMeal[] {
  const minPrice = Math.min(...meals.map(m => m.quote.payable.amountFen)), maxPrice = Math.max(...meals.map(m => m.quote.payable.amountFen));
  const maxProtein = Math.max(1, ...meals.map(m => m.proteinG ?? 0));
  const maxEnergy = Math.max(1, ...meals.map(m => m.energyKcal ?? 0));
  return meals.map(m => {
    const matched = memory.preferences.filter(p => (p.expiresAt === null || Date.parse(p.expiresAt) > Date.parse(now))
      && (!p.scope.mealPeriod || p.scope.mealPeriod === ctx.mealPeriod)
      && (!p.scope.channel || p.scope.channel === ctx.scope.channel)
      && (!p.scope.partySize || p.scope.partySize === ctx.scope.partySize)
      && p.rule === 'soft' && p.target && m.items.some(i => i.productId === p.target!.productId));
    const preference = clamp(.5 + matched.reduce((n, p) => n + (p.kind === 'explicit' ? .3 : (p.confidence ?? 0) >= .4 ? .15 * p.confidence! : 0), 0));
    const mainIds = m.products.filter(p => p.category === 'main' || p.category === 'set').map(p => p.productId);
    const recent = memory.recentCompletedSoloMeals.slice(0, 5);
    const repetition = recent.length ? recent.filter(o => o.items.some(i => mainIds.includes(i.productId))).length / recent.length : 0;
    const novelty = recent.length ? 1 - repetition : memory.historyCoverage === 'unavailable' ? null : .5;
    const nutrition = ctx.goals.includes('protein') ? (m.proteinG === null ? null : m.proteinG / maxProtein)
      : ctx.goals.includes('lower_energy') ? (m.energyKcal === null ? null : 1 - m.energyKcal / maxEnergy) : null;
    const features = { preference, context: ctx.mode === 'hurry' ? clamp(1 - .1 * (m.items.length - 1)) : 1,
      value: maxPrice === minPrice ? .5 : (maxPrice - m.quote.payable.amountFen) / (maxPrice - minPrice), nutrition, novelty, availability: 1 };
    const score = computeScore(features, ctx, repetition * .1);
    const fitKeys: ScoreFeature[] = ['preference', 'context', 'nutrition'];
    const fitDenom = fitKeys.reduce((n, k) => n + score.weights[k], 0);
    const fit = fitKeys.reduce((n, k) => n + score.weights[k] * (score.values[k] ?? 0), 0) / fitDenom;
    return { ...m, score, fit, novelty, matchedPreferenceIds: matched.map(p => p.id) };
  }).sort((a, b) => b.score.total - a.score.total || a.quote.payable.amountFen - b.quote.payable.amountFen
    || a.items.length - b.items.length || a.fingerprint.localeCompare(b.fingerprint));
}
