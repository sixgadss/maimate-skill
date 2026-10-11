import {z} from 'zod';
import type {PurchaseScope,QuoteRequest,Product} from '../contracts/provider.js';
import type {BindingProfile,Binding} from './mcd-mcp-adapter.js';
import {pickupTools} from '../official/diagnostics.js';
import {productSchema} from './native-normalizers.js';
import {pickupScope,pickupData,pickupItems,normalizePickupMenu,normalizePickupQuote,couponDates,type PickupCoupon} from './official-pickup-normalizers.js';
export interface PickupReview {
 status:'document_tested'|'account_verified';restaurantId:string;businessEntityId:string|null;
 operations:Partial<Record<typeof pickupTools[number],{status:'document_tested'|'account_verified';schemaHash:string}>>;
 units:{menu:'yuan';detail:'yuan';quote:'fen'};completeFeeFields:Array<'deliveryOriginalPrice'|'tablewarePrice'>;listedMealsAreSellable:boolean;
 products:Array<{productId:string;name:string;category:Product['category'];foodTags:string[]|null;defaultComposition:'single'|'unknown';evidenceId:string;dietary:Product['dietary']}>;
}
const opNames={getNearbyRestaurants:'query-nearby-stores',getMenu:'query-meals',getProductDetails:'query-meal-detail',getUserCoupons:'query-store-coupons',calculateOrder:'calculate-price'} as const;
export function createOfficialPickupProfile(review:PickupReview,clock:()=>string=()=>new Date().toISOString()):BindingProfile{
 // The factory records evidence status; calling it never certifies an account.
 z.object({status:z.enum(['document_tested','account_verified']),restaurantId:z.string().min(1),businessEntityId:z.string().min(1).nullable(),units:z.object({menu:z.literal('yuan'),detail:z.literal('yuan'),quote:z.literal('fen')}),completeFeeFields:z.array(z.enum(['deliveryOriginalPrice','tablewarePrice'])),listedMealsAreSellable:z.boolean()}).passthrough().parse(review);
 if(new Set(review.completeFeeFields).size!==2||review.completeFeeFields.length!==2)throw Error('Incomplete fee review');
 if(new Set(review.products.map(p=>p.productId)).size!==review.products.length)throw Error('Duplicate product evidence');
 for(const fact of review.products)productSchema.pick({productId:true,name:true,category:true,foodTags:true,evidenceId:true,dietary:true}).extend({defaultComposition:z.enum(['single','unknown'])}).parse(fact);
 let coupons:PickupCoupon[]=[],couponScope='';
 const scopeArgs=(input:unknown)=>pickupScope(input as PurchaseScope,review,clock);
 const bindings:BindingProfile['bindings']={};
 const add=(op:keyof typeof opNames,args:Binding['args'],normalize:Binding['normalize'])=>{
  const evidence=review.operations[opNames[op]];if(!evidence)return;
  if(!/^[a-f0-9]{64}$/.test(evidence.schemaHash))throw Error('Invalid schema fingerprint');
  bindings[op]={verified:review.status==='account_verified'&&evidence.status==='account_verified',expectedSchemaHash:evidence.schemaHash,args,isSuccess:raw=>{try{pickupData(raw);return true;}catch{return false;}},normalize};
 };
 add('getNearbyRestaurants',input=>{
  const i=z.object({channel:z.literal('pickup'),city:z.string().optional(),keyword:z.string().optional(),coordinates:z.object({longitude:z.number().min(-180).max(180),latitude:z.number().min(-90).max(90)}).optional()}).strict().parse(input);
  if(i.coordinates)return {searchType:3,beType:1,...i.coordinates};
  if(i.city&&i.keyword)return {searchType:2,beType:1,city:i.city,keyword:i.keyword};
  if(i.city||i.keyword)throw Error('Incomplete location');return {searchType:1,beType:1};
 },raw=>z.array(z.object({storeCode:z.string().min(1),beCode:z.string().nullable().optional(),storeName:z.string(),businessStatus:z.boolean().optional()}).passthrough()).parse(pickupData(raw)).map(s=>({id:s.storeCode,businessEntityId:s.beCode??null,name:s.storeName,supportedChannels:['pickup'],available:s.businessStatus??null,distanceMeters:null})));
 add('getMenu',scopeArgs,(raw,input)=>normalizePickupMenu(raw,input as PurchaseScope,review,clock));
 add('getProductDetails',input=>{const i=input as {scope:PurchaseScope;productId:string;variantId:string|null;configurationRef:string|null};if(i.variantId!==null||i.configurationRef!==null)throw Error('Unsupported configuration');return {...scopeArgs(i.scope),code:i.productId};},(raw,input)=>{
  const i=input as {scope:PurchaseScope;productId:string};const n=z.object({code:z.string(),name:z.string(),price:z.union([z.number(),z.string()]),rounds:z.array(z.unknown()).max(0)}).passthrough().parse(pickupData(raw));
  if(n.code!==i.productId)throw Error('Product changed');
  const menu=normalizePickupMenu({success:true,code:200,data:{meals:{[n.code]:{name:n.name,currentPrice:n.price,discountType:null}}}},i.scope,review,clock);
  return {product:menu.products[0],allowedConfigurations:[]};
 });
 add('getUserCoupons',scopeArgs,(raw,input)=>{
  coupons=[];couponScope='';const s=input as PurchaseScope;scopeArgs(s);
  const rows=z.array(z.object({couponId:z.string().min(1),couponCode:z.string().min(1),title:z.string(),tradeDateTime:z.string(),products:z.array(z.object({productCode:z.string().min(1)}).passthrough()).min(1)}).passthrough()).parse(pickupData(raw));
  const normalized=rows.map(c=>({...c,...couponDates(c.tradeDateTime),observedAt:clock(),productIds:c.products.map(p=>p.productCode)}));
  if(new Set(normalized.map(c=>c.couponId)).size!==normalized.length)throw Error('Duplicate coupons');coupons=normalized;couponScope=JSON.stringify(scopeArgs(s));
  return normalized.map(c=>({id:c.couponId,title:c.title,held:true,validFrom:c.validFrom,validUntil:c.validUntil,eligibility:'needs_quote',stacking:'unknown',evidenceId:`coupon:${c.couponId}:${c.observedAt}`}));
 });
 add('calculateOrder',input=>{
  const r=input as QuoteRequest;const args=scopeArgs(r.scope);if(r.couponIds.length&&couponScope!==JSON.stringify(args))throw Error('Coupon scope changed');
  for(const i of r.items)if(!review.products.some(p=>p.productId===i.productId&&p.defaultComposition==='single'&&p.category!=='unknown'&&p.category!=='set'))throw Error('Unverified product composition');
  return {...args,needTableware:r.tablewareRequested,items:pickupItems(r,coupons,clock)};
 },(raw,input)=>normalizePickupQuote(raw,input as QuoteRequest,review,clock));
 return {id:'official-pickup-v1',verification:review.status,requiredOperations:Object.keys(opNames) as Array<keyof typeof opNames>,bindings};
}
