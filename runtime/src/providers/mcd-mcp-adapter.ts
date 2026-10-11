import { z } from 'zod';
import { decode } from '@toon-format/toon';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';
import type { McDonaldsProvider, ProviderResult, ProviderErrorCode, PurchaseScope, QuoteRequest, CreateOrderRequest, OrderReceipt, ProviderCapabilities } from '../contracts/provider.js';
import { type McpTransport, type NativeTool, type NativeResult, TransportFailure } from './mcp-transport.js';
import { menuSchema, couponSchema, productSchema, receiptSchema, restaurantSchema, nutritionSchema } from './native-normalizers.js';
import { itemSchema, iso, quoteSchema, validateQuote } from '../domain/schemas.js';
const NAMES={getNearbyRestaurants:'query-nearby-stores',getDeliveryRestaurants:'delivery-query-stores',getMenu:'query-meals',
  getProductDetails:'query-meal-detail',getNutrition:'list-nutrition-foods',getAvailablePromotions:'campaign-calendar',
  getUserCoupons:'query-store-coupons',getRecentOrders:'order-list',calculateOrder:'calculate-price',getOrder:'query-order'} as const;
type Operation=keyof typeof NAMES;
export interface Binding { verified:boolean; args:(input:unknown)=>Record<string,unknown>; isSuccess:(raw:unknown)=>boolean; normalize:(raw:unknown,input:unknown)=>unknown }
export interface BindingProfile { id:string; bindings:Partial<Record<Operation,Binding>> }
export const unverifiedProfile:BindingProfile={id:'unverified',bindings:{}};
export class McdMcpAdapter implements McDonaldsProvider {
  private tools=new Map<string,NativeTool>(); private discovered:Promise<void>|null=null;
  private validator=new AjvJsonSchemaValidator();
  constructor(private transport:McpTransport,private profile:BindingProfile,private clock:()=>string) {}
  private async discover() {
    if(!this.discovered) this.discovered=(async()=>{
      let cursor:string|undefined; const seen=new Set<string>(); const collected=new Map<string,NativeTool>();
      for(let page=0;page<50;page++) {
        const result=await this.transport.listTools(cursor);
        for(const t of result.tools) {if(collected.has(t.name)) throw new Error('Duplicate native tool'); collected.set(t.name,t);}
        cursor=result.nextCursor;
        if(!cursor) {this.tools=collected;return;}
        if(seen.has(cursor)) throw new Error('Invalid pagination'); seen.add(cursor);
      }
      throw new Error('Tool listing limit exceeded');
    })().catch(e=>{this.discovered=null;throw e;});
    await this.discovered;
  }
  private enabled(op:Operation) {return !!this.profile.bindings[op]?.verified && this.tools.has(NAMES[op]);}
  private fail<T>(code:ProviderErrorCode):ProviderResult<T> {return {ok:false,error:{code,message:`麦当劳数据接口：${code}`,retryable:['TIMEOUT','RATE_LIMITED','UNAVAILABLE'].includes(code)}};}
  private good<T>(op:string,data:T):ProviderResult<T> {return {ok:true,data,meta:{provider:'mcd-official',tool:op,mode:'live',observedAt:this.clock(),validUntil:null,schemaVersion:this.profile.id}};}
  async capabilities():Promise<ProviderResult<ProviderCapabilities>> {
    try {await this.discover(); return this.good('tools/list',{menu:this.enabled('getMenu'),coupons:this.enabled('getUserCoupons'),authoritativeQuote:this.enabled('calculateOrder'),
      nutrition:this.enabled('getNutrition'),promotions:this.enabled('getAvailablePromotions'),orderHistory:this.enabled('getRecentOrders'),
      points:false,createOrder:false,orderLookup:this.enabled('getOrder'),upstreamIdempotency:false});}
    catch(e){return this.fail(e instanceof TransportFailure?e.code:'UNAVAILABLE');}
  }
  private async invoke<T>(op:Operation,input:unknown,schema:z.ZodType<T>):Promise<ProviderResult<T>> {
    try {
      await this.discover(); if(!this.enabled(op)) return this.fail('UNSUPPORTED');
      const binding=this.profile.bindings[op]!; const tool=this.tools.get(NAMES[op])!; const args=binding.args(input);
      if(!this.validator.getValidator(tool.inputSchema)(args).valid) return this.fail('INVALID_DATA');
      const response=await this.transport.callTool(tool.name,args); if(response.isError) return this.fail('UNAVAILABLE');
      const raw=parseNative(response);
      if(tool.outputSchema && !this.validator.getValidator(tool.outputSchema)(raw).valid) return this.fail('INVALID_DATA');
      if(!binding.isSuccess(raw)) return this.fail('UNAVAILABLE');
      const data=schema.parse(binding.normalize(raw,input)); if(op==='calculateOrder') validateQuote(data);
      return this.good(tool.name,data);
    } catch(e){return this.fail(e instanceof TransportFailure?e.code:'INVALID_DATA');}
  }
  getNearbyRestaurants(input:Parameters<McDonaldsProvider['getNearbyRestaurants']>[0]) {return this.invoke('getNearbyRestaurants',input,z.array(restaurantSchema));}
  getDeliveryRestaurants(input:string) {return this.invoke('getDeliveryRestaurants',input,z.array(restaurantSchema));}
  getMenu(input:PurchaseScope) {return this.invoke('getMenu',input,menuSchema);}
  getProductDetails(input:Parameters<McDonaldsProvider['getProductDetails']>[0]) {return this.invoke('getProductDetails',input,z.object({product:productSchema,allowedConfigurations:z.array(z.object({ref:z.string(),label:z.string(),components:z.array(itemSchema)}))}).strict());}
  getNutrition(input:Parameters<McDonaldsProvider['getNutrition']>[0]) {return this.invoke('getNutrition',input,z.array(z.object({productId:z.string(),variantId:z.string().nullable(),configurationRef:z.string().nullable(),nutrition:nutritionSchema.nullable()}).strict()));}
  getAvailablePromotions(input:PurchaseScope) {return this.invoke('getAvailablePromotions',input,z.array(z.object({id:z.string(),title:z.string(),informationalOnly:z.literal(true),evidenceId:z.string()}).strict()));}
  getUserCoupons(input:PurchaseScope) {return this.invoke('getUserCoupons',input,z.array(couponSchema));}
  getUserPoints():ReturnType<McDonaldsProvider['getUserPoints']> {return Promise.resolve(this.fail('UNSUPPORTED'));}
  getRecentOrders(input:number) {return this.invoke('getRecentOrders',input,z.object({orders:z.array(receiptSchema),coverage:z.enum(['partial','complete']),since:iso.nullable(),nextCursor:z.string().nullable()}).strict());}
  calculateOrder(input:QuoteRequest) {return this.invoke('calculateOrder',input,quoteSchema);}
  createOrder(_input:CreateOrderRequest):Promise<ProviderResult<OrderReceipt>> {return Promise.resolve(this.fail('UNSUPPORTED'));}
  getOrder(input:string) {return this.invoke('getOrder',input,receiptSchema);}
}
function parseNative(result:NativeResult):unknown {
  if(result.structuredContent!==undefined) {
    if(JSON.stringify(result.structuredContent).length>2000000) throw new Error('Oversized response'); return result.structuredContent;
  }
  const texts=(result.content??[]).filter(c=>c.type==='text');
  if(texts.length!==1 || !texts[0]?.text || texts[0].text.length>2000000) throw new Error('Ambiguous response');
  const text=texts[0].text.trim().replace(/^```(?:json|toon)?\s*\n([\s\S]*)\n```$/,'$1');
  try {return JSON.parse(text);} catch {return decode(text);}
}
