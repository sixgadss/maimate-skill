import { it, expect } from 'vitest';
import { McdMcpAdapter, type BindingProfile } from '../src/providers/mcd-mcp-adapter.js';
import { decimalToFen, normalizeNativeQuote, matchNutritionByName, nativeScope } from '../src/providers/native-normalizers.js';
import type { McpTransport, NativeTool, NativeResult } from '../src/providers/mcp-transport.js';
import { NOW, scope, product } from './helpers.js';
import { encode } from '@toon-format/toon';
const tool = (name: string): NativeTool => ({ name, inputSchema: { type: 'object' } });
const menu = () => ({ scope: scope(), products: [product()], snapshotId: 'menu:1' });
const profile = (): BindingProfile => ({ id: 'test-verified', bindings: {
  getMenu: { verified: true, args: input => nativeScope(input as ReturnType<typeof scope>),
    isSuccess: raw => (raw as { success?: boolean }).success === true,
    normalize: raw => (raw as { data: unknown }).data },
  getUserCoupons: { verified: true, args: () => ({}), isSuccess: () => true, normalize: raw => raw },
} });
class Fake implements McpTransport {
  calls: Array<{ name:string; args:Record<string,unknown> }> = []; pages: Array<{ tools:NativeTool[]; nextCursor?:string }> = [{ tools:[tool('query-meals'), tool('query-store-coupons')] }];
  result: NativeResult = { structuredContent: { success: true, data: menu() } };
  async listTools(cursor?:string) { return this.pages[cursor ? Number(cursor) : 0]!; }
  async callTool(name:string,args:Record<string,unknown>) { this.calls.push({ name,args }); return this.result; }
}
it('discovers paginated public tools but only enables verified bindings and no order writes', async () => {
  const f = new Fake(); f.pages = [{ tools:[tool('irrelevant')],nextCursor:'1' },{ tools:[tool('query-meals'),tool('create-order')] }];
  const a = new McdMcpAdapter(f,profile(),()=>NOW); const caps = await a.capabilities();
  expect(caps).toMatchObject({ ok:true,data:{ menu:true,coupons:false,createOrder:false,points:false } });
  expect(await a.getUserCoupons(scope())).toMatchObject({ ok:false,error:{code:'UNSUPPORTED'} });
  expect(await a.createOrder({ quoteId:'q',expectedSnapshotHash:'s',idempotencyKey:'k',remark:null })).toMatchObject({ ok:false,error:{code:'UNSUPPORTED'} });
});
it('accepts structured, JSON and TOON responses and maps the configured purchase scope', async () => {
  const f = new Fake(); const a = new McdMcpAdapter(f,profile(),()=>NOW);
  for (const result of [{ structuredContent:{success:true,data:menu()} },{ content:[{type:'text',text:JSON.stringify({success:true,data:menu()})}] },{content:[{type:'text',text:encode({success:true,data:menu()})}]}]) {
    f.result=result; expect(await a.getMenu(scope())).toMatchObject({ok:true,data:{ snapshotId:'menu:1' },meta:{mode:'live'}});
  }
  expect(f.calls[0]?.args).toMatchObject({storeCode:'demo-store',orderType:1,beType:1});
});
it('rejects business errors, isError, output/input schema mismatch and strips private upstream error text', async () => {
  const f = new Fake(); const a = new McdMcpAdapter(f,profile(),()=>NOW);
  for (const result of [{structuredContent:{success:false,data:menu()}},{isError:true,content:[{type:'text',text:'Bearer secret-token phone-number'}]}]) {
    f.result=result; const r=await a.getMenu(scope()); expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toContain('secret-token');
  }
  f.pages=[{tools:[{...tool('query-meals'),outputSchema:{type:'object',required:['requiredNativeField']}}]}];
  f.result={structuredContent:{success:true,data:menu()}};
  expect(await new McdMcpAdapter(f,profile(),()=>NOW).getMenu(scope())).toMatchObject({ok:false,error:{code:'INVALID_DATA'}});
  f.pages=[{tools:[{...tool('query-meals'),inputSchema:{type:'object',required:['missingArg']}}]}];
  expect(await new McdMcpAdapter(f,profile(),()=>NOW).getMenu(scope())).toMatchObject({ok:false,error:{code:'INVALID_DATA'}});
});
it('validates normalized amounts and refuses unreviewed bindings', async () => {
  const f=new Fake(); f.result={structuredContent:{success:true,data:{...menu(),products:[{...product(),menuPrice:{currency:'CNY',amountFen:1.2}}]}}};
  expect(await new McdMcpAdapter(f,profile(),()=>NOW).getMenu(scope())).toMatchObject({ok:false,error:{code:'INVALID_DATA'}});
  const p=profile(); p.bindings.getMenu!.verified=false;
  expect(await new McdMcpAdapter(f,p,()=>NOW).getMenu(scope())).toMatchObject({ok:false,error:{code:'UNSUPPORTED'}});
});
it('converts exact decimal yuan and native totals once, leaves unknown fees unverified', () => {
  expect(decimalToFen('18.90','yuan')).toBe(1890); expect(decimalToFen(18.9,'yuan')).toBe(1890);
  expect(decimalToFen(1890,'fen')).toBe(1890);
  for(const amount of ['1.005','1e3','9007199254740992',-1]) expect(()=>decimalToFen(amount,'yuan')).toThrow();
  const request={scope:scope(),items:[{productId:'main',variantId:null,configurationRef:null,quantity:1}],couponIds:['c'],pointsPlanRef:null,tablewareRequested:false};
  const native={subtotal:'20.00',fees:[{kind:'delivery',amount:'4.00'}],discounts:[{id:'c',amount:'2.00'}],total:'22.00',sellable:true,feesComplete:true};
  expect(normalizeNativeQuote(native,request,'yuan',NOW).payable.amountFen).toBe(2200);
  expect(normalizeNativeQuote({...native,fees:null,feesComplete:false,total:'18.00'},request,'yuan',NOW)).toMatchObject({completeFees:false,verifiedTotal:false});
  expect(()=>normalizeNativeQuote({...native,total:'20.00'},request,'yuan',NOW)).toThrow();
});
it('nutrition name matches require one exact product and one exact native row', () => {
  const p=product(); const n={energyKcal:400,proteinG:20,sugarG:0,sodiumMg:null,basis:'per_serving' as const,evidenceId:'n'};
  expect(matchNutritionByName(p,[p],[{name:p.name,nutrition:n}])).toEqual(n);
  expect(matchNutritionByName(p,[p,{...p,productId:'other'}],[{name:p.name,nutrition:n}])).toBeNull();
  expect(matchNutritionByName(p,[p],[{name:p.name,nutrition:n},{name:p.name,nutrition:n}])).toBeNull();
});
