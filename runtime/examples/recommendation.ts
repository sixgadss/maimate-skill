import assert from 'node:assert/strict';
import {FixtureProvider} from '../src/providers/fixture-provider.js';
import {MemoryRepository} from '../src/memory/repository.js';
import {defaultConfig} from '../src/config.js';
import {resolveContext} from '../src/domain/context.js';
import {recommendMeals} from '../src/domain/engine.js';
// Module-level reuse: synthetic provider → context → the same recommendation engine.
const clock=()=>new Date().toISOString(),provider=new FixtureProvider(clock);
const memory=new MemoryRepository(':memory:','example-only',clock);
try{
 const config={...defaultConfig(),restaurantId:'demo-store',channel:'pickup' as const};
 const snapshot={preferences:[],settings:memory.settings(),usual:null,recentCompletedSoloMeals:[],historyCoverage:'unavailable' as const};
 const context=resolveContext({userTurnRef:'example-only',utterance:'本餐三十以内，不含糖饮品',intent:{budgetMaxFen:3000,avoidSugaryDrinks:true,chooseOne:true}},snapshot,config,clock());
 assert.equal(context.status,'context');if(context.status!=='context')throw Error('Context missing');
 const menu=await provider.getMenu(context.context.scope);assert(menu.ok);if(!menu.ok)throw Error('Menu unavailable');
 const coupons=await provider.getUserCoupons(context.context.scope);assert(coupons.ok);
 const result=await recommendMeals({products:menu.data.products,coupons:coupons.ok?coupons.data:[],context:context.context,memory:snapshot,config,now:clock(),clock,mode:'fixture',quote:r=>provider.calculateOrder(r)});
 assert.equal(result.status,'ready');if(result.status==='ready'){assert.equal(result.options.length,1);assert(result.options[0]!.quote.payable.amountFen<=3000);}
 console.log(JSON.stringify({source:'合成示例',result},null,2));
}finally{memory.close();}
