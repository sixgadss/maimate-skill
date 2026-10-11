import { randomUUID } from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import { defaultConfig } from '../config.js';
import { FixtureProvider } from '../providers/fixture-provider.js';
import { McdMcpAdapter, unverifiedProfile, type BindingProfile } from '../providers/mcd-mcp-adapter.js';
import {pickupTools} from '../official/diagnostics.js';
import { OfficialMcpTransport, type McpTransport } from '../providers/mcp-transport.js';
import { MemoryRepository } from '../memory/repository.js';
import { McMateRuntime } from '../application/runtime.js';
import { unverifiedHost } from '../application/turn-verifier.js';
import { webMealInput, type WebMealInput, type WebMealResponse, type WebStatus } from './contracts.js';
import { presentMeal } from './presentation.js';
export interface WebEnvironment {
  repository: MemoryRepository;
  recommend(input:WebMealInput):Promise<WebMealResponse>;
  status():Promise<WebStatus>;
  close():Promise<void>;
}
export async function createWebEnvironment(options:{mode:'fixture'|'live';clock?:()=>string;configuration?:NodeJS.ProcessEnv;transport?:McpTransport;profile?:BindingProfile}):Promise<WebEnvironment> {
  const {mode}=options;const configuration=options.configuration??process.env; const clock=options.clock??(()=>new Date().toISOString());
  const config=defaultConfig();config.userId='web-session';config.channel='pickup';
  config.restaurantId=mode==='fixture'?'demo-store':configuration.MCMATE_RESTAURANT_ID?.trim()||null;
  config.businessEntityId=mode==='live'?configuration.MCMATE_BUSINESS_ENTITY_ID?.trim()||null:null;
  let profile=options.profile??unverifiedProfile;
  if(mode==='live'&&!options.profile&&configuration.MCMATE_BINDING_MODULE){
    try{profile=(await import(pathToFileURL(resolve(configuration.MCMATE_BINDING_MODULE)).href)).default;}catch{profile=unverifiedProfile;}
  }
  const required=['getNearbyRestaurants','getMenu','getProductDetails','getUserCoupons','calculateOrder'];
  const reviewed=profile?.verification==='account_verified'&&required.every(op=>profile.requiredOperations?.includes(op as keyof typeof profile.bindings))
    &&Object.keys(profile.bindings).length===pickupTools.length&&Object.values(profile.bindings).every(b=>b?.verified&&/^[a-f0-9]{64}$/.test(b.expectedSchemaHash??'')&&typeof b.args==='function'&&typeof b.normalize==='function'&&typeof b.isSuccess==='function');
  const liveConfigured=!!configuration.MCD_MCP_TOKEN?.trim()&&!!config.restaurantId&&reviewed;
  const transport=mode==='live'?(options.transport??new OfficialMcpTransport()):null;
  const provider=transport?new McdMcpAdapter(transport,reviewed?profile:unverifiedProfile,clock):new FixtureProvider(clock);
  const repository=new MemoryRepository(':memory:',config.userId,clock);
  const runtime=new McMateRuntime(provider,repository,config,clock,unverifiedHost);
  let closed=false;
  return {repository,
    async status(){
      if(closed||(mode==='live'&&!liveConfigured))return {mode,state:'unavailable',restaurantId:config.restaurantId} as WebStatus;
      const caps=await provider.capabilities();
      return {mode,state:caps.ok&&caps.meta.mode===mode&&caps.data.menu&&caps.data.authoritativeQuote&&!!config.restaurantId?'available':'unavailable',restaurantId:config.restaurantId};
    },
    async recommend(raw){
      if(closed)throw new Error('Web environment closed');
      const input=webMealInput.parse(raw);
      if(mode==='live'&&!liveConfigured)return {status:'unavailable',mode,message:'真实接入尚未核验，请完成本机配置。'};
      const result=await runtime.recommend({userTurnRef:`web:${randomUUID()}`,utterance:'本次预算配餐',intent:{budgetMaxFen:input.budgetMaxFen,
        ...(input.avoidSugaryDrinks?{avoidSugaryDrinks:true}:{}),excludedFoodTags:input.excludeChicken?['chicken']:[],partySize:1,channel:'pickup',chooseOne:true}});
      return presentMeal(result,input,mode);
    },
    async close(){if(closed)return;closed=true;repository.close();await transport?.close?.();},
  };
}
