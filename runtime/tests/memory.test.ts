import { it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryRepository } from '../src/memory/repository.js';
import { scope, NOW } from './helpers.js';
import type { OrderReceipt } from '../src/contracts/provider.js';
const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
const dbPath = () => { const d = mkdtempSync(join(tmpdir(), 'mcmate-test-')); dirs.push(d); return join(d, 'memory.sqlite'); };
const order = (id = 'o1', status: OrderReceipt['status'] = 'completed', party = 1): OrderReceipt => ({
  orderId: id, provider: 'synthetic', scope: { ...scope(), partySize: party },
  items: [{ productId: 'chicken', variantId: null, configurationRef: null, quantity: 1 }],
  status, payable: { currency: 'CNY', amountFen: 1300 }, paymentUrl: null,
  createdAt: '2026-10-09T04:00:00.000Z', evidenceId: `order:${id}` });
const change = () => ({ key: 'drink.sugar_policy', value: 'avoid_sugary_drinks', rule: 'exclude' as const, target: null, scope: {} });

it('persists explicit memory after reopen and keeps session statements out of durable preferences', () => {
  const path = dbPath(); let r = new MemoryRepository(path, 'local', () => NOW);
  r.recordStatement('t1', change(), 'long_term'); r.recordStatement('t2', { ...change(), key: 'food.tag.chicken' }, 'session');
  expect(r.snapshot(scope()).preferences).toHaveLength(1); r.close();
  r = new MemoryRepository(path, 'local', () => NOW);
  expect(r.snapshot(scope()).preferences[0]).toMatchObject({ kind: 'explicit', confidence: null, value: 'avoid_sugary_drinks' }); r.close();
});
it('counts a completed solo order once and keeps accepted/paid/cancelled/group events distinct', () => {
  const r = new MemoryRepository(':memory:', 'local', () => NOW);
  r.recordDecisionFeedback('rec', 'candidate', 'accepted', 't');
  r.syncOrders([order(), order(), order('paid','paid'), order('cancelled','cancelled'), order('group','completed',2)]);
  expect(r.snapshot(scope()).recentCompletedSoloMeals).toHaveLength(1);
  expect(r.snapshot(scope()).usual?.sourceOrderId).toBe('o1'); r.close();
});
it('learning uses only unique completed orders, expires inferred records and cannot override explicit exclusion', () => {
  let now = NOW; const r = new MemoryRepository(':memory:', 'local', () => now);
  r.recordStatement('t', { ...change(), key: 'food.product.chicken', value: 'exclude', target: { provider: 'synthetic', productId: 'chicken' } }, 'long_term');
  r.syncOrders(Array.from({ length: 10 }, (_, i) => order(`o${i}`)));
  const prefs = r.snapshot(scope()).preferences;
  expect(prefs.find(p => p.kind === 'inferred')?.confidence).toBeCloseTo(10 / 14);
  expect(prefs.find(p => p.kind === 'explicit')?.rule).toBe('exclude');
  now = '2027-02-10T04:00:00.000Z';
  expect(r.snapshot(scope()).preferences.some(p => p.kind === 'inferred')).toBe(false); r.close();
});
it('delete blocks historical recreation; undo restores rules atomically; erase has no undo', () => {
  const r = new MemoryRepository(':memory:', 'local', () => NOW);
  r.syncOrders(Array.from({ length: 10 }, (_, i) => order(`o${i}`)));
  const id = r.snapshot(scope()).preferences.find(p => p.kind === 'inferred')!.id;
  const result = r.manage({ action: 'delete', preferenceIds: [id], userTurnRef: 'delete' });
  r.syncOrders(Array.from({ length: 10 }, (_, i) => order(`o${i}`)));
  expect(r.snapshot(scope()).preferences).toHaveLength(0);
  if (!result.ok || result.action === 'list' || !result.undo) throw new Error('Missing undo');
  expect(r.manage({ action: 'undo', undoRef: result.undo.ref, userTurnRef: 'undo' })).toMatchObject({ ok: true });
  expect(r.snapshot(scope()).preferences).toHaveLength(1);
  expect(r.manage({ action: 'delete', preferenceIds: [id], mode: 'erase', userTurnRef: 'erase' })).toMatchObject({ ok: true, undo: null }); r.close();
});
it('clear prevents old history and usual from reappearing, pause still permits explicit remember', () => {
  const r = new MemoryRepository(':memory:', 'local', () => NOW);
  r.syncOrders([order()]); r.manage({ action: 'clear', userTurnRef: 'clear' }); r.syncOrders([order()]);
  expect(r.snapshot(scope()).usual).toBeNull(); expect(r.snapshot(scope()).recentCompletedSoloMeals).toEqual([]);
  r.manage({ action: 'pause', userTurnRef: 'pause' }); r.syncOrders([order('new')]);
  r.recordStatement('remember', change(), 'long_term');
  expect(r.snapshot(scope()).preferences).toHaveLength(1); expect(r.snapshot(scope()).settings.learningEnabled).toBe(false); r.close();
});
it('binds users and rejects expired or conflicting undo without corrupting state', () => {
  let now = NOW; const path = dbPath(); const a = new MemoryRepository(path, 'a', () => now);
  a.recordStatement('ta', change(), 'long_term'); const b = new MemoryRepository(path, 'b', () => now);
  expect(b.snapshot(scope()).preferences).toEqual([]); b.close();
  const id = a.snapshot(scope()).preferences[0]!.id;
  const deleted = a.manage({ action: 'delete', preferenceIds: [id], userTurnRef: 'd' });
  if (!deleted.ok || deleted.action === 'list' || !deleted.undo) throw new Error('Missing undo');
  now = '2026-10-10T04:10:00Z';
  expect(a.manage({ action: 'undo', undoRef: deleted.undo.ref, userTurnRef: 'u' })).toMatchObject({ ok: false }); a.close();
});

it('correction replaces one fact, carries explicit provenance and supports consecutive correction', () => {
  const r = new MemoryRepository(':memory:', 'local', () => NOW);
  r.recordStatement('t1', change(), 'long_term');
  const id = r.snapshot(scope()).preferences[0]!.id;
  expect(r.correctPreference(id, { ...change(), value: 'no_restriction', rule: 'soft' }, 't2')).toMatchObject({ ok: true });
  expect(r.snapshot(scope()).preferences).toHaveLength(1);
  expect(r.snapshot(scope()).preferences[0]).toMatchObject({ value: 'no_restriction', kind: 'explicit', rule: 'soft' });
  expect(r.correctPreference(id, change(), 't3')).toMatchObject({ ok: true });
  expect(r.snapshot(scope()).preferences[0]?.value).toBe('avoid_sugary_drinks'); r.close();
});
it('pause preserves already learned usual while withholding newly completed meals', () => {
  const r = new MemoryRepository(':memory:', 'local', () => NOW);
  r.syncOrders([order(), order('pending','paid')]); r.manage({ action: 'pause', userTurnRef: 'p' });
  r.syncOrders([order(), order('pending','completed'), order('fresh')]);
  expect(r.snapshot(scope()).usual?.sourceOrderId).toBe('o1');
  expect(r.snapshot(scope()).recentCompletedSoloMeals.map(o => o.orderId)).toEqual(['o1']);
  r.manage({ action: 'resume', userTurnRef: 'r' }); r.syncOrders([order('fresh')]);
  expect(r.snapshot(scope()).recentCompletedSoloMeals.map(o => o.orderId)).toEqual(['o1']); r.close();
});
it('invalid batches and missing correction ids are atomic; undo cannot overwrite a later statement', () => {
  const r = new MemoryRepository(':memory:', 'local', () => NOW);
  expect(() => r.syncOrders([order(), { ...order('bad'), items: [{ productId:'chicken', variantId:null, configurationRef:null, quantity: 0 }] }])).toThrow();
  expect(r.snapshot(scope()).preferences).toEqual([]); expect(r.snapshot(scope()).usual).toBeNull();
  r.recordStatement('t', change(), 'long_term');
  expect(r.correctPreference('missing', change(), 'correction')).toMatchObject({ ok: false });
  const id = r.snapshot(scope()).preferences[0]!.id;
  const deleted = r.manage({ action: 'delete', preferenceIds: [id], userTurnRef:'d' });
  if (!deleted.ok || deleted.action === 'list' || !deleted.undo) throw new Error('Missing undo');
  r.recordStatement('later', { ...change(), key: 'food.added_sugar', value: true }, 'long_term');
  expect(r.manage({ action: 'undo', undoRef: deleted.undo.ref, userTurnRef:'u' })).toMatchObject({ ok: false });
  expect(r.snapshot(scope()).preferences.map(p => p.key)).toEqual(['food.added_sugar']); r.close();
});
