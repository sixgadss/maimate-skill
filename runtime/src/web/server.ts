import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';import { join } from 'node:path';
import { webMealInput } from './contracts.js';import type { WebEnvironment } from './environment.js';
const resources:Record<string,{file:string;type:string}>={
 '/':{file:'index.html',type:'text/html; charset=utf-8'},
 '/styles.css':{file:'styles.css',type:'text/css; charset=utf-8'},
 '/app.js':{file:'app.js',type:'text/javascript; charset=utf-8'},
 '/state.js':{file:'state.js',type:'text/javascript; charset=utf-8'},
};
function send(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req:IncomingMessage):Promise<string|null>{
 let size=0;const chunks:Buffer[]=[];
 if(Number(req.headers['content-length'])>4096){req.resume();return null;}
 for await(const chunk of req){size+=chunk.length;if(size>4096){req.resume();return null;}chunks.push(chunk);}
 return Buffer.concat(chunks).toString('utf8');
}
export async function startWebServer(options:{environment:WebEnvironment;port?:number;webRoot:string}):Promise<{url:string;close():Promise<void>}>{
 let origin='';let running=0;let closed=false;
 const server=createServer((req,res)=>{void handle(req,res).catch(()=>{if(!res.headersSent)send(res,503,{message:'查询暂时不可用，请稍后重试。'});else res.end();});});
 server.requestTimeout=15000;server.headersTimeout=10000;
 async function handle(req:IncomingMessage,res:ServerResponse){
  if(req.headers.host!==new URL(origin).host || (req.headers.origin && req.headers.origin!==origin)
   || (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(String(req.headers['sec-fetch-site'])))){
   req.resume();send(res,403,{message:'只允许本机同源访问。'});return;}
  const path=req.url?.split('?')[0]??'';
  if(path==='/api/status'){
   if(req.method!=='GET'){send(res,405,{message:'请求方法不支持。'});return;}
   send(res,200,await options.environment.status());return;
  }
  if(path==='/api/recommend'){
   if(req.method!=='POST'){req.resume();send(res,405,{message:'请求方法不支持。'});return;}
   if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type']??'')){req.resume();send(res,415,{message:'请使用 JSON 请求。'});return;}
   if(req.headers['sec-fetch-site'] && !req.headers.origin){req.resume();send(res,403,{message:'请求来源无法核验。'});return;}
   const text=await body(req);if(text===null){send(res,413,{message:'请求内容过长。'});return;}
   let parsed;try{parsed=webMealInput.safeParse(JSON.parse(text));}catch{send(res,400,{message:'请求内容无效。'});return;}
   if(!parsed.success){send(res,400,{message:'请检查预算和口味限制。'});return;}
   if(running>=2){send(res,429,{message:'已有查询正在进行，请稍后重试。'});return;}
   running++;
   try{send(res,200,await options.environment.recommend(parsed.data));}finally{running--;}
   return;
  }
  const resource=resources[path];
  if(!resource){send(res,404,{message:'页面不存在。'});return;}
  if(req.method!=='GET'){send(res,405,{message:'请求方法不支持。'});return;}
  try{
   const content=await readFile(join(options.webRoot,resource.file));
   res.writeHead(200,{'Content-Type':resource.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(content);
  }catch{send(res,404,{message:'页面资源不存在。'});}
 }
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
 const address=server.address();if(!address||typeof address==='string')throw new Error('Local server unavailable');origin=`http://127.0.0.1:${address.port}`;
 return {url:origin,async close(){if(closed)return;closed=true;await new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections();});await options.environment.close();}};
}
