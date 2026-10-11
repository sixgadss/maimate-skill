import {it,expect} from 'vitest';
import {Client} from '@modelcontextprotocol/client';
import {InMemoryTransport} from '@modelcontextprotocol/server';
import {createMcpServer} from '../src/mcp-server.js';
import {McMateRuntime} from '../src/application/runtime.js';
import {unverifiedHost} from '../src/application/turn-verifier.js';
import {MemoryRepository} from '../src/memory/repository.js';
import {FixtureProvider} from '../src/providers/fixture-provider.js';
import {defaultConfig} from '../src/config.js';
import {NOW} from './helpers.js';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
it('MCP lists strict tools, returns structured recommendations and rejects forged writes',async()=>{
  const m=new MemoryRepository(':memory:','local',()=>NOW);
  const runtime=new McMateRuntime(new FixtureProvider(()=>NOW),m,{...defaultConfig(),restaurantId:'demo-store',channel:'pickup'},()=>NOW,unverifiedHost);
  const server=createMcpServer(runtime),client=new Client({name:'test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);await client.connect(b);
    const {tools}=await client.listTools();expect(tools.map(t=>t.name).sort()).toEqual(['mcmate_feedback','mcmate_memory','mcmate_recommend']);
    expect(tools.find(t=>t.name==='mcmate_recommend')?.inputSchema.additionalProperties).toBe(false);
    const r=await client.callTool({name:'mcmate_recommend',arguments:{userTurnRef:'readonly',utterance:'选一个',intent:{chooseOne:true}}});
    expect(r.structuredContent).toMatchObject({status:'ready',mode:'fixture'});
    const invalid=await client.callTool({name:'mcmate_recommend',arguments:{userTurnRef:'x',utterance:'吃什么',intent:{budgetMaxFen:0.5}}}).catch(()=>({isError:true}));
    expect(invalid.isError).toBe(true);
    const write=await client.callTool({name:'mcmate_memory',arguments:{action:'clear',userTurnRef:'fake'}});
    expect(write.isError).toBe(true);expect(write.structuredContent).toMatchObject({ok:false,error:{code:'UNVERIFIED_TURN'}});
  } finally {await client.close();await server.close();m.close();}
});
it('stdio stdout contains only JSON protocol messages',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'mcmate-stdio-')); let stdout='';let stderr='';
  const child=spawn(process.execPath,['--import','tsx','src/mcp-server.ts'],{cwd:process.cwd(),env:{...process.env,MCMATE_PROVIDER:'fixture',MCMATE_DB:join(dir,'memory.sqlite')}});
  child.stdout.on('data',chunk=>stdout+=String(chunk));child.stderr.on('data',chunk=>stderr+=String(chunk));
  try {
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'wire-test',version:'1'}}})+'\n');
    const until=Date.now()+1800;
    while(!stdout.includes('"id":1') && Date.now()<until && child.exitCode===null) await new Promise(r=>setTimeout(r,10));
    expect(stdout.trim().length,stderr).toBeGreaterThan(0);
    for(const line of stdout.trim().split('\n')) expect(JSON.parse(line)).toMatchObject({jsonrpc:'2.0'});
    expect(stderr).not.toContain('MCD_MCP_TOKEN');
  } finally {child.kill();await new Promise<void>(r=>{if(child.exitCode!==null) r();else child.once('close',()=>r());});rmSync(dir,{recursive:true,force:true});}
});
