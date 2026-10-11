import { it, expect } from 'vitest';
import { parseBudget, createMealState, formatMoney } from '../web/state.js';
it('converts typed yuan exactly and rejects malformed amounts',()=>{
 for(const [text,value] of [['30',3000],['30.01',3001],['0',0],['0.10',10]] as const)expect(parseBudget(text)).toBe(value);
 for(const text of ['-1','1e3','1.005','Infinity','','9007199254740992'])expect(parseBudget(text)).toBeNull();
});
it('rejects delayed results after controls change',()=>{
 const s=createMealState();const old=s.invalidate();const newer=s.invalidate();
 expect(s.accept(old,{status:'ready',meal:{validUntil:'2026-10-11T08:00:00Z'}})).toBe(false);
 expect(s.view(Date.parse('2026-10-11T07:00:00Z')).phase).not.toBe('ready');
 expect(s.accept(newer,{status:'ready',meal:{validUntil:'2026-10-11T08:00:00Z'}})).toBe(true);
 expect(s.view(Date.parse('2026-10-11T07:00:00Z')).phase).toBe('ready');
 s.invalidate();expect(s.view(Date.parse('2026-10-11T07:00:00Z')).phase).toBe('stale');
});
it('marks a returned quote expired at the exact boundary',()=>{
 const s=createMealState();s.accept(s.invalidate(),{status:'ready',meal:{validUntil:'2026-10-11T08:00:00Z'}});
 expect(s.view(Date.parse('2026-10-11T08:00:00Z')).phase).toBe('expired');
});

it('preserves every cent when rendering large safe integer amounts',()=>{
 expect(formatMoney(Number.MAX_SAFE_INTEGER)).toBe('¥90071992547409.91');expect(formatMoney(1890)).toBe('¥18.90');expect(formatMoney(0)).toBe('¥0.00');
});
