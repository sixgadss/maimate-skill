import type { RecommendationResult } from '../contracts/runtime.js';
import type { WebMealInput, WebMealResponse, RestrictionEvidence } from './contracts.js';
export function presentMeal(result: RecommendationResult, input: WebMealInput, mode: 'fixture' | 'live'): WebMealResponse {
  if (result.status !== 'ready') return {status:result.status,mode,message:result.status==='needs_input'?result.question:result.explanation};
  if (result.mode!==mode || result.options.length!==1 || result.context.scope.channel!=='pickup')
    return {status:'unavailable',mode,message:'当前配餐数据无法核验，请重新查询。'};
  const option=result.options[0]!; const q=option.quote;
  const reasons=[`完整${mode==='fixture'?'示例':''}实付在预算内。`];
  const restrictionEvidence:RestrictionEvidence[]=[];const dietaryLines:string[]=[];
  const unverified=():WebMealResponse=>({status:'unavailable',mode,message:'饮食限制的具体依据不完整，请重新查询。'});
  const products=option.items.map(item=>result.evidence.find(e=>e.kind==='menu'&&e.certainty==='verified'&&e.sourceRef===item.productId));
  if(input.avoidSugaryDrinks){
    if(products.some(p=>!p || p.facts.category==='unknown'))return unverified();
    const drinks=products.filter(p=>p!.facts.category==='drink');
    if(!drinks.length){
      restrictionEvidence.push({restriction:'sugar',basis:'no_drink',productId:null,productName:null,value:null,evidenceIds:products.map(p=>p!.id)});
      reasons.push('本组合不含饮品。');dietaryLines.push('饮品限制：所选商品的分类均不是饮品。');
    }else{
      for(const drink of drinks){
        const p=drink!;const nutrition=result.evidence.find(e=>e.kind==='nutrition'&&e.certainty==='verified'&&e.sourceRef===p.sourceRef);
        const metadata=p.facts.sugarFree===true&&typeof p.facts.dietaryEvidenceId==='string'&&p.facts.dietaryEvidenceId.length>0;
        if(!metadata && nutrition?.facts.sugarG!==0)return unverified();
        restrictionEvidence.push({restriction:'sugar',basis:metadata?'dietary_metadata':'nutrition',productId:p.sourceRef,productName:String(p.facts.name),value:metadata?true:0,evidenceIds:[metadata?String(p.facts.dietaryEvidenceId):nutrition!.id]});
        dietaryLines.push(`${p.facts.name}：${metadata?'饮食元数据标明不含糖':'营养数据标明每份糖 0 克'}。`);
      }
      reasons.push('所选饮品有不含糖的具体依据。');
    }
  }
  if(input.excludeChicken){
    for(const p of products){
      if(!p || p.facts.containsChicken!==false)return unverified();
      restrictionEvidence.push({restriction:'chicken',basis:'food_tags',productId:p.sourceRef,productName:String(p.facts.name),value:false,evidenceIds:[p.id]});
      dietaryLines.push(`${p.facts.name}：已提供的食材标签中不含鸡肉。`);
    }
    reasons.push('所选餐品的食材标签通过不吃鸡肉限制。');
  }
  return {status:'ready',mode,meal:{
    items:option.items.map((item,index)=>({productId:item.productId,name:option.itemNames[index]??'餐品名称待核对',quantity:item.quantity})),
    budgetFen:input.budgetMaxFen,payableFen:q.payable.amountFen,subtotalFen:q.itemsSubtotal.amountFen,
    fees:q.requiredFees.map(f=>({label:f.kind==='delivery'?'配送费':f.kind==='tableware'?'餐具费':'必付费用',amountFen:f.amount.amountFen})),
    discounts:q.discounts.map(d=>({label:mode==='fixture'?'示例用券优惠':'已核验优惠',amountFen:d.amount.amountFen})),
    reasons,restrictionEvidence,evidence:[...dietaryLines,mode==='fixture'?'商品、价格和饮食证据来自合成示例数据。':'商品可售、费用和限制依据已由接入数据核验。',
      '仅搜索了有限候选，不代表全菜单最低价。','刷新期限由本机设置，不是供应商锁价。'],
    observedAt:q.observedAt,validUntil:q.validUntil,restaurantId:q.request.scope.restaurantId,channel:'pickup',
    source:mode==='fixture'?'合成示例':'麦当劳官方 MCP',
  }};
}
