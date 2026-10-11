import type { MemorySnapshot } from '../src/contracts/memory.js';
import type { Product, PurchaseScope, OrderQuote } from '../src/contracts/provider.js';
import type { MealContext } from '../src/contracts/runtime.js';

export const NOW = '2026-10-10T04:00:00.000Z';
export const scope = (): PurchaseScope => ({ restaurantId: 'demo-store', businessEntityId: null,
  channel: 'pickup', addressRef: null, pickupMethod: null, serviceAt: NOW,
  timezone: 'Asia/Shanghai', partySize: 1 });
export const memory = (): MemorySnapshot => ({ preferences: [], usual: null,
  recentCompletedSoloMeals: [], historyCoverage: 'partial', settings: { userId: 'local',
    learningEnabled: true, excludedKeys: [], historicalReplayBlockedBefore: null } });
export const context = (): MealContext => ({ scope: scope(), mode: 'default', chooseOne: false,
  mealPeriod: 'lunch', timeBudgetMinutes: null, hard: { budgetMaxFen: null,
    maxEnergyKcal: null, excludedProductIds: [], excludedFoodTags: [], excludedAllergens: [],
    avoidSugaryDrinks: false, avoidAddedSugar: false }, goals: [], sessionPreferenceExceptions: [],
  sourceRefs: ['turn:test'] });
export const product = (id = 'main', price = 1500): Product => ({ productId: id,
  variantId: null, name: `演示${id}`, category: 'main', foodTags: ['chicken'],
  saleStatus: 'available', menuPrice: { currency: 'CNY', amountFen: price },
  nutrition: { energyKcal: 400, proteinG: 20, sugarG: 0, sodiumMg: 300,
    basis: 'per_serving', evidenceId: `nutrition:${id}` },
  dietary: { sugarFree: true, addedSugar: false, allergens: [], evidenceId: `dietary:${id}` },
  configurationRefs: [], evidenceId: `product:${id}` });
export const quote = (): OrderQuote => ({ quoteId: 'q:test', basketHash: '', snapshotHash: '',
  request: { scope: scope(), items: [{ productId: 'main', variantId: null,
    configurationRef: null, quantity: 1 }], couponIds: [], pointsPlanRef: null,
    tablewareRequested: false }, itemsSubtotal: { currency: 'CNY', amountFen: 1500 },
  requiredFees: [], discounts: [], payable: { currency: 'CNY', amountFen: 1500 },
  completeFees: true, verifiedTotal: true, pointsRequired: 0, sellable: true,
  observedAt: NOW, validUntil: '2026-10-10T04:00:30.000Z', evidenceId: 'quote:test' });
