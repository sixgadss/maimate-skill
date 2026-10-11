import {it,expect} from 'vitest';
import {McMateRuntime} from '../src/application/runtime.js';
import {MemoryRepository} from '../src/memory/repository.js';
import {FixtureProvider} from '../src/providers/fixture-provider.js';
import {defaultConfig} from '../src/config.js';
import {unverifiedHost} from '../src/application/turn-verifier.js';
import {NOW,context,memory as emptyMemory,product,scope} from './helpers.js';
import {recommendMeals} from '../src/domain/engine.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

it('allows a newly fetched quote observed after the request began, with current-clock validation',async()=>{
  let tick=0;const clock=()=>new Date(Date.parse(NOW)+tick++).toISOString();
  const memory=new MemoryRepository(':memory:','local',clock);
  const runtime=new McMateRuntime(new FixtureProvider(clock),memory,{...defaultConfig(),restaurantId:'demo-store',channel:'pickup'},clock,unverifiedHost);
  try {expect(await runtime.recommend({userTurnRef:'readonly',utterance:'今天刚健完身',intent:{mode:'post_workout',chooseOne:true}})).toMatchObject({status:'ready',mode:'fixture'});}
  finally {memory.close();}
});

it('sets without verified drink components cannot bypass an explicit no-sugary-drinks constraint',async()=>{
  const set={...product('set'),category:'set' as const,name:'演示汉堡加普通可乐套餐',dietary:{sugarFree:false,addedSugar:true,allergens:[],evidenceId:'set-diet'},nutrition:{energyKcal:650,proteinG:20,sugarG:25,sodiumMg:null,basis:'per_serving' as const,evidenceId:'set-nutrition'}};
  const provider=new FixtureProvider(()=>NOW,{products:[set]});
  const result=await recommendMeals({products:[set],coupons:[],context:{...context(),hard:{...context().hard,avoidSugaryDrinks:true}},memory:emptyMemory(),config:defaultConfig(),now:NOW,mode:'fixture',quote:r=>provider.calculateOrder(r)});
  expect(result.status).toBe('unavailable');
});
it('eligible products survive category caps when earlier products fail hard dietary filters',async()=>{
  const products=[...['a','b','c','d','e','f'].map(id=>({...product(id),foodTags:['chicken']})),{...product('z-beef'),foodTags:['beef']}];
  const provider=new FixtureProvider(()=>NOW,{products});
  const result=await recommendMeals({products,coupons:[],context:{...context(),hard:{...context().hard,excludedFoodTags:['chicken']}},memory:emptyMemory(),config:defaultConfig(),now:NOW,mode:'fixture',quote:r=>provider.calculateOrder(r)});
  if(result.status!=='ready')throw new Error(JSON.stringify(result));
  expect(result.options[0]?.items[0]?.productId).toBe('z-beef');
});
it('erase removes repeated statements and correction lineage while preserving unrelated evidence',()=>{
  const dir=mkdtempSync(join(tmpdir(),'mcmate-erase-'));const path=join(dir,'memory.sqlite');
  const memory=new MemoryRepository(path,'local',()=>NOW);
  const sugar={key:'drink.sugar_policy',value:'avoid_sugary_drinks',rule:'exclude' as const,target:null,scope:{}};
  try {
    memory.recordStatement('first',sugar,'long_term');memory.recordStatement('second',sugar,'long_term');
    memory.recordStatement('unrelated',{...sugar,key:'food.added_sugar',value:true},'long_term');
    const id=memory.snapshot(scope()).preferences.find(p=>p.key==='drink.sugar_policy')!.id;
    expect(memory.correctPreference(id,{...sugar,value:'no_restriction',rule:'soft'},'third')).toMatchObject({ok:true});
    expect(memory.manage({action:'delete',preferenceIds:[id],mode:'erase',userTurnRef:'erase'})).toMatchObject({ok:true,undo:null});
    const db=new DatabaseSync(path);try {
      const events=db.prepare('SELECT payload FROM memory_events WHERE user_id=?').all('local');
      expect(events.some(e=>String(e.payload).includes('drink.sugar_policy'))).toBe(false);
      expect(events.some(e=>String(e.payload).includes('food.added_sugar'))).toBe(true);
    } finally{db.close();}
  } finally {memory.close();rmSync(dir,{recursive:true,force:true});}
});

it('erase follows the full lineage through multiple corrections that change the preference key',()=>{
  const dir=mkdtempSync(join(tmpdir(),'mcmate-lineage-'));const path=join(dir,'memory.sqlite');
  const memory=new MemoryRepository(path,'local',()=>NOW);
  const fact={key:'drink.sugar_policy',value:'avoid_sugary_drinks',rule:'exclude' as const,target:null,scope:{}};
  try {
    memory.recordStatement('first',fact,'long_term');memory.recordStatement('second',fact,'long_term');
    const id=memory.snapshot(scope()).preferences[0]!.id;
    expect(memory.correctPreference(id,{...fact,key:'food.tag.chicken',value:true},'correct-1')).toMatchObject({ok:true});
    const nextId=memory.snapshot(scope()).preferences[0]!.id;
    expect(memory.correctPreference(nextId,{...fact,key:'food.added_sugar',value:true},'correct-2')).toMatchObject({ok:true});
    const finalId=memory.snapshot(scope()).preferences[0]!.id;
    expect(memory.manage({action:'delete',preferenceIds:[finalId],mode:'erase',userTurnRef:'erase'})).toMatchObject({ok:true});
    const db=new DatabaseSync(path);try {expect(db.prepare('SELECT count(*) AS n FROM memory_events WHERE user_id=?').get('local')!.n).toBe(0);}
    finally {db.close();}
  } finally {memory.close();rmSync(dir,{recursive:true,force:true});}
});
