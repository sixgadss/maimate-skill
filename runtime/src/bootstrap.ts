import { resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { z } from 'zod';
import { defaultConfig } from './config.js';
import { channelSchema,stableHash } from './domain/schemas.js';
import { FixtureProvider } from './providers/fixture-provider.js';
import { OfficialMcpTransport } from './providers/mcp-transport.js';
import { McdMcpAdapter,unverifiedProfile,type BindingProfile } from './providers/mcd-mcp-adapter.js';
import { MemoryRepository } from './memory/repository.js';
import { McMateRuntime } from './application/runtime.js';
import { unverifiedHost,type TurnVerifier } from './application/turn-verifier.js';
const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export async function createEnvironment(verifier:TurnVerifier=unverifiedHost) {
  const mode=z.enum(['fixture','live']).parse(process.env.MCMATE_PROVIDER??'fixture');
  const config=defaultConfig();
  config.restaurantId=process.env.MCMATE_RESTAURANT_ID??(mode==='fixture'?'demo-store':null);
  config.businessEntityId=process.env.MCMATE_BUSINESS_ENTITY_ID??null;
  config.channel=process.env.MCMATE_CHANNEL?channelSchema.parse(process.env.MCMATE_CHANNEL):(mode==='fixture'?'pickup':null);
  config.userId=z.string().min(1).max(100).parse(process.env.MCMATE_USER_ID??'local');
  if(mode==='live') config.userId+=`:${stableHash(process.env.MCD_MCP_TOKEN??'unbound').slice(0,16)}`;
  const clock=()=>new Date().toISOString(); let transport:OfficialMcpTransport|null=null;
  let profile:BindingProfile=unverifiedProfile;
  if(mode==='live' && process.env.MCMATE_BINDING_MODULE) {
    const imported=await import(pathToFileURL(resolve(process.env.MCMATE_BINDING_MODULE)).href);
    const value=imported.default as BindingProfile;
    if(!value || typeof value.id!=='string' || !value.id || typeof value.bindings!=='object') throw new Error('Invalid mapping profile');
    for(const binding of Object.values(value.bindings)) if(!binding || typeof binding.verified!=='boolean' || typeof binding.args!=='function'
      || typeof binding.normalize!=='function' || typeof binding.isSuccess!=='function') throw new Error('Invalid binding');
    profile=value;
  }
  const provider=mode==='fixture'?new FixtureProvider(clock):new McdMcpAdapter(transport=new OfficialMcpTransport(),profile,clock);
  const dbPath=process.env.MCMATE_DB?resolve(process.env.MCMATE_DB):resolve(projectRoot,'.data',mode,'memory.sqlite');
  const repository=new MemoryRepository(dbPath,config.userId,clock);
  const runtime=new McMateRuntime(provider,repository,config,clock,verifier);
  return {mode,runtime,repository,config,dbPath,close:async()=>{repository.close();await transport?.close();}};
}
