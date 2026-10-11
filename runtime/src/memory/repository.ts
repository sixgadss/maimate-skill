import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, closeSync, chmodSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { PurchaseScope, OrderReceipt } from '../contracts/provider.js';
import type { MemorySnapshot, MemorySettings, Preference } from '../contracts/memory.js';
import type { MemoryAction, MemoryResult, RecommendationResult } from '../contracts/runtime.js';
import { iso, itemSchema, moneySchema, scopeSchema, stableHash } from '../domain/schemas.js';
import { preferenceChangeSchema, type PreferenceChange } from './preferences.js';
import { inferFrequent } from './learning.js';
import { UndoStore } from './controls.js';
export type { PreferenceChange } from './preferences.js';
const orderSchema = z.object({ orderId: z.string().min(1), provider: z.string().min(1), scope: scopeSchema,
  items: z.array(itemSchema).min(1), status: z.enum(['created','awaiting_payment','paid','completed','cancelled','failed','unknown']),
  payable: moneySchema.nullable(), paymentUrl: z.string().nullable(), createdAt: iso, evidenceId: z.string().min(1) });
type SavedState = { prefs: Preference[]; events: Array<{ kind: string; dedupe_key: string; id: string; payload: string }>;
  settings: MemorySettings };
export class MemoryRepository {
  private db: DatabaseSync;
  private undo: UndoStore<SavedState>;
  constructor(path: string, private user: string, private clock: () => string) {
    if (!user.trim()) throw new Error('Local user binding required');
    if (path !== ':memory:') { mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const fd = openSync(path, 'a', 0o600); closeSync(fd); chmodSync(path, 0o600); }
    this.db = new DatabaseSync(path); this.undo = new UndoStore(clock);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA secure_delete=ON; PRAGMA journal_mode=WAL;');
    this.db.exec(readFileSync(new URL('../../migrations/001_initial.sql', import.meta.url), 'utf8'));
    const settings: MemorySettings = { userId: user, learningEnabled: true, excludedKeys: [], historicalReplayBlockedBefore: null };
    this.db.prepare('INSERT OR IGNORE INTO memory_settings(user_id,payload) VALUES (?,?)').run(user, JSON.stringify(settings));
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private version(): number { return Number(this.db.prepare('SELECT version FROM memory_settings WHERE user_id=?').get(this.user)!.version); }
  private bump() { this.db.prepare('UPDATE memory_settings SET version=version+1 WHERE user_id=?').run(this.user); }
  settings(): MemorySettings { return JSON.parse(String(this.db.prepare('SELECT payload FROM memory_settings WHERE user_id=?').get(this.user)!.payload)); }
  private setSettings(s: MemorySettings) { this.db.prepare('UPDATE memory_settings SET payload=? WHERE user_id=?').run(JSON.stringify(s), this.user); }
  private allPreferences(): Preference[] { return this.db.prepare('SELECT payload FROM preferences WHERE user_id=? ORDER BY id').all(this.user).map(r => JSON.parse(String(r.payload)) as Preference); }
  private putPreference(p: Preference) { this.db.prepare('INSERT INTO preferences(user_id,id,payload) VALUES (?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET payload=excluded.payload').run(this.user, p.id, JSON.stringify(p)); }
  private event(kind: string, key: string, id: string, payload: unknown): boolean {
    return Number(this.db.prepare('INSERT OR IGNORE INTO memory_events(user_id,kind,dedupe_key,id,payload) VALUES (?,?,?,?,?)').run(this.user,kind,key,id,JSON.stringify(payload)).changes) > 0;
  }
  recordStatement(turn: string, raw: PreferenceChange, persistence: 'session' | 'long_term'): boolean {
    const change = preferenceChangeSchema.parse(raw);
    if (persistence === 'session') return true;
    return this.transaction(() => {
      const id = stableHash([this.user, change.key, change.target, change.scope]);
      const eventId = stableHash([this.user, turn, id]);
      if (!this.event('statement', `${turn}:${id}`, eventId, {preferenceId:id,change})) return false;
      this.putPreference({ id, userId: this.user, ...change, kind: 'explicit', confidence: null,
        sourceEventIds: [eventId], updatedAt: this.clock(), expiresAt: null });
      const s = this.settings(); s.excludedKeys = s.excludedKeys.filter(k => k !== change.key);
      this.setSettings(s); this.bump(); return true;
    });
  }
  recordDecisionFeedback(r: string, c: string, kind: 'accepted' | 'rejected', turn: string): void {
    this.transaction(() => {
      this.db.prepare('UPDATE decisions SET selection=? WHERE user_id=? AND id=?').run(JSON.stringify({ c, kind, turn }), this.user, r);
      if (this.settings().learningEnabled) this.event(`recommendation_${kind}`, `${r}:${c}:${turn}`, stableHash([r,c,turn]), { recommendationId: r, candidateId: c, sourceRef: turn });
    });
  }
  private eligibleOrders(): OrderReceipt[] {
    const cutoff = this.settings().historicalReplayBlockedBefore;
    return this.db.prepare('SELECT payload FROM orders WHERE user_id=? AND learning_eligible=1').all(this.user)
      .map(row => JSON.parse(String(row.payload)) as OrderReceipt).filter(o => o.status === 'completed' && o.scope.partySize === 1
        && (!cutoff || Date.parse(o.createdAt) > Date.parse(cutoff))).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }
  syncOrders(raw: OrderReceipt[]): void {
    const orders = raw.map(o => orderSchema.parse(o));
    this.transaction(() => {
      const s = this.settings();
      for (const order of orders) {
        const previous = this.db.prepare('SELECT learning_eligible,payload FROM orders WHERE user_id=? AND provider=? AND external_order_id=?').get(this.user, order.provider, order.orderId);
        const wasCompleted = !!previous && (JSON.parse(String(previous.payload)) as OrderReceipt).status === 'completed';
        const eligible = (previous ? Number(previous.learning_eligible) === 1 : true) && (s.learningEnabled || wasCompleted)
          && (!s.historicalReplayBlockedBefore || Date.parse(order.createdAt) > Date.parse(s.historicalReplayBlockedBefore));
        // Keep only the order fields needed for memory; payment URLs are never persisted here.
        this.db.prepare('INSERT INTO orders(user_id,provider,external_order_id,payload,learning_eligible) VALUES (?,?,?,?,?) ON CONFLICT(user_id,provider,external_order_id) DO UPDATE SET payload=excluded.payload, learning_eligible=excluded.learning_eligible')
          .run(this.user, order.provider, order.orderId, JSON.stringify({ ...order, paymentUrl: null }), Number(eligible));
        if (eligible && order.status === 'completed' && order.scope.partySize === 1)
          this.event('order_completed', `${order.provider}:${order.orderId}`, `order:${order.provider}:${order.orderId}`, { orderId: order.orderId, provider: order.provider });
      }
      if (!s.learningEnabled) return;
      const inferred = inferFrequent(this.eligibleOrders(), this.user, s.excludedKeys);
      const before = this.allPreferences().filter(p => p.kind === 'inferred');
      if (JSON.stringify(before.sort((a,b)=>a.id.localeCompare(b.id))) !== JSON.stringify(inferred.sort((a,b)=>a.id.localeCompare(b.id)))) {
        for (const p of before) this.db.prepare('DELETE FROM preferences WHERE user_id=? AND id=?').run(this.user,p.id);
        inferred.forEach(p => this.putPreference(p)); this.bump();
      }
    });
  }
  snapshot(scope: PurchaseScope): MemorySnapshot {
    const orders = this.eligibleOrders();
    const applicable = orders.find(o => o.scope.channel === scope.channel && o.scope.partySize === scope.partySize
      && mealPeriod(o.createdAt, o.scope.timezone) === mealPeriod(scope.serviceAt, scope.timezone));
    return { preferences: this.allPreferences().filter(p => p.expiresAt === null || Date.parse(p.expiresAt) > Date.parse(this.clock())),
      usual: applicable ? { sourceOrderId: applicable.orderId, userNamed: false, label: null,
        scope: { channel: applicable.scope.channel, partySize: applicable.scope.partySize,
          mealPeriod: mealPeriod(applicable.createdAt, applicable.scope.timezone) }, items: applicable.items } : null,
      recentCompletedSoloMeals: orders.slice(0,5).map(o => ({ orderId: o.orderId, completedAt: o.createdAt, items: o.items })),
      historyCoverage: 'partial', settings: this.settings() };
  }
  saveDecision(result: Extract<RecommendationResult, { status: 'ready' }>) {
    this.db.prepare('INSERT INTO decisions(user_id,id,payload) VALUES (?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET payload=excluded.payload').run(this.user, result.recommendationId, JSON.stringify(result));
  }
  getDecision(id: string): Extract<RecommendationResult, { status: 'ready' }> | null {
    const row = this.db.prepare('SELECT payload FROM decisions WHERE user_id=? AND id=?').get(this.user,id);
    return row ? JSON.parse(String(row.payload)) : null;
  }
  getCompletedOrder(id:string):OrderReceipt|null {
    const orders=this.eligibleOrders().filter(o=>o.orderId===id);
    return orders.length===1?orders[0]!:null;
  }
  private capture(): SavedState { return { prefs: this.allPreferences(), settings: this.settings(),
    events: this.db.prepare('SELECT kind,dedupe_key,id,payload FROM memory_events WHERE user_id=?').all(this.user)
      .map(r => ({ kind: String(r.kind), dedupe_key: String(r.dedupe_key), id: String(r.id), payload: String(r.payload) })) }; }
  correctPreference(id: string, raw: PreferenceChange, turn: string): MemoryResult {
    try {
      const change = preferenceChangeSchema.parse(raw); const before = this.capture();
      this.transaction(() => {
        const existing = before.prefs.find(p => p.id === id);
        if (!existing) throw new Error('Unknown preference reference');
        const nextId = stableHash([this.user, change.key, change.target, change.scope]);
        const eventId = stableHash([this.user, 'correct', turn, id]);
        const lineagePreferenceIds=[...this.preferenceLineage([id],before.events)];
        if (!this.event('correction', `${turn}:${id}`, eventId, { replaced: id, preferenceId:nextId, lineagePreferenceIds, change })) return;
        this.db.prepare('DELETE FROM preferences WHERE user_id=? AND id=?').run(this.user, id);
        for (const source of existing.sourceEventIds) this.db.prepare('DELETE FROM memory_events WHERE user_id=? AND id=?').run(this.user, source);
        this.putPreference({ id: nextId, userId: this.user, ...change, kind: 'explicit', confidence: null,
          sourceEventIds: [eventId], updatedAt: this.clock(), expiresAt: null });
        const s = this.settings();
        s.excludedKeys = [...new Set([...s.excludedKeys, existing.key])].filter(k => k !== change.key);
        this.setSettings(s); this.bump();
      });
      return { ok: true, action: 'correct', changedScope: [change.key], undo: this.undo.put(before, this.version()) };
    } catch (error) { return { ok: false, error: { code: 'MEMORY_OPERATION_FAILED', message: error instanceof Error ? error.message : 'Invalid correction' } }; }
  }
  manage(action: MemoryAction): MemoryResult {
    if (action.action === 'list') return { ok: true, action: 'list', preferences: this.allPreferences(), settings: this.settings() };
    try {
      if (action.action === 'undo') {
        const state = this.undo.take(action.undoRef, this.version());
        this.transaction(() => {
          this.db.prepare('DELETE FROM preferences WHERE user_id=?').run(this.user);
          this.db.prepare('DELETE FROM memory_events WHERE user_id=?').run(this.user);
          state.prefs.forEach(p=>this.putPreference(p)); state.events.forEach(e=>this.event(e.kind,e.dedupe_key,e.id,JSON.parse(e.payload)));
          this.setSettings(state.settings); this.bump();
        });
        return { ok: true, action: 'undo', changedScope: ['preferences','replay_rules'], undo: null };
      }
      const before = this.capture(); let changed: string[] = [];
      this.transaction(() => {
        const s = this.settings();
        if (action.action === 'pause' || action.action === 'resume') { s.learningEnabled = action.action === 'resume'; changed = ['learning_enabled']; }
        if (action.action === 'clear') {
          this.db.prepare('DELETE FROM preferences WHERE user_id=?').run(this.user);
          this.db.prepare('DELETE FROM memory_events WHERE user_id=?').run(this.user);
          this.db.prepare('UPDATE orders SET learning_eligible=0 WHERE user_id=?').run(this.user);
          this.db.prepare('DELETE FROM decisions WHERE user_id=?').run(this.user);
          s.historicalReplayBlockedBefore = this.clock(); s.excludedKeys = []; changed = ['preferences','learning_events','derived_memory'];
        }
        if (action.action === 'delete') {
          const selected = before.prefs.filter(p => action.preferenceIds.includes(p.id));
          if (selected.length !== action.preferenceIds.length) throw new Error('Unknown preference reference');
          const keys = selected.flatMap(p => [p.key, ...(p.target ? [`product:${p.target.provider}:${p.target.productId}`] : [])]);
          s.excludedKeys = [...new Set([...s.excludedKeys, ...keys])];
          const removed = before.prefs.filter(p => keys.includes(p.key) || (p.target && keys.includes(`product:${p.target.provider}:${p.target.productId}`)));
          const lineage=this.preferenceLineage(removed.map(p=>p.id),before.events);
          const eventLinks=before.events.map(e=>({event:e,ids:this.eventPreferenceIds(e.payload)}));
          const retainedRefs=new Set(before.prefs.filter(p=>!removed.includes(p)).flatMap(p=>p.sourceEventIds));
          const removedRefs=new Set(removed.flatMap(p=>p.sourceEventIds));
          removed.forEach(p => {
            this.db.prepare('DELETE FROM preferences WHERE user_id=? AND id=?').run(this.user,p.id);
          });
          for(const {event,ids} of eventLinks) if(ids.some(id=>lineage.has(id)) || (removedRefs.has(event.id) && !retainedRefs.has(event.id)))
            this.db.prepare('DELETE FROM memory_events WHERE user_id=? AND id=?').run(this.user,event.id);
          changed = removed.map(p => p.key);
        }
        if (action.action === 'correct') {
          // Parsing is performed in the application; raw prose cannot overwrite a typed preference here.
          throw new Error('Correction requires a validated preference change');
        }
        this.setSettings(s); this.bump();
      });
      const erase = action.action === 'clear' || (action.action === 'delete' && action.mode === 'erase');
      if (erase) { this.undo.clear(); this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
      return { ok: true, action: action.action, changedScope: changed, undo: erase ? null : this.undo.put(before,this.version()) };
    } catch (error) { return { ok: false, error: { code: 'MEMORY_OPERATION_FAILED', message: error instanceof Error ? error.message : 'Memory operation failed' } }; }
  }
  private eventPreferenceIds(payload:string):string[] {
    const raw=JSON.parse(payload) as {preferenceId?:unknown;replaced?:unknown;change?:unknown;lineagePreferenceIds?:unknown};
    const change=preferenceChangeSchema.safeParse(raw.change??raw);const ids:string[]=[];
    if(change.success) ids.push(stableHash([this.user,change.data.key,change.data.target,change.data.scope]));
    for(const id of [raw.preferenceId,raw.replaced]) if(typeof id==='string')ids.push(id);
    if(Array.isArray(raw.lineagePreferenceIds)) for(const id of raw.lineagePreferenceIds)if(typeof id==='string')ids.push(id);
    return ids;
  }
  private preferenceLineage(seed:string[],events:SavedState['events']):Set<string> {
    const lineage=new Set(seed),links=events.map(e=>this.eventPreferenceIds(e.payload));let expanded=true;
    while(expanded) {expanded=false;for(const ids of links) if(ids.some(id=>lineage.has(id))) for(const id of ids)
      if(!lineage.has(id)){lineage.add(id);expanded=true;}}
    return lineage;
  }
  close(): void { this.undo.clear(); this.db.close(); }
}
function mealPeriod(timestamp: string, timezone: string): 'breakfast' | 'lunch' | 'dinner' | 'late_night' {
  const h = Number(new Intl.DateTimeFormat('en-US',{ timeZone: timezone, hour:'2-digit', hourCycle:'h23' }).format(new Date(timestamp)));
  return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 22 ? 'dinner' : 'late_night';
}
