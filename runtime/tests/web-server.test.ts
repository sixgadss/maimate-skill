import { it, expect } from 'vitest';
import { request } from 'node:http';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';import { join } from 'node:path';
import { startWebServer } from '../src/web/server.js';
import { createWebEnvironment } from '../src/web/environment.js';
const input={budgetMaxFen:3000,avoidSugaryDrinks:true,excludeChicken:false};
async function setup(){const environment=await createWebEnvironment({mode:'fixture'});const webRoot=await mkdtemp(join(tmpdir(),'maimate-web-'));
 await writeFile(join(webRoot,'index.html'),'<main>meal</main>');const server=await startWebServer({environment,webRoot});
 return {...server,environment,async clean(){await server.close();await rm(webRoot,{recursive:true,force:true});}};}
const post=(body:unknown,headers:Record<string,string>={})=>({method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
it('serves real recommendations and rejects malformed HTTP inputs',async()=>{const s=await setup();try{
 expect((await fetch(s.url+'/api/status')).status).toBe(200);
 expect(await (await fetch(s.url+'/api/recommend',post(input))).json()).toMatchObject({status:'ready',mode:'fixture'});
 for(const [body,code] of [[{...input,budgetMaxFen:-1},400],[{...input,userId:'other'},400],['x'.repeat(5000),413]] as const)
  expect((await fetch(s.url+'/api/recommend',post(body))).status).toBe(code);
 expect((await fetch(s.url+'/api/recommend',{method:'POST',body:'{}'})).status).toBe(415);
 expect((await fetch(s.url+'/api/recommend',{method:'PUT'})).status).toBe(405);
 expect((await fetch(s.url+'/missing')).status).toBe(404);
}finally{await s.clean();}});
it('rejects cross-site and rebinding requests without exposing status',async()=>{const s=await setup();try{
 const attacks:Record<string,string>[]=[{Origin:'https://evil.example'},{'Sec-Fetch-Site':'cross-site'}];
 for(const headers of attacks)
  expect((await fetch(s.url+'/api/recommend',post(input,headers))).status).toBe(403);
 const hostAttack=await new Promise<number>(resolve=>{const req=request(s.url+'/api/status',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode!);});req.end();});
 expect(hostAttack).toBe(403);
 expect((await fetch(s.url+'/api/recommend',post(input,{Origin:s.url}))).status).toBe(200);
 expect((await fetch(s.url+'/api/status',{headers:{Origin:'https://evil.example'}})).status).toBe(403);
}finally{await s.clean();}});
it('serves only whitelisted resources',async()=>{const s=await setup();try{
 expect(await (await fetch(s.url+'/')).text()).toContain('<main>');
 for(const path of ['/.env','/.data/memory.sqlite','/%2e%2e%2fruntime/.env','/src/bootstrap.ts'])expect((await fetch(s.url+path)).status).toBe(404);
}finally{await s.clean();}});
it('limits concurrent recommendations and releases slots after failure',async()=>{const s=await setup();const releases:Array<()=>void>=[];
 s.environment.recommend=async()=>{await new Promise<void>(resolve=>releases.push(resolve));throw new Error('Bearer private-secret');};
 try {
  const first=fetch(s.url+'/api/recommend',post(input));const second=fetch(s.url+'/api/recommend',post(input));
  while(releases.length<2)await new Promise(resolve=>setTimeout(resolve,5));
  expect((await fetch(s.url+'/api/recommend',post(input))).status).toBe(429);
  releases.forEach(resolve=>resolve());const results=await Promise.all([first,second]);
  for(const response of results){expect(response.status).toBe(503);expect(await response.text()).not.toContain('private-secret');}
  s.environment.recommend=async()=>({status:'unavailable',mode:'fixture',message:'无合格组合'});
  expect((await fetch(s.url+'/api/recommend',post(input))).status).toBe(200);
 }finally{releases.forEach(resolve=>resolve());await s.clean();}
});
it('closes idempotently and stops accepting connections',async()=>{const s=await setup();await s.clean();await s.close();
 await expect(fetch(s.url+'/api/status')).rejects.toThrow();});

it('keeps result status in a persistent polite live region for success, empty and expiry updates',async()=>{const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');expect(html).toMatch(/<p id="result-state" aria-live="polite" aria-atomic="true">/);});
