import type { MealContext, RecommendationOption } from '../contracts/runtime.js';
import type { RankedMeal } from './scoring.js';
export function selectMeals(ranked: RankedMeal[], ctx: MealContext): Array<{ meal: RankedMeal; role: RecommendationOption['role'] }> {
  if (!ranked.length) return [];
  const first = ranked[0]!;
  const chosen: Array<{ meal: RankedMeal; role: RecommendationOption['role'] }> = [{ meal: first, role: 'best_fit' }];
  if (ctx.chooseOne || ctx.mode === 'usual') return chosen;
  const seen = new Set([first.fingerprint]);
  const value = ranked.filter(m => m.fit >= .6 && !seen.has(m.fingerprint)).sort((a,b) => a.quote.payable.amountFen - b.quote.payable.amountFen || b.score.total - a.score.total)[0];
  if (value && value.quote.payable.amountFen < first.quote.payable.amountFen) { chosen.push({ meal: value, role: 'best_value' }); seen.add(value.fingerprint); }
  const explore = ranked.filter(m => m.fit >= .6 && m.novelty !== null && m.novelty > .5 && first.score.total - m.score.total <= .15 && !seen.has(m.fingerprint))
    .sort((a,b) => b.novelty! - a.novelty! || b.score.total - a.score.total)[0];
  if (explore) chosen.push({ meal: explore, role: 'explore' });
  return chosen;
}
