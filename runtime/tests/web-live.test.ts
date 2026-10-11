import {it,expect} from 'vitest';
import {createWebEnvironment} from '../src/web/environment.js';
import {createOfficialPickupProfile} from '../src/providers/official-pickup-profile.js';
import {review,scope} from './fixtures/pickup.js';
import {pickupTools,toolSchemaHash} from '../src/official/diagnostics.js';
import {TransportFailure,type McpTransport} from '../src/providers/mcp-transport.js';
const now=scope.serviceAt;const clock=()=>now;const tools=pickupTools.map(name=>({name,inputSchema:{type:'object'}}));
const verified={...review,status:'account_verified' as const,operations:Object.fromEntries(tools.map(t=>[t.name,{status:'account_verified' as const,schemaHash:toolSchemaHash(t)}]))};
const config={MCD_MCP_TOKEN:'synthetic-test-token',MCMATE_RESTAURANT_ID:'test-store',MCMATE_BUSINESS_ENTITY_ID:'test-be',MCMATE_DB:'/not-used/private.sqlite',MCMATE_USER_ID:'not-used-user'};
const transport:McpTransport={listTools:async()=>({tools}),callTool:async()=>{throw new TransportFailure('UNAVAILABLE');}};
const input={budgetMaxFen:3000,avoidSugaryDrinks:true,excludeChicken:false};
it('keeps live unavailable for missing credentials, store or account-reviewed mapping',async()=>{
 for(const overrides of [{configuration:{}},{configuration:{...config,MCD_MCP_TOKEN:''}},{configuration:{...config,MCMATE_RESTAURANT_ID:''}},{profile:createOfficialPickupProfile(review,clock)},{profile:undefined}]){
  const env=await createWebEnvironment({mode:'live',clock,configuration:config,transport,profile:createOfficialPickupProfile(verified,clock),...overrides});
  try{expect(await env.status()).toMatchObject({mode:'live',state:'unavailable'});expect(await env.recommend(input)).toMatchObject({mode:'live',status:'unavailable'});expect(env.repository.manage({action:'list'})).toMatchObject({ok:true,preferences:[]});}finally{await env.close();}
 }
});
it('checks schemas and never returns fixtures when the official provider fails',async()=>{
 for(const broken of [transport,{listTools:async()=>({tools:tools.slice(1)}),callTool:transport.callTool},{listTools:async()=>{throw Error('Bearer SECRET /private.sqlite');},callTool:transport.callTool}]){
  const env=await createWebEnvironment({mode:'live',clock,configuration:config,transport:broken,profile:createOfficialPickupProfile(verified,clock)});
  try{const result=await env.recommend(input);expect(result).toMatchObject({mode:'live',status:'unavailable'});expect(JSON.stringify(result)).not.toMatch(/合成|SECRET|private\.sqlite|not-used-user/);}finally{await env.close();}
 }
});
it('ignores persistent user and DB configuration in a fixture web session',async()=>{
 const env=await createWebEnvironment({mode:'fixture',configuration:config});try{expect(await env.status()).toMatchObject({mode:'fixture',state:'available'});expect(await env.recommend(input)).toMatchObject({mode:'fixture',status:'ready'});expect(env.repository.manage({action:'list'})).toMatchObject({ok:true,preferences:[]});}finally{await env.close();}
});
it('runs the same runtime through the reviewed adapter using synthetic native contracts',async()=>{
 const {quoteData}=await import('./fixtures/pickup.js');const called:string[]=[];
 const scripted:McpTransport={listTools:async()=>({tools}),callTool:async(name)=>{called.push(name);return {structuredContent:{success:true,code:200,data:name==='query-meals'?{meals:{meal:{name:'契约测试主食',currentPrice:'18.90',discountType:null}}}:name==='query-store-coupons'?[]:quoteData}};}};
 const env=await createWebEnvironment({mode:'live',clock,configuration:config,transport:scripted,profile:createOfficialPickupProfile(verified,clock)});
 try{expect(await env.status()).toMatchObject({mode:'live',state:'available'});expect(await env.recommend({...input,excludeChicken:true})).toMatchObject({mode:'live',status:'ready',meal:{payableFen:1890,source:'麦当劳官方 MCP'}});expect(new Set(called)).toEqual(new Set(['query-meals','query-store-coupons','calculate-price']));expect(env.repository.manage({action:'list'})).toMatchObject({ok:true,preferences:[]});}finally{await env.close();}
});
