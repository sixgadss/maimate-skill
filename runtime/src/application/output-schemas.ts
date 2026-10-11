import { z } from 'zod';
import { quoteSchema,itemSchema,scopeSchema,iso,safeInt } from '../domain/schemas.js';
const feature=z.object({preference:z.number().nullable(),context:z.number().nullable(),value:z.number().nullable(),nutrition:z.number().nullable(),novelty:z.number().nullable(),availability:z.number().nullable()}).strict();
const option=z.object({candidateId:z.string(),role:z.enum(['best_fit','best_value','explore']),items:z.array(itemSchema),itemNames:z.array(z.string()),mealFingerprint:z.string(),quote:quoteSchema,
  score:z.object({weights:feature,values:feature,coverage:z.number(),repeatPenalty:z.number(),total:z.number()}).strict(),
  reasons:z.array(z.object({code:z.enum(['WITHIN_BUDGET','EXPLICIT_PREFERENCE','USUAL_REORDER','VERIFIED_PROTEIN','LOWER_PAYABLE_IN_SEARCH','LESS_RECENT_REPETITION']),evidenceIds:z.array(z.string())}).strict())}).strict();
const context=z.object({scope:scopeSchema,mode:z.enum(['default','value','post_workout','explore','hurry','usual']),chooseOne:z.boolean(),mealPeriod:z.enum(['breakfast','lunch','dinner','late_night']),timeBudgetMinutes:safeInt.nullable(),
  hard:z.object({budgetMaxFen:safeInt.nullable(),maxEnergyKcal:z.number().nullable(),excludedProductIds:z.array(z.string()),excludedFoodTags:z.array(z.string()),excludedAllergens:z.array(z.string()),avoidSugaryDrinks:z.boolean(),avoidAddedSugar:z.boolean()}).strict(),
  goals:z.array(z.string()),sessionPreferenceExceptions:z.array(z.string()),sourceRefs:z.array(z.string())}).strict();
const evidence=z.object({id:z.string(),kind:z.enum(['quote','menu','nutrition','memory','context','comparison']),sourceRef:z.string(),observedAt:iso,certainty:z.enum(['explicit','verified','inferred']),facts:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()]))}).strict();
export const recommendationOutput=z.union([
  z.object({status:z.literal('ready'),recommendationId:z.string(),mode:z.enum(['live','fixture']),context,options:z.array(option).min(1).max(3),evidence:z.array(evidence),validUntil:iso,missingData:z.array(z.string()),notices:z.array(z.string()),searchCoverage:z.literal('bounded')}).strict(),
  z.object({status:z.literal('needs_input'),field:z.string(),question:z.string(),reason:z.string()}).strict(),
  z.object({status:z.literal('unavailable'),reason:z.enum(['no_feasible_meal','data_unverified','provider_unavailable']),explanation:z.string(),nextAction:z.string(),rejectedReasons:z.array(z.object({code:z.string(),count:safeInt}))}).strict(),
]);
const error=z.object({ok:z.literal(false),error:z.object({code:z.string(),message:z.string()}).strict()}).strict();
export const feedbackOutput=z.union([z.object({ok:z.literal(true),kind:z.enum(['accepted','rejected','statement','meal_feedback']),changedScope:z.array(z.string())}).strict(),error]);
export const memoryOutput=z.union([
  z.object({ok:z.literal(true),action:z.literal('list'),preferences:z.array(z.object({}).passthrough()),settings:z.object({}).passthrough()}).strict(),
  z.object({ok:z.literal(true),action:z.enum(['correct','delete','undo','pause','resume','clear']),changedScope:z.array(z.string()),undo:z.object({ref:z.string(),validUntil:iso}).nullable()}).strict(),error,
]);
