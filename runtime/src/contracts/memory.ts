import type { BasketItem, Channel, ISODateTime } from './provider.js';

export interface PreferenceScope {
  mealPeriod?: 'breakfast' | 'lunch' | 'dinner' | 'late_night';
  channel?: Channel;
  partySize?: number;
}

export interface Preference {
  id: string;
  userId: string; // Bound locally, never accepted as an arbitrary LLM argument.
  key: string;
  target: { provider: string; productId: string } | null;
  value: boolean | number | string;
  kind: 'explicit' | 'inferred';
  rule: 'soft' | 'exclude';
  scope: PreferenceScope;
  confidence: number | null; // Evidence strength, not a calibrated probability.
  sourceEventIds: string[];
  updatedAt: ISODateTime;
  expiresAt: ISODateTime | null;
}

export type MemoryEventKind =
  | 'statement' | 'recommendation_accepted' | 'recommendation_rejected'
  | 'order_completed' | 'meal_feedback' | 'correction';

export interface MemoryEvent {
  id: string;
  userId: string;
  kind: MemoryEventKind;
  dedupeKey: string;
  source: 'user' | 'provider';
  sourceRef: string;
  orderRef: string | null;
  scope: PreferenceScope;
  payload: unknown; // Validated by an event-kind-specific runtime schema.
  occurredAt: ISODateTime;
}

export interface MemorySettings {
  userId: string;
  learningEnabled: boolean;
  excludedKeys: string[];
  historicalReplayBlockedBefore: ISODateTime | null;
}

export interface UsualMeal {
  sourceOrderId: string;
  userNamed: boolean;
  label: string | null;
  scope: PreferenceScope;
  items: BasketItem[];
  // No historical price, historical coupon or guessed payment status.
}

export interface MemorySnapshot {
  preferences: Preference[];
  usual: UsualMeal | null;
  recentCompletedSoloMeals: Array<{
    orderId: string;
    completedAt: ISODateTime;
    items: BasketItem[];
  }>;
  historyCoverage: 'partial' | 'complete' | 'unavailable';
  settings: MemorySettings;
}
