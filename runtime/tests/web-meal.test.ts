import { it, expect } from 'vitest';
import { webMealInput } from '../src/web/contracts.js';
import { createWebEnvironment } from '../src/web/environment.js';
const input={budgetMaxFen:3000,avoidSugaryDrinks:true,excludeChicken:false};
it('rejects unsafe budgets and extra authority-bearing fields',()=>{
 for(const value of [-1,1.2,'30',Number.MAX_SAFE_INTEGER+1]) expect(webMealInput.safeParse({...input,budgetMaxFen:value}).success).toBe(false);
 expect(webMealInput.safeParse({...input,userId:'another-user'}).success).toBe(false);
 expect(webMealInput.safeParse({...input,budgetMaxFen:0}).success).toBe(true);
});
it('uses real runtime constraints and leaves memory unchanged',async()=>{
 const env=await createWebEnvironment({mode:'fixture'});
 try {
  const first=await env.recommend(input);
  expect(first.status).toBe('ready');
  if(first.status==='ready'){
   expect(first.mode).toBe('fixture');expect(first.meal.payableFen).toBeLessThanOrEqual(3000);
   expect(first.meal.items.some(i=>i.productId==='cola')).toBe(false);
   expect(first.meal.items.some(i=>['chicken','beef','fish'].includes(i.productId))).toBe(true);
   expect(first.meal.items.every(i=>i.quantity===1)).toBe(true);
  }
  const second=await env.recommend({...input,excludeChicken:true});
  expect(second.status).toBe('ready');
  if(second.status==='ready')expect(second.meal.items.some(i=>i.productId==='chicken')).toBe(false);
  expect(env.repository.manage({action:'list'})).toMatchObject({ok:true,preferences:[]});
 }finally{await env.close();}
});
it('does not relax a zero budget or leak internal data in public status',async()=>{
 const env=await createWebEnvironment({mode:'fixture'});
 try {
  expect(await env.recommend({...input,budgetMaxFen:0})).toMatchObject({status:'unavailable'});
  const status=await env.status();expect(status).toMatchObject({mode:'fixture',state:'available',restaurantId:'demo-store'});
  expect(JSON.stringify(status)).not.toMatch(/userId|token|sqlite|\/Users\//i);
 }finally{await env.close();}
});
it('allows users to turn off the meal-only sugary-drink restriction',async()=>{
 const env=await createWebEnvironment({mode:'fixture'});try{expect(await env.recommend({...input,avoidSugaryDrinks:false})).toMatchObject({status:'ready'});}finally{await env.close();}
});
it('exposes specific no-drink and chicken-tag evidence for the selected products',async()=>{
 const env=await createWebEnvironment({mode:'fixture'});try{const response=await env.recommend({...input,excludeChicken:true});expect(response.status).toBe('ready');if(response.status==='ready'){
  expect(response.meal.restrictionEvidence).toContainEqual(expect.objectContaining({restriction:'sugar',basis:'no_drink',productId:null}));
  expect(response.meal.reasons.join(' ')).toContain('不含饮品');
  for(const item of response.meal.items)expect(response.meal.restrictionEvidence).toContainEqual(expect.objectContaining({restriction:'chicken',basis:'food_tags',productId:item.productId,value:false,evidenceIds:[expect.any(String)]}));
 }}finally{await env.close();}
});

it.each(['dietary_metadata','nutrition'] as const)('carries the actual drink %s evidence through the runtime',(basis)=>testDrinkEvidence(basis));
async function testDrinkEvidence(basis:'dietary_metadata'|'nutrition'){
 const {FixtureProvider}=await import('../src/providers/fixture-provider.js');
 const {recommendMeals}=await import('../src/domain/engine.js');
 const {defaultConfig}=await import('../src/config.js');
 const {presentMeal}=await import('../src/web/presentation.js');
 const {context,memory,NOW,product}=await import('./helpers.js');
 const main=product('main',1000),drink={...product('drink',200),category:'drink' as const,foodTags:[]};
 if(basis==='nutrition')drink.dietary={sugarFree:null,addedSugar:null,allergens:[],evidenceId:null};
 const provider=new FixtureProvider(()=>NOW,{products:[main,drink]});const ctx=context();ctx.mode='usual';ctx.chooseOne=true;ctx.hard.avoidSugaryDrinks=true;
 const mem=memory();mem.usual={sourceOrderId:'synthetic-past',userNamed:false,label:null,scope:{mealPeriod:'lunch',channel:'pickup',partySize:1},items:[main,drink].map(p=>({productId:p.productId,variantId:null,configurationRef:null,quantity:1}))};
 const result=await recommendMeals({products:provider.products,coupons:[],context:ctx,memory:mem,config:defaultConfig(),now:NOW,mode:'fixture',quote:r=>provider.calculateOrder(r)});
 const response=presentMeal(result,input,'fixture');expect(response.status).toBe('ready');if(response.status!=='ready')return;
 expect(response.meal.restrictionEvidence).toContainEqual(expect.objectContaining({restriction:'sugar',basis,productId:'drink',value:basis==='nutrition'?0:true,evidenceIds:[`${basis==='nutrition'?'nutrition':'dietary'}:drink`]}));
 expect(response.meal.restrictionEvidence.some(e=>e.basis==='no_drink')).toBe(false);
 expect(response.meal.evidence.join(' ')).toContain('演示drink');
}
