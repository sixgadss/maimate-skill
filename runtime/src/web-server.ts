import { fileURLToPath } from 'node:url';import { z } from 'zod';
import { createWebEnvironment } from './web/environment.js';import { startWebServer } from './web/server.js';
async function main(){
 const mode=z.enum(['fixture','live']).parse(process.env.MCMATE_PROVIDER??'fixture');
 const port=z.coerce.number().int().min(1).max(65535).parse(process.env.MCMATE_WEB_PORT??8787);
 const environment=await createWebEnvironment({mode});
 try{
  const server=await startWebServer({environment,port,webRoot:fileURLToPath(new URL('../web/',import.meta.url))});
  console.log(`麦Mate ${mode==='fixture'?'示例体验':'真实菜单'}：${server.url}`);
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void server.close().then(()=>process.exit(0));});
 }catch{await environment.close();throw new Error('Web service unavailable');}
}
main().catch(()=>{console.error('页面未启动，请检查端口和本机配置。');process.exitCode=1;});
