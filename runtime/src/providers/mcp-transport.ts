export interface NativeTool { name:string; inputSchema:Record<string,unknown>; outputSchema?:Record<string,unknown> }
export interface NativeResult { structuredContent?:unknown; content?:Array<{ type:string; text?:string }>; isError?:boolean }
export interface McpTransport {
  listTools(cursor?:string):Promise<{ tools:NativeTool[]; nextCursor?:string }>;
  callTool(name:string,args:Record<string,unknown>):Promise<NativeResult>;
  close?():Promise<void>;
}
export class TransportFailure extends Error {
  constructor(readonly code:ProviderErrorCode) { super(`Provider transport ${code}`); }
}
export class OfficialMcpTransport implements McpTransport {
  private client=new Client({name:'mcmate',version:'0.1.0'});
  private ready:Promise<void>|null=null;
  constructor(private timeoutMs=8000) {}
  private async ensure() {
    if(!this.ready) {
      const token=process.env.MCD_MCP_TOKEN;
      if(!token) throw new TransportFailure('AUTH_REQUIRED');
      const transport=new StreamableHTTPClientTransport(new URL('https://mcp.mcd.cn'),{
        requestInit:{headers:{Authorization:`Bearer ${token}`}},redirectPolicy:'same-origin',
      });
      this.ready=this.client.connect(transport,{timeout:this.timeoutMs}).catch(async e=>{
        this.ready=null; await transport.close().catch(()=>{}); throw safeTransportError(e);
      });
    }
    await this.ready;
  }
  async listTools(cursor?:string) { await this.ensure(); try { return await this.client.listTools(cursor?{cursor}:{},{timeout:this.timeoutMs}); } catch(e) {throw safeTransportError(e);} }
  async callTool(name:string,args:Record<string,unknown>):Promise<NativeResult> {
    await this.ensure(); try {return await this.client.callTool({name,arguments:args},{timeout:this.timeoutMs});}catch(e){throw safeTransportError(e);}
  }
  async close() { await this.client.close(); this.ready=null; }
}
function safeTransportError(error:unknown):TransportFailure {
  const e=error as {status?:number;code?:number;name?:string};
  if(e?.status===401 || e?.status===403 || e?.name==='UnauthorizedError') return new TransportFailure('AUTH_REQUIRED');
  if(e?.status===429) return new TransportFailure('RATE_LIMITED');
  if(e?.code===-32001 || e?.name==='AbortError' || e?.name==='TimeoutError') return new TransportFailure('TIMEOUT');
  return new TransportFailure('UNAVAILABLE');
}
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { ProviderErrorCode } from '../contracts/provider.js';
