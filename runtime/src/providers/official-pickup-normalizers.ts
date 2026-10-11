/** Public-document shapes, gated by a local account review before production use. */
import {z} from 'zod';
import type {PurchaseScope,QuoteRequest,Product,MenuSnapshot,Nutrition} from '../contracts/provider.js';
import {canonicalFingerprint,quoteRequestSchema,scopeSchema,stableHash,iso} from '../domain/schemas.js';
import {decimalToFen,normalizeNativeQuote,nutritionSchema} from './native-normalizers.js';
import type {PickupReview} from './official-pickup-profile.js';
const amount=z.union([z.string(),z.number()]);
export function pickupData(raw:unknown):unknown {return z.object({success:z.literal(true),code:z.literal(200),data:z.unknown()}).passthrough().parse(raw).data;}
export function pickupScope(raw:PurchaseScope,review:PickupReview,clock:()=>string):Record<string,unknown>{
 const s=scopeSchema.parse(raw),age=Date.parse(clock())-Date.parse(s.serviceAt);
 if(s.channel!=='pickup'||s.partySize!==1||s.addressRef!==null||s.pickupMethod!==null||s.restaurantId!==review.restaurantId||s.businessEntityId!==review.businessEntityId||age < -1000||age>60000)throw Error('Unsupported pickup scope');
 return {storeCode:s.restaurantId,...(s.businessEntityId?{beCode:s.businessEntityId}:{}),orderType:1,beType:1};
}
export function normalizePickupMenu(raw:unknown,scope:PurchaseScope,review:PickupReview,clock:()=>string):MenuSnapshot{
 pickupScope(scope,review,clock);
 const data=z.object({meals:z.record(z.string(),z.object({name:z.string().min(1),currentPrice:amount,discountType:z.string().nullable(),withOrder:z.unknown().optional()}).passthrough())}).passthrough().parse(pickupData(raw));
 const products:Product[]=[];
 for(const [productId,n] of Object.entries(data.meals)){
  // A marketed price requiring a membership purchase is not a price for this basket.
  if(n.discountType?.includes('随单购') || (n.withOrder!==undefined && n.withOrder!==null))continue;
  const fact=review.products.find(f=>f.productId===productId&&f.name===n.name&&f.defaultComposition==='single');
  const evidenceId=`menu:${stableHash([productId,n.name,n.currentPrice,clock()])}`;
  products.push({productId,variantId:null,name:n.name,category:fact?.category??'unknown',foodTags:fact?.foodTags??null,
   saleStatus:review.listedMealsAreSellable?'available':'unknown',menuPrice:{currency:'CNY',amountFen:decimalToFen(n.currentPrice,review.units.menu)},nutrition:null,
   dietary:fact?.dietary??{sugarFree:null,addedSugar:null,allergens:null,evidenceId:null},configurationRefs:[],evidenceId:fact?`${evidenceId}:${fact.evidenceId}`:evidenceId});
 }
 return {scope,products,snapshotId:stableHash([products,clock()])};
}
export function normalizePickupNutrition(raw:unknown,evidenceId:string):Nutrition {
 const metric=z.number().finite().nonnegative().nullable().optional();
 const n=z.object({energyKcal:metric,protein:metric,sodium:metric,sugarG:metric}).passthrough().parse(raw);
 return nutritionSchema.parse({energyKcal:n.energyKcal??null,proteinG:n.protein??null,sodiumMg:n.sodium??null,sugarG:n.sugarG??null,basis:'per_serving',evidenceId});
}
export interface PickupCoupon {couponId:string;couponCode:string;productIds:string[];validFrom:string;validUntil:string;observedAt:string}
export function pickupItems(raw:QuoteRequest,coupons:PickupCoupon[],clock:()=>string):Array<Record<string,unknown>>{
 const request=quoteRequestSchema.parse(raw);if(request.pointsPlanRef!==null)throw Error('Points unsupported');
 const items=request.items.map(i=>{if(i.variantId!==null||i.configurationRef!==null)throw Error('Unverified configuration');return {productCode:i.productId,quantity:i.quantity} as Record<string,unknown>;});
 if(request.couponIds.length>1)throw Error('Unverified stacking');
 for(const id of request.couponIds){
  const matches=coupons.filter(c=>c.couponId===id);if(matches.length!==1)throw Error('Unknown coupon');const c=matches[0]!;const now=Date.parse(clock());
  if(!c.couponCode||!Number.isFinite(Date.parse(c.validFrom))||!Number.isFinite(Date.parse(c.validUntil))||!Number.isFinite(Date.parse(c.observedAt))||now<Date.parse(c.validFrom)||now>=Date.parse(c.validUntil)||now<Date.parse(c.observedAt)||now-Date.parse(c.observedAt)>=30000)throw Error('Unverified coupon validity');
  const targets=items.filter(i=>c.productIds.includes(i.productCode as string));if(targets.length!==1||targets[0]!.quantity!==1)throw Error('Ambiguous coupon target');
  Object.assign(targets[0]!,{couponId:id,couponCode:c.couponCode});
 }
 return items;
}
export function normalizePickupQuote(raw:unknown,request:QuoteRequest,review:PickupReview,clock:()=>string){
 pickupScope(request.scope,review,clock);pickupItems({...request,couponIds:[]},[],clock);
 const row=z.object({productCode:z.string(),productName:z.string(),quantity:z.number().int().positive(),originalSubtotal:amount,subtotal:amount}).strict();
 const data=z.object({productOriginalPrice:amount,productPrice:amount,deliveryOriginalPrice:amount.optional(),deliveryPrice:amount.optional(),originalPrice:amount,discount:amount,price:amount,tablewarePrice:amount.optional(),productList:z.array(row),takeWayList:z.array(z.unknown()).max(0).optional(),mealAssistanceList:z.array(z.unknown()).max(0).optional()}).strict().parse(pickupData(raw));
 const unit=review.units.quote,fen=(v:unknown)=>decimalToFen(v,unit);
 if(canonicalFingerprint(data.productList.map(p=>({productId:p.productCode,variantId:null,configurationRef:null,quantity:p.quantity})))!==canonicalFingerprint(request.items))throw Error('Quote basket changed');
 const sum=(field:'subtotal'|'originalSubtotal')=>data.productList.reduce((n,p)=>n+fen(p[field]),0);
 if(sum('originalSubtotal')!==fen(data.productOriginalPrice)||sum('subtotal')!==fen(data.productPrice))throw Error('Quote line total changed');
 const complete=review.completeFeeFields.every(field=>data[field]!==undefined)&&data.deliveryPrice!==undefined;
 const fees=[...(data.deliveryOriginalPrice!==undefined?[{kind:'delivery',amount:data.deliveryOriginalPrice}]:[]),...(data.tablewarePrice!==undefined?[{kind:'tableware',amount:data.tablewarePrice}]:[])];
 const original=fen(data.productOriginalPrice)+fees.reduce((n,f)=>n+fen(f.amount),0);
 if(original!==fen(data.originalPrice)||original-fen(data.discount)!==fen(data.price))throw Error('Quote total changed');
 if(complete&&fen(data.productPrice)+fen(data.deliveryPrice)+fen(data.tablewarePrice)!==fen(data.price))throw Error('Unaccounted charge');
 return normalizeNativeQuote({subtotal:data.productOriginalPrice,fees,discounts:[{id:'official-total-discount',amount:data.discount}],total:data.price,sellable:true,feesComplete:complete},request,unit,clock());
}
export function couponDates(value:string):{validFrom:string;validUntil:string}{
 const match=/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})-(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/.exec(value);if(!match)throw Error('Unknown coupon date format');
 const result={validFrom:iso.parse(match[1]!.replace(' ','T')+'+08:00'),validUntil:iso.parse(match[2]!.replace(' ','T')+'+08:00')};if(Date.parse(result.validUntil)<=Date.parse(result.validFrom))throw Error('Invalid coupon interval');return result;
}
