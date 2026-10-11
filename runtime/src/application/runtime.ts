import type { McDonaldsProvider,ProviderResult,ProviderErrorCode,Product } from '../contracts/provider.js';
import type { RecommendRequest, FeedbackRequest, MemoryAction, RecommendationResult, MemoryResult } from '../contracts/runtime.js';
import type { MemoryRepository } from '../memory/repository.js';
import type { Config } from '../config.js';
import type { TurnVerifier } from './turn-verifier.js';
import type { MemorySnapshot,Preference } from '../contracts/memory.js';
import { recommendSchema, stableHash } from '../domain/schemas.js';
import { resolveContext } from '../domain/context.js';
import { recommendMeals } from '../domain/engine.js';
import { menuSchema,couponSchema,nutritionSchema } from '../providers/native-normalizers.js';
import { parsePreference } from './preferences-parser.js';
import { feedbackSchema,memoryActionSchema } from './action-schemas.js';
class RuntimeFailure extends Error {constructor(readonly code:ProviderErrorCode){super(code);}}
export type FeedbackResult={ok:true;kind:FeedbackRequest['kind'];changedScope:string[]}|{ok:false;error:{code:string;message:string}};
export class McMateRuntime {
  private session:Preference[]=[]; private catalog:Product[]=[]; private providerName='unknown';
  constructor(private provider:McDonaldsProvider,private repository:MemoryRepository,private config:Config,private clock:()=>string,private verifier:TurnVerifier) {}
  private empty():MemorySnapshot {
    const listed=this.repository.manage({action:'list'}); if(!listed.ok || listed.action!=='list') throw new Error('Memory unavailable');
    return {preferences:[...listed.preferences,...this.session],settings:listed.settings,usual:null,recentCompletedSoloMeals:[],historyCoverage:'unavailable'};
  }
  private withSession(m:MemorySnapshot):MemorySnapshot {
    const keys=this.session.map(p=>p.key); return {...m,preferences:[...m.preferences.filter(p=>!keys.includes(p.key)),...this.session]};
  }
  async recommend(raw:RecommendRequest):Promise<RecommendationResult> {
    const deadline=Date.now()+this.config.deadlineMs;
    const read=async<T>(fn:()=>Promise<ProviderResult<T>>):Promise<ProviderResult<T>>=>{
      const remaining=deadline-Date.now(); if(remaining<=0) throw new RuntimeFailure('TIMEOUT');
      let timer:ReturnType<typeof setTimeout>|undefined;
      try {return await Promise.race([fn(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new RuntimeFailure('TIMEOUT')),remaining);})]);}
      finally {if(timer) clearTimeout(timer);}
    };
    try {
      const request=recommendSchema.parse(raw),now=this.clock();
      let resolved=resolveContext(request,this.empty(),this.config,now); if(resolved.status!=='context') return resolved;
      const cap=await read(()=>this.provider.capabilities()); if(!cap.ok) throw new RuntimeFailure(cap.error.code);
      if(!cap.data.menu || !cap.data.authoritativeQuote) throw new RuntimeFailure('UNSUPPORTED');
      const mode=cap.meta.mode; this.providerName=cap.meta.provider;
      const trusted=this.verifier.verify(request.userTurnRef,{kind:'recommend',utterance:request.utterance});
      const notices:string[]=[];
      if(cap.data.orderHistory && trusted) {
        const history=await read(()=>this.provider.getRecentOrders(10));
        if(history.ok && history.meta.mode===mode) this.repository.syncOrders(history.data.orders);
        else notices.push('历史订单暂时无法同步，保留已有的本地记忆。');
      }
      const snapshot=this.withSession(this.repository.snapshot(resolved.context.scope));
      resolved=resolveContext(request,snapshot,this.config,now); if(resolved.status!=='context') return resolved;
      const ctx=resolved.context;
      const menu=await read(()=>this.provider.getMenu(ctx.scope)); if(!menu.ok) throw new RuntimeFailure(menu.error.code);
      if(menu.meta.mode!==mode || stableHash(menu.data.scope)!==stableHash(ctx.scope)) throw new RuntimeFailure('INVALID_DATA');
      const parsedMenu=menuSchema.parse(menu.data); const products=structuredClone(parsedMenu.products); const missing:string[]=[];
      if(cap.data.nutrition && products.some(p=>p.nutrition===null)) {
        const n=await read(()=>this.provider.getNutrition({scope:ctx.scope,items:products.slice(0,80).map(p=>({productId:p.productId,variantId:p.variantId,configurationRef:null,quantity:1}))}));
        if(n.ok && n.meta.mode===mode) for(const p of products) {
          const rows=n.data.filter(row=>row.productId===p.productId && row.variantId===p.variantId && row.configurationRef===null);
          if(rows.length===1 && rows[0]!.nutrition) p.nutrition=nutritionSchema.parse(rows[0]!.nutrition);
        }
        else missing.push('nutrition');
      }
      this.catalog=products;
      let coupons:ReturnType<typeof couponSchema.parse>[]=[];
      if(cap.data.coupons) {
        const c=await read(()=>this.provider.getUserCoupons(ctx.scope));
        if(!c.ok) {
          if(c.error.code!=='UNSUPPORTED') throw new RuntimeFailure(c.error.code); missing.push('coupons');
        } else {if(c.meta.mode!==mode) throw new RuntimeFailure('INVALID_DATA');coupons=c.data.map(x=>couponSchema.parse(x));}
      } else missing.push('coupons');
      const result=await recommendMeals({products,coupons,context:ctx,memory:snapshot,config:this.config,now,clock:this.clock,mode,
        quote:r=>read(()=>this.provider.calculateOrder(r))});
      if(Date.now()>=deadline) throw new RuntimeFailure('TIMEOUT');
      if(result.status==='ready') {
        if(Date.parse(result.validUntil)<=Date.parse(this.clock())) throw new RuntimeFailure('QUOTE_CHANGED');
        result.notices.push(...notices); result.missingData=[...new Set([...result.missingData,...missing])];
        if(trusted) this.repository.saveDecision(result); return result;
      }
      if(result.status!=='unavailable') return result;
      const auth=result.rejectedReasons.find(x=>['AUTH_REQUIRED','TIMEOUT','RATE_LIMITED'].includes(x.code));
      return auth?this.unavailable(auth.code as ProviderErrorCode):result;
    } catch(e) {return this.unavailable(e instanceof RuntimeFailure?e.code:'INVALID_DATA');}
  }
  private unavailable(code:ProviderErrorCode):RecommendationResult {
    return {status:'unavailable',reason:['INVALID_DATA','UNSUPPORTED','QUOTE_CHANGED'].includes(code)?'data_unverified':'provider_unavailable',
      explanation:`当前数据暂时无法核验（${code}）。`,nextAction:code==='AUTH_REQUIRED'?'连接并授权麦当劳账号后再查询。':'保留当前限制，核对接入或稍后重查。',rejectedReasons:[{code,count:1}]};
  }
  private error(code:string):{ok:false;error:{code:string;message:string}} {return {ok:false,error:{code,message:`操作未执行：${code}`}};}
  async feedback(raw:FeedbackRequest):Promise<FeedbackResult> {
    const parsed=feedbackSchema.safeParse(raw); if(!parsed.success) return this.error('INVALID_INPUT');
    const r=parsed.data; const {userTurnRef,...action}=r;
    if(!this.verifier.verify(userTurnRef,action)) return this.error('UNVERIFIED_TURN');
    if(r.kind==='accepted' || r.kind==='rejected') {
      const decision=this.repository.getDecision(r.recommendationId);
      if(!decision || !decision.options.some(o=>o.candidateId===r.candidateId)) return this.error('UNKNOWN_RECOMMENDATION');
      if(Date.parse(decision.validUntil)<=Date.parse(this.clock())) return this.error('EXPIRED_RECOMMENDATION');
      this.repository.recordDecisionFeedback(r.recommendationId,r.candidateId,r.kind,userTurnRef);
      return {ok:true,kind:r.kind,changedScope:['decision_feedback']};
    }
    if(!('text' in r)) return this.error('INVALID_INPUT');
    const p=parsePreference(r.text,this.catalog,this.providerName);
    if(!p) return this.error('UNSUPPORTED_STATEMENT');
    if(r.kind==='meal_feedback') {
      const order=this.repository.getCompletedOrder(r.orderId);
      if(!order) return this.error('COMPLETED_ORDER_REQUIRED');
      if(p.change.target && !order.items.some(i=>i.productId===p.change.target!.productId)) return this.error('ORDER_PRODUCT_MISMATCH');
    }
    const persistence=r.kind==='statement'?r.persistence:'long_term';
    if(p.sessionOnly && persistence==='long_term') return this.error('SESSION_ONLY_STATEMENT');
    if(persistence==='session') {
      const preference:Preference={id:stableHash([userTurnRef,p.change]),userId:this.config.userId,...p.change,kind:'explicit',confidence:null,sourceEventIds:[userTurnRef],updatedAt:this.clock(),expiresAt:null};
      this.session=[...this.session.filter(x=>x.key!==preference.key),preference];
    } else this.repository.recordStatement(userTurnRef,p.change,'long_term');
    return {ok:true,kind:r.kind,changedScope:[persistence==='session'?'session':p.change.key]};
  }
  async memory(raw:MemoryAction):Promise<MemoryResult> {
    const parsed=memoryActionSchema.safeParse(raw); if(!parsed.success) return this.error('INVALID_INPUT');
    const r=parsed.data; if(r.action==='list') return this.repository.manage(r);
    const {userTurnRef,...action}=r;
    if(!this.verifier.verify(userTurnRef,{kind:'memory',...action})) return this.error('UNVERIFIED_TURN');
    if(r.action==='correct') {
      const p=parsePreference(r.text,this.catalog,this.providerName);
      if(!p || p.sessionOnly) return this.error('UNSUPPORTED_STATEMENT');
      return this.repository.correctPreference(r.preferenceId,p.change,userTurnRef);
    }
    const result=this.repository.manage(r); if(result.ok && r.action==='clear') this.session=[]; return result;
  }
}
