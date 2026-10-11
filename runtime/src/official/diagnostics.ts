import {stableHash} from '../domain/schemas.js';
import {TransportFailure,type McpTransport,type NativeTool} from '../providers/mcp-transport.js';
export const pickupTools=['query-nearby-stores','query-meals','query-meal-detail','query-store-coupons','calculate-price'] as const;
function canonical(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonical);
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,canonical(v)]));
 return value;
}
export function toolSchemaHash(tool:NativeTool):string {
 return stableHash(canonical({inputSchema:tool.inputSchema,outputSchema:tool.outputSchema??null}));
}
export interface Discovery {state:'discovered'|'unavailable';tools:Array<{name:string;schemaHash:string}>;errorCode?:string}
export async function inspectOfficialTools(transport:McpTransport):Promise<Discovery> {
 try {
  const names=new Set<string>(),cursors=new Set<string>(),tools:Discovery['tools']=[];let cursor:string|undefined;
  for(let page=0;page<50;page++){
   const response=await transport.listTools(cursor);
   for(const tool of response.tools){if(names.has(tool.name))throw new TransportFailure('INVALID_DATA');names.add(tool.name);
    if((pickupTools as readonly string[]).includes(tool.name))tools.push({name:tool.name,schemaHash:toolSchemaHash(tool)});}
   cursor=response.nextCursor;if(!cursor)return {state:'discovered',tools:tools.sort((a,b)=>a.name.localeCompare(b.name))};
   if(cursors.has(cursor))throw new TransportFailure('INVALID_DATA');cursors.add(cursor);
  }
  throw new TransportFailure('INVALID_DATA');
 }catch(error){return {state:'unavailable',tools:[],errorCode:error instanceof TransportFailure?error.code:'UNAVAILABLE'};}
}
