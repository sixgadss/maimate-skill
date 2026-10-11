import type { PurchaseScope, QuoteRequest, OrderQuote, Product, Nutrition } from '../contracts/provider.js';
import { z } from 'zod';
import { canonicalFingerprint, stableHash, validateQuote, quoteRequestSchema, scopeSchema, moneySchema, itemSchema, iso, safeInt, channelSchema } from '../domain/schemas.js';
const metric = z.number().finite().nonnegative().nullable();
export const nutritionSchema = z.object({ energyKcal:metric,proteinG:metric,sugarG:metric,sodiumMg:metric,basis:z.literal('per_serving'),evidenceId:z.string().min(1) }).strict();
export const productSchema = z.object({productId:z.string().min(1),variantId:z.string().nullable(),name:z.string().min(1),category:z.enum(['main','side','drink','set','unknown']),
  foodTags:z.array(z.string()).nullable(),saleStatus:z.enum(['available','unavailable','unknown']),menuPrice:moneySchema.nullable(),nutrition:nutritionSchema.nullable(),
  dietary:z.object({sugarFree:z.boolean().nullable(),addedSugar:z.boolean().nullable(),allergens:z.array(z.string()).nullable(),evidenceId:z.string().nullable()}).strict(),
  configurationRefs:z.array(z.string()),evidenceId:z.string().min(1)}).strict();
export const menuSchema=z.object({scope:scopeSchema,products:z.array(productSchema).max(2000),snapshotId:z.string().min(1)}).strict();
export const couponSchema=z.object({id:z.string().min(1),title:z.string(),held:z.boolean(),validFrom:iso.nullable(),validUntil:iso.nullable(),
  eligibility:z.enum(['eligible','ineligible','needs_quote']),stacking:z.enum(['verified','unknown']),evidenceId:z.string().min(1)}).strict();
export const receiptSchema=z.object({orderId:z.string().min(1),provider:z.string().min(1),scope:scopeSchema,items:z.array(itemSchema).min(1),
  status:z.enum(['created','awaiting_payment','paid','completed','cancelled','failed','unknown']),payable:moneySchema.nullable(),paymentUrl:z.string().nullable(),createdAt:iso,evidenceId:z.string().min(1)}).strict();
export const restaurantSchema=z.object({id:z.string().min(1),businessEntityId:z.string().nullable(),name:z.string(),supportedChannels:z.array(channelSchema),available:z.boolean().nullable(),distanceMeters:metric}).strict();
export function decimalToFen(v:unknown,unit:'yuan'|'fen'):number {
  if ((typeof v!=='string' && typeof v!=='number') || (typeof v==='number' && !Number.isFinite(v))) throw new Error('Invalid amount');
  const match=/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(v));
  if(!match || (unit==='fen' && match[2])) throw new Error('Unverified monetary precision');
  const amount=unit==='fen' ? BigInt(match[1]!) : BigInt(match[1]!)*100n+BigInt((match[2]??'').padEnd(2,'0'));
  if(amount>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unsafe amount'); return Number(amount);
}
/** Public documented codes; a binding must verify these for its account/channel. */
export function nativeScope(raw:PurchaseScope):Record<string,unknown> {
  const s=scopeSchema.parse(raw); const beType={pickup:1,delivery:2,dine_in:1,drive_through:5}[s.channel];
  return {storeCode:s.restaurantId,...(s.businessEntityId?{beCode:s.businessEntityId}:{}),orderType:s.channel==='delivery'?2:1,beType,
    reservationDate:s.serviceAt,...(s.addressRef?{addressRef:s.addressRef}:{})};
}
/** Reviewed intermediate shape, NOT an assumed official response schema. */
export function normalizeNativeQuote(raw:unknown,rawRequest:QuoteRequest,unit:'yuan'|'fen',now:string):OrderQuote {
  const amount=z.union([z.string(),z.number()]);
  const n=z.object({subtotal:amount,fees:z.array(z.object({kind:z.string(),amount})).nullable(),
    discounts:z.array(z.object({id:z.string(),amount})),total:amount,sellable:z.boolean(),feesComplete:z.boolean()}).strict().parse(raw);
  const request=quoteRequestSchema.parse(rawRequest); const money=(v:unknown)=>({currency:'CNY' as const,amountFen:decimalToFen(v,unit)});
  const id=stableHash([request,n,now]); const completeFees=n.feesComplete && n.fees!==null;
  return validateQuote({quoteId:`local:${id}`,basketHash:canonicalFingerprint(request.items),snapshotHash:stableHash([request,n]),request,
    itemsSubtotal:money(n.subtotal),requiredFees:(n.fees??[]).map(f=>({kind:f.kind,amount:money(f.amount)})),
    discounts:n.discounts.map(d=>({id:d.id,amount:money(d.amount),evidenceId:`quote:${id}`})),payable:money(n.total),completeFees,verifiedTotal:completeFees,
    pointsRequired:0,sellable:n.sellable,observedAt:now,validUntil:new Date(Date.parse(now)+30000).toISOString(),evidenceId:`quote:${id}`});
}
export function matchNutritionByName(p:Product,catalog:Product[],rows:Array<{name:string;nutrition:Nutrition}>):Nutrition|null {
  if(p.variantId!==null || p.configurationRefs.length>0 || catalog.filter(x=>x.name===p.name).length!==1) return null;
  const matches=rows.filter(x=>x.name===p.name); return matches.length===1 ? nutritionSchema.parse(matches[0]!.nutrition) : null;
}
