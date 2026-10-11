import {describe,it,expect} from 'vitest';
import {inspectOfficialTools} from '../src/official/diagnostics.js';
import {TransportFailure,type McpTransport} from '../src/providers/mcp-transport.js';
const tool=(name:string)=>({name,inputSchema:{type:'object'}});
describe('safe official discovery',()=>{
 it('follows pagination, hashes contracts and only exposes read-only names',async()=>{
  let calls=0;const transport:McpTransport={listTools:async(cursor)=>{calls++;return cursor?{tools:[tool('calculate-price')]}:{tools:[tool('query-meals'),tool('create-order')],nextCursor:'next'};},callTool:async()=>{throw Error('must not call');}};
  const result=await inspectOfficialTools(transport);expect(calls).toBe(2);expect(result.state).toBe('discovered');expect(result.tools.map(t=>t.name)).toEqual(['calculate-price','query-meals']);expect(result.tools[0]!.schemaHash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(result)).not.toContain('account_verified');
 });
 it('rejects a repeated cursor and discards partial discovery',async()=>{
  const result=await inspectOfficialTools({listTools:async()=>({tools:[tool('query-meals')],nextCursor:'same'}),callTool:async()=>({})});expect(result).toEqual({state:'unavailable',tools:[],errorCode:'INVALID_DATA'});
 });
 it('returns AUTH_REQUIRED without revealing raw failures',async()=>{
  for(const e of [new TransportFailure('AUTH_REQUIRED'),Error('Bearer SECRET phone 13812345678')]){
   const result=await inspectOfficialTools({listTools:async()=>{throw e;},callTool:async()=>({})});expect(result.state).toBe('unavailable');expect(result.tools).toEqual([]);expect(result.errorCode).toBe(e instanceof TransportFailure?'AUTH_REQUIRED':'UNAVAILABLE');expect(JSON.stringify(result)).not.toMatch(/SECRET|13812345678/);
  }
 });
});
