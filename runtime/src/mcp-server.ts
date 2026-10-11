import type { McMateRuntime } from './application/runtime.js';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { pathToFileURL } from 'node:url';
import { recommendSchema } from './domain/schemas.js';
import { feedbackSchema,memoryActionSchema } from './application/action-schemas.js';
import { recommendationOutput,feedbackOutput,memoryOutput } from './application/output-schemas.js';
import { createEnvironment } from './bootstrap.js';
export function createMcpServer(runtime:McMateRuntime):McpServer {
  const server=new McpServer({name:'mcmate',version:'0.1.0'},{instructions:'麦搭子推荐运行时。fixture 是模拟数据；默认 stdio 宿主没有可信用户来源，反馈及记忆写入返回 UNVERIFIED_TURN。当前版本不提供下单和付款。'});
  server.registerTool('mcmate_recommend',{description:'返回 1–3 个已核验费用与限制的方案。模拟数据必须标注模拟演示。未验证宿主调用只读。',inputSchema:recommendSchema,outputSchema:recommendationOutput,annotations:{readOnlyHint:true}},async r=>respond(await runtime.recommend(r)));
  server.registerTool('mcmate_feedback',{description:'记录选择或明确偏好。需要可信宿主的 userTurnRef；默认 stdio 写入关闭，普通模型填写的引用无效。',inputSchema:feedbackSchema,outputSchema:feedbackOutput},async r=>respond(await runtime.feedback(r)));
  server.registerTool('mcmate_memory',{description:'查看、更正、删除、撤销和暂停偏好记忆。list 可读取；所有变更需要可信宿主的用户来源引用。',inputSchema:memoryActionSchema,outputSchema:memoryOutput},async r=>respond(await runtime.memory(r)));
  return server;
}
function respond(result:object) {
  const value=result as {ok?:boolean;status?:string};
  return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result,isError:value.ok===false || value.status==='unavailable'};
}
async function main() {
  const env=await createEnvironment();const server=createMcpServer(env.runtime);
  let closing=false;const close=async()=>{if(closing)return;closing=true;await server.close();await env.close();};
  process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
  await server.connect(new StdioServerTransport());process.stdin.once('end',()=>void close());
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(()=>{console.error('McMate 服务启动失败，请检查本地配置。');process.exitCode=1;});
