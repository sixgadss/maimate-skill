import type {
  BasketItem, Channel, ISODateTime, OrderQuote, PurchaseScope,
} from './provider.js';
import type { MemorySettings, Preference } from './memory.js';

export type DecisionMode = 'default' | 'value' | 'post_workout'
  | 'explore' | 'hurry' | 'usual';

export interface MealIntent {
  mode?: DecisionMode;
  chooseOne?: boolean;
  budgetMaxFen?: number;
  partySize?: number;
  channel?: Channel;
  restaurantId?: string;
  addressRef?: string;
  serviceAt?: ISODateTime;
  mealPeriod?: 'breakfast' | 'lunch' | 'dinner' | 'late_night';
  timeBudgetMinutes?: number;
  goal?: 'satisfying' | 'protein' | 'lower_energy' | 'no_repetition';
  maxEnergyKcal?: number;
  excludedAllergens?: string[];
  avoidSugaryDrinks?: boolean;
  avoidAddedSugar?: boolean;
  excludedFoodTags?: string[];
  excludedProductIds?: string[];
  sessionPreferenceExceptions?: string[];
  // Fields absent from the utterance remain absent, rather than guessed.
}

export interface MealContext {
  scope: PurchaseScope;
  mode: DecisionMode;
  chooseOne: boolean;
  mealPeriod: 'breakfast' | 'lunch' | 'dinner' | 'late_night';
  timeBudgetMinutes: number | null;
  hard: {
    budgetMaxFen: number | null;
    maxEnergyKcal: number | null;
    excludedProductIds: string[];
    excludedFoodTags: string[];
    excludedAllergens: string[];
    avoidSugaryDrinks: boolean;
    avoidAddedSugar: boolean;
  };
  goals: string[];
  sessionPreferenceExceptions: string[];
  sourceRefs: string[];
}

export type ScoreFeature = 'preference' | 'context' | 'value'
  | 'nutrition' | 'novelty' | 'availability';

export interface ScoreBreakdown {
  weights: Record<ScoreFeature, number>;
  values: Record<ScoreFeature, number | null>;
  coverage: number;
  repeatPenalty: number;
  total: number;
}

export interface Evidence {
  id: string;
  kind: 'quote' | 'menu' | 'nutrition' | 'memory' | 'context' | 'comparison';
  sourceRef: string;
  observedAt: ISODateTime;
  certainty: 'explicit' | 'verified' | 'inferred';
  facts: Record<string, string | number | boolean | null>;
}

export interface RecommendationOption {
  candidateId: string;
  role: 'best_fit' | 'best_value' | 'explore';
  items: BasketItem[];
  itemNames: string[];
  mealFingerprint: string;
  quote: OrderQuote;
  score: ScoreBreakdown;
  reasons: Array<{
    code: 'WITHIN_BUDGET' | 'EXPLICIT_PREFERENCE' | 'USUAL_REORDER'
      | 'VERIFIED_PROTEIN' | 'LOWER_PAYABLE_IN_SEARCH'
      | 'LESS_RECENT_REPETITION';
    evidenceIds: string[];
  }>;
}

export type RecommendationResult =
  | {
      status: 'ready';
      recommendationId: string;
      mode: 'live' | 'fixture';
      context: MealContext;
      options: RecommendationOption[]; // Runtime validates 1..3, chooseOne => 1.
      evidence: Evidence[];
      validUntil: ISODateTime;
      missingData: string[];
      notices: string[];
      searchCoverage: 'bounded';
    }
  | {
      status: 'needs_input';
      field: string;
      question: string;
      reason: string;
    }
  | {
      status: 'unavailable';
      reason: 'no_feasible_meal' | 'data_unverified' | 'provider_unavailable';
      explanation: string;
      nextAction: string;
      rejectedReasons: Array<{ code: string; count: number }>;
    };

export interface RecommendRequest {
  userTurnRef: string;
  utterance: string;
  intent: MealIntent;
}

export type FeedbackRequest =
  | { kind: 'accepted' | 'rejected'; recommendationId: string;
      candidateId: string; userTurnRef: string }
  | { kind: 'meal_feedback'; orderId: string; text: string; userTurnRef: string }
  | { kind: 'statement'; text: string; persistence: 'session' | 'long_term';
      userTurnRef: string };

export type MemoryAction =
  | { action: 'list' }
  | { action: 'correct'; preferenceId: string; text: string; userTurnRef: string }
  | { action: 'delete'; preferenceIds: string[]; mode?: 'undoable' | 'erase';
      userTurnRef: string }
  | { action: 'undo'; undoRef: string; userTurnRef: string }
  | { action: 'pause' | 'resume'; userTurnRef: string }
  | { action: 'clear'; userTurnRef: string };

export type MemoryResult =
  | { ok: true; action: 'list'; preferences: Preference[]; settings: MemorySettings }
  | { ok: true; action: Exclude<MemoryAction['action'], 'list'>;
      changedScope: string[];
      undo: { ref: string; validUntil: ISODateTime } | null }
  | { ok: false; error: { code: string; message: string } };

export interface PreparedOrder {
  preparedId: string;
  snapshotHash: string;
  quote: OrderQuote;
  summary: string;
  validUntil: ISODateTime;
}

export interface CommitOrderRequest {
  preparedId: string;
  authorizationRef: string; // Trusted host proof; never an LLM-generated boolean.
  idempotencyKey: string;
}
