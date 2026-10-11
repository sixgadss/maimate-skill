import { it,expect } from 'vitest';
import { MemoryRepository } from '../src/memory/repository.js';
import { FixtureProvider } from '../src/providers/fixture-provider.js';
import { McMateRuntime } from '../src/application/runtime.js';
import { LocalTurnRegistry,unverifiedHost } from '../src/application/turn-verifier.js';
import { defaultConfig } from '../src/config.js';
import { NOW,scope } from './helpers.js';
import type { FeedbackRequest,RecommendRequest } from '../src/contracts/runtime.js';
const config={...defaultConfig(),restaurantId:'demo-store',channel:'pickup' as const};
function setup(provider=new FixtureProvider(()=>NOW),verifier=new LocalTurnRegistry()) {
  const memory=new MemoryRepository(':memory:','local',()=>NOW);
  return {memory,verifier,runtime:new McMateRuntime(provider,memory,config,()=>NOW,verifier)};
}
const request=(v:LocalTurnRegistry,utterance:string,intent:RecommendRequest['intent']):RecommendRequest=>({userTurnRef:v.register(utterance,{kind:'recommend',utterance}),utterance,intent});
function statement(v:LocalTurnRegistry,text:string,persistence:'session'|'long_term'='long_term'):FeedbackRequest {
  return {kind:'statement',text,persistence,userTurnRef:v.register(text,{kind:'statement',text,persistence})};
}
it('connects budget, workout and choose-one scenarios to grounded quotes and evidence', async()=>{
  const s=setup();
  for(const [text,intent] of [['20 块以内，吃饱一点。',{budgetMaxFen:2000,mode:'value',goal:'satisfying'}],['今天刚健完身。',{mode:'post_workout'}],['今天你帮我选一个。',{chooseOne:true}]] as const) {
    const r=await s.runtime.recommend(request(s.verifier,text,intent));
    if(r.status!=='ready') throw new Error(JSON.stringify(r));
    expect(r.mode).toBe('fixture'); expect(r.options.length).toBeLessThanOrEqual(text.includes('一个')?1:3);
    for(const o of r.options) { expect(o.quote.payable.amountFen).toBe(o.quote.itemsSubtotal.amountFen+o.quote.requiredFees.reduce((a,b)=>a+b.amount.amountFen,0)-o.quote.discounts.reduce((a,b)=>a+b.amount.amountFen,0));
      for(const reason of o.reasons) expect(reason.evidenceIds.every(id=>r.evidence.some(e=>e.id===id))).toBe(true); }
    if(text.includes('健')) expect(r.options[0]?.items[0]?.productId).toBe('chicken');
  } s.memory.close();
});
it('trusted completed history feeds usual; accepting a recommendation creates no completed meal',async()=>{
  const p=new FixtureProvider(()=>NOW,{orders:[{orderId:'completed',provider:'synthetic',scope:scope(),items:[{productId:'chicken',variantId:null,configurationRef:null,quantity:1},{productId:'zero',variantId:null,configurationRef:null,quantity:1}],status:'completed',payable:null,paymentUrl:null,createdAt:'2026-10-09T04:00:00.000Z',evidenceId:'old'}]});
  const s=setup(p); const r=await s.runtime.recommend(request(s.verifier,'老样子。',{mode:'usual'}));
  if(r.status!=='ready') throw new Error(JSON.stringify(r));
  expect(r.options[0]?.items.map(i=>i.productId)).toEqual(['chicken','zero']);
  const action={kind:'accepted' as const,recommendationId:r.recommendationId,candidateId:r.options[0]!.candidateId};
  expect(await s.runtime.feedback({...action,userTurnRef:s.verifier.register('就它',action)})).toMatchObject({ok:true});
  expect(s.memory.snapshot(scope()).recentCompletedSoloMeals).toHaveLength(1); s.memory.close();
});
it('zero sugar survives new runtime instances; today-only statements do not become durable facts',async()=>{
  const s=setup(); expect(await s.runtime.feedback(statement(s.verifier,'我不喝有糖饮料。'))).toMatchObject({ok:true});
  const second=new McMateRuntime(new FixtureProvider(()=>NOW),s.memory,config,()=>NOW,s.verifier);
  const r=await second.recommend(request(s.verifier,'今天吃什么？',{}));
  if(r.status!=='ready') throw new Error(JSON.stringify(r));
  expect(r.context.hard.avoidSugaryDrinks).toBe(true); expect(r.options.every(o=>o.items.every(i=>i.productId!=='cola'))).toBe(true);
  expect(await s.runtime.feedback(statement(s.verifier,'今天不吃鸡肉。','session'))).toMatchObject({ok:true,changedScope:['session']});
  const session=await s.runtime.recommend(request(s.verifier,'帮我选',{}));
  if(session.status!=='ready') throw new Error(JSON.stringify(session));
  expect(session.options.every(o=>o.items.every(i=>i.productId!=='chicken'))).toBe(true);
  expect(s.memory.snapshot(scope()).preferences.some(p=>p.key==='food.tag.chicken')).toBe(false); s.memory.close();
});
it('ordinary model turn refs cannot change memory; malformed prose is not guessed',async()=>{
  const s=setup(); const untrusted=new McMateRuntime(new FixtureProvider(()=>NOW),s.memory,config,()=>NOW,unverifiedHost);
  expect(await untrusted.feedback({kind:'statement',text:'我不喝有糖饮料。',persistence:'long_term',userTurnRef:'fake-user-ref'})).toMatchObject({ok:false,error:{code:'UNVERIFIED_TURN'}});
  expect(await untrusted.memory({action:'clear',userTurnRef:'fake'})).toMatchObject({ok:false,error:{code:'UNVERIFIED_TURN'}});
  expect(await s.runtime.feedback(statement(s.verifier,'我明天可能喜欢鸡肉，也可能不喜欢。'))).toMatchObject({ok:false,error:{code:'UNSUPPORTED_STATEMENT'}});
  expect(s.memory.snapshot(scope()).preferences).toEqual([]); s.memory.close();
});
it('deadline and auth failures differ from a valid empty coupon list; history failure preserves usual',async()=>{
  const s=setup();
  const p=new FixtureProvider(()=>NOW); p.getUserCoupons=async()=>({ok:false,error:{code:'AUTH_REQUIRED',message:'secret-token',retryable:false}});
  const denied=await new McMateRuntime(p,s.memory,config,()=>NOW,s.verifier).recommend(request(s.verifier,'吃什么',{}));
  expect(denied).toMatchObject({status:'unavailable',reason:'provider_unavailable',rejectedReasons:[{code:'AUTH_REQUIRED'}]});
  expect(JSON.stringify(denied)).not.toContain('secret-token');
  const hung=new FixtureProvider(()=>NOW); hung.getMenu=()=>new Promise(()=>{});
  expect(await new McMateRuntime(hung,s.memory,{...config,deadlineMs:30},()=>NOW,s.verifier).recommend(request(s.verifier,'吃什么',{}))).toMatchObject({status:'unavailable',rejectedReasons:[{code:'TIMEOUT'}]});
  s.memory.syncOrders([{orderId:'old',provider:'synthetic',scope:scope(),items:[{productId:'chicken',variantId:null,configurationRef:null,quantity:1}],status:'completed',payable:null,paymentUrl:null,createdAt:'2026-10-09T04:00:00Z',evidenceId:'o'}]);
  const badHistory=new FixtureProvider(()=>NOW); badHistory.getRecentOrders=async()=>({ok:false,error:{code:'UNAVAILABLE',message:'history failure',retryable:true}});
  const r=await new McMateRuntime(badHistory,s.memory,config,()=>NOW,s.verifier).recommend(request(s.verifier,'老样子',{mode:'usual'}));
  expect(r.status).toBe('ready'); expect(s.memory.snapshot(scope()).usual?.sourceOrderId).toBe('old'); s.memory.close();
});
it('unverified fees, unavailable stock and mismatched provider scopes never become ready',async()=>{
  const s=setup(); const p=new FixtureProvider(()=>NOW,{deliveryFeeFen:null});
  expect((await new McMateRuntime(p,s.memory,config,()=>NOW,s.verifier).recommend(request(s.verifier,'外送',{channel:'delivery',addressRef:'demo-address'}))).status).toBe('unavailable');
  const mismatch=new FixtureProvider(()=>NOW); const getMenu=mismatch.getMenu.bind(mismatch);
  mismatch.getMenu=async scope=>{const r=await getMenu(scope);return r.ok?{...r,data:{...r.data,scope:{...scope,restaurantId:'wrong'}}}:r;};
  expect((await new McMateRuntime(mismatch,s.memory,config,()=>NOW,s.verifier).recommend(request(s.verifier,'吃什么',{}))).status).toBe('unavailable');
  const stock=new FixtureProvider(()=>NOW,{products:[{...p.products[0]!,saleStatus:'unavailable'}]});
  expect((await new McMateRuntime(stock,s.memory,config,()=>NOW,s.verifier).recommend(request(s.verifier,'吃什么',{}))).status).toBe('unavailable');
  const mixed=new FixtureProvider(()=>NOW); const capabilities=mixed.capabilities.bind(mixed);
  mixed.capabilities=async()=>{const c=await capabilities();return c.ok?{...c,meta:{...c.meta,mode:'live'}}:c;};
  expect((await new McMateRuntime(mixed,s.memory,config,()=>NOW,s.verifier).recommend(request(s.verifier,'吃什么',{}))).status).toBe('unavailable');
  s.memory.close();
});
