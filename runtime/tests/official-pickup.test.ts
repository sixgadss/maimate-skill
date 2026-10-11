import {describe,it,expect} from 'vitest';
import {normalizePickupMenu,normalizePickupQuote,pickupScope,pickupItems,normalizePickupNutrition} from '../src/providers/official-pickup-normalizers.js';
import {createOfficialPickupProfile,type PickupReview} from '../src/providers/official-pickup-profile.js';
import {McdMcpAdapter} from '../src/providers/mcd-mcp-adapter.js';
import {toolSchemaHash,pickupTools} from '../src/official/diagnostics.js';
import type {PurchaseScope,QuoteRequest} from '../src/contracts/provider.js';
import {now,clock,scope,item,request,envelope,tools,review,quoteData} from './fixtures/pickup.js';
describe('document-tested pickup mapping (synthetic contracts, not account verification)',()=>{
 it('uses exact separate monetary units and keeps unknown product facts unknown',()=>{
  const menu=normalizePickupMenu(envelope({meals:{meal:{name:'契约测试主食',currentPrice:'18.90',discountType:null},unknown:{name:'无糖鸡腿营销名',currentPrice:'20',discountType:null},upsell:{name:'会员优惠',currentPrice:'1',discountType:'随单购麦金卡优惠',withOrder:{membershipCode:'106'}}}}),scope,review,clock);
  expect(menu.products.map(p=>p.productId)).toEqual(['meal','unknown']);expect(menu.products[0]!.menuPrice!.amountFen).toBe(1890);expect(menu.products[1]).toMatchObject({category:'unknown',foodTags:null,dietary:{sugarFree:null}});
  for(const amount of ['1e3','-1','1.001','9007199254740992'])expect(()=>normalizePickupMenu(envelope({meals:{meal:{name:'契约测试主食',currentPrice:amount,discountType:null}}}),scope,review,clock)).toThrow();
  expect(normalizePickupQuote(envelope(quoteData),request,review,clock).payable.amountFen).toBe(1890);
 });
 it('keeps sugar unknown when the official nutrition row omits it',()=>{
  expect(normalizePickupNutrition({energyKcal:308,protein:16,sodium:781},'test-nutrition')).toMatchObject({sugarG:null,proteinG:16});
 });
 it('maps immediate pickup only and never manufactures a store or appointment',()=>{
  expect(pickupScope(scope,review,clock)).toEqual({storeCode:'test-store',beCode:'test-be',orderType:1,beType:1});
  for(const s of [{...scope,restaurantId:''},{...scope,channel:'delivery'},{...scope,serviceAt:'2026-10-11T05:00:00.000Z'},{...scope,addressRef:'address'}])expect(()=>pickupScope(s as PurchaseScope,review,clock)).toThrow();
  expect(()=>pickupItems({...request,pointsPlanRef:'points'},[],clock)).toThrow();
 });
 it('attaches a coupon only to one compatible quantity-one item with current evidence',()=>{
  const coupon={couponId:'coupon',couponCode:'code',productIds:['meal'],validFrom:'2026-10-10T04:00:00Z',validUntil:'2026-10-12T04:00:00Z',observedAt:now};
  expect(pickupItems({...request,couponIds:['coupon']},[coupon],clock)).toEqual([{productCode:'meal',quantity:1,couponId:'coupon',couponCode:'code'}]);
  for(const c of [{...coupon,couponCode:''},{...coupon,productIds:['other']},{...coupon,validUntil:now},{...coupon,observedAt:'2026-10-10T04:00:00Z'}])expect(()=>pickupItems({...request,couponIds:['coupon']},[c],clock)).toThrow();
  expect(()=>pickupItems({...request,couponIds:['coupon'],items:[item,item]},[coupon],clock)).toThrow();
 });
 it('validates the basket, complete fees and quote arithmetic instead of inventing them',()=>{
  const q=normalizePickupQuote(envelope(quoteData),request,review,clock);expect(q.completeFees).toBe(true);expect(Date.parse(q.validUntil)-Date.parse(now)).toBe(30000);
  expect(()=>normalizePickupQuote(envelope({...quoteData,price:1800}),request,review,clock)).toThrow();
  expect(()=>normalizePickupQuote(envelope({...quoteData,productList:[{...quoteData.productList[0],quantity:2}]}),request,review,clock)).toThrow();
  expect(()=>normalizePickupQuote(envelope({...quoteData,productList:[{...quoteData.productList[0],productCode:'other'}]}),request,review,clock)).toThrow();
  const {tablewarePrice,...missingFees}=quoteData;expect(normalizePickupQuote(envelope(missingFees),request,review,clock).completeFees).toBe(false);
  expect(()=>normalizePickupQuote(envelope({...quoteData,withOrder:{membershipCode:'106'}}),request,review,clock)).toThrow();
 });
 it('does not admit a default set or a changed name as a verified single product',()=>{
  const changed={...review,products:[{...review.products[0]!,defaultComposition:'unknown' as const}]};
  expect(normalizePickupMenu(envelope({meals:{meal:{name:'契约测试主食',currentPrice:'18.90',discountType:null}}}),scope,changed,clock).products[0]!.category).toBe('unknown');
  expect(normalizePickupMenu(envelope({meals:{meal:{name:'名称已更改',currentPrice:'18.90',discountType:null}}}),scope,review,clock).products[0]!.foodTags).toBe(null);
 });
 it('gates all pickup bindings on account review and every discovered schema',async()=>{
  const transport={listTools:async()=>({tools}),callTool:async()=>{throw Error('no write or account call');}};
  const disabled=new McdMcpAdapter(transport,createOfficialPickupProfile(review,clock),clock);expect((await disabled.capabilities())).toMatchObject({ok:true,data:{menu:false,authoritativeQuote:false}});
  const verified:PickupReview={...review,status:'account_verified',operations:Object.fromEntries(tools.map(t=>[t.name,{status:'account_verified',schemaHash:toolSchemaHash(t)}]))};
  const enabled=new McdMcpAdapter(transport,createOfficialPickupProfile(verified,clock),clock);expect(await enabled.capabilities()).toMatchObject({ok:true,data:{menu:true,authoritativeQuote:true,orderHistory:false,createOrder:false}});
  const changed=new McdMcpAdapter({listTools:async()=>({tools:tools.map(t=>t.name==='query-meal-detail'?{...t,inputSchema:{type:'object',required:['new']}}:t)}),callTool:transport.callTool},createOfficialPickupProfile(verified,clock),clock);
  expect(await changed.capabilities()).toMatchObject({ok:true,data:{menu:false,authoritativeQuote:false}});
  const missing=new McdMcpAdapter({listTools:async()=>({tools:tools.slice(1)}),callTool:transport.callTool},createOfficialPickupProfile(verified,clock),clock);expect(await missing.capabilities()).toMatchObject({ok:true,data:{menu:false}});
  expect(await enabled.createOrder({quoteId:'x',expectedSnapshotHash:'x',idempotencyKey:'x',remark:null})).toMatchObject({ok:false,error:{code:'UNSUPPORTED'}});
 });
});
it('rejects ancillary membership metadata without relying on the marketing label',()=>{
 expect(normalizePickupMenu(envelope({meals:{meal:{name:'契约测试主食',currentPrice:'18.90',discountType:null,withOrder:{membershipCode:'106'}}}}),scope,review,clock).products).toEqual([]);

});

it.each(['mealAssistanceList','takeWayList'])('rejects unreviewed %s quote metadata',(field)=>{expect(()=>normalizePickupQuote(envelope({...quoteData,[field]:[{membershipCode:'106',required:true}]}),request,review,clock)).toThrow();});
