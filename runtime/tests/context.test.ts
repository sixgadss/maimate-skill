import { describe, it, expect } from 'vitest';
import { resolveContext } from '../src/domain/context.js';
import { canonicalFingerprint, validateQuote } from '../src/domain/schemas.js';
import { defaultConfig } from '../src/config.js';
import { memory, NOW, quote } from './helpers.js';

describe('context and quote boundaries', () => {
  it('asks only for the missing store before the missing channel', () => {
    const r = resolveContext({ userTurnRef: 't1', utterance: '吃麦当劳', intent: {} }, memory(), defaultConfig(), NOW);
    expect(r).toMatchObject({ status: 'needs_input', field: 'restaurantId' });
  });
  it('uses validated defaults and Shanghai meal time without guessing a location', () => {
    const cfg = { ...defaultConfig(), restaurantId: 'demo-store', channel: 'pickup' as const };
    const r = resolveContext({ userTurnRef: 't1', utterance: '20块以内吃饱',
      intent: { budgetMaxFen: 2000, goal: 'satisfying' } }, memory(), cfg, NOW);
    expect(r).toMatchObject({ status: 'context', context: { mealPeriod: 'lunch',
      hard: { budgetMaxFen: 2000 }, scope: { timezone: 'Asia/Shanghai' } } });
  });
  it('rejects fractional money and invalid quantities', () => {
    const cfg = { ...defaultConfig(), restaurantId: 'demo-store', channel: 'pickup' as const };
    expect(() => resolveContext({ userTurnRef: 't', utterance: '吃饭', intent: { budgetMaxFen: 20.5 } }, memory(), cfg, NOW)).toThrow();
    const q = quote(); q.request.items[0]!.quantity = 0;
    expect(() => validateQuote(q)).toThrow();
  });
  it('allows a sourced sugar exception this time without mutating the stored preference or allergy', () => {
    const m = memory();
    const base = { id: 'p', userId: 'local', kind: 'explicit' as const, rule: 'exclude' as const,
      scope: {}, confidence: null, sourceEventIds: ['old'], updatedAt: NOW, expiresAt: null, target: null };
    m.preferences = [{ ...base, key: 'drink.sugar_policy', value: 'avoid_sugary_drinks' },
      { ...base, id: 'a', key: 'allergen:milk', value: true }];
    const cfg = { ...defaultConfig(), restaurantId: 'demo-store', channel: 'pickup' as const };
    const r = resolveContext({ userTurnRef: 't', utterance: '今天喝普通可乐',
      intent: { avoidSugaryDrinks: false } }, m, cfg, NOW);
    expect(r).toMatchObject({ status: 'context', context: { hard: {
      avoidSugaryDrinks: false, excludedAllergens: ['milk'] } } });
    expect(m.preferences[0]!.value).toBe('avoid_sugary_drinks');
    expect(() => resolveContext({ userTurnRef: 't', utterance: '老样子',
      intent: { avoidSugaryDrinks: false } }, m, cfg, NOW)).toThrow();
  });
  it('canonicalizes duplicates and order but retains quantities and configurations', () => {
    const a = { productId: 'a', variantId: null, configurationRef: null, quantity: 1 };
    const b = { ...a, productId: 'b' };
    expect(canonicalFingerprint([a, b, a])).toBe(canonicalFingerprint([b, { ...a, quantity: 2 }]));
    expect(canonicalFingerprint([a])).not.toBe(canonicalFingerprint([{ ...a, configurationRef: 'zero' }]));
  });
  it('rejects inconsistent total, unsafe integer or invalid timestamps', () => {
    const q = quote(); q.payable.amountFen = 1400;
    expect(() => validateQuote(q)).toThrow();
    q.payable.amountFen = Number.MAX_SAFE_INTEGER + 1;
    expect(() => validateQuote(q)).toThrow();
    q.payable.amountFen = 1500; q.validUntil = 'yesterday';
    expect(() => validateQuote(q)).toThrow();
  });
});
