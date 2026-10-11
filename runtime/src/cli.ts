import { createInterface } from 'node:readline';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from './config.js';
import { createEnvironment } from './bootstrap.js';
import { FixtureProvider } from './providers/fixture-provider.js';
import { MemoryRepository } from './memory/repository.js';
import { McMateRuntime } from './application/runtime.js';
import { LocalTurnRegistry } from './application/turn-verifier.js';
import { parseLocalIntent } from './application/preferences-parser.js';
import type { RecommendationResult, MemoryAction } from './contracts/runtime.js';
export interface DemoReport {mode:'fixture';notice:string;scenarios:Array<{id:string;utterance:string;result:RecommendationResult}>}
export async function runDemo():Promise<DemoReport> {
  const dir=mkdtempSync(join(tmpdir(),'mcmate-demo-')); const now=new Date().toISOString();const clock=()=>now;
  const config={...defaultConfig(),restaurantId:'demo-store',channel:'pickup' as const};
  const scope={restaurantId:'demo-store',businessEntityId:null,channel:'pickup' as const,addressRef:null,pickupMethod:null,serviceAt:now,timezone:config.timezone,partySize:1};
  const provider=new FixtureProvider(clock,{orders:[{orderId:'synthetic-completed',provider:'synthetic',scope,
    items:['chicken','corn','zero'].map(productId=>({productId,variantId:null,configurationRef:null,quantity:1})),status:'completed',payable:null,paymentUrl:null,
    createdAt:new Date(Date.parse(now)-86400000).toISOString(),evidenceId:'fixture:history'}]});
  // The demo publishes its separately seeded synthetic history at the usual step.
  // Accepting the earlier recommendation does not manufacture a completed order.
  const demoHistory=provider.orders.splice(0);
  const memory=new MemoryRepository(join(dir,'demo.sqlite'),'local',clock);const verifier=new LocalTurnRegistry();
  const runtime=new McMateRuntime(provider,memory,config,clock,verifier);const scenarios:DemoReport['scenarios']=[];
  const recommend=async(id:string,utterance:string)=>{
    const result=await runtime.recommend({utterance,intent:parseLocalIntent(utterance),userTurnRef:verifier.register(utterance,{kind:'recommend',utterance})});
    scenarios.push({id,utterance,result});return result;
  };
  try {
    await recommend('budget','20 块以内，吃饱一点。');
    const workout=await recommend('workout','今天刚健完身，30 块以内。');
    if(workout.status==='ready') {
      const action={kind:'accepted' as const,recommendationId:workout.recommendationId,candidateId:workout.options[0]!.candidateId};
      const accepted=await runtime.feedback({...action,userTurnRef:verifier.register('就它',action)});if(!accepted.ok)throw new Error(accepted.error.code);
    }
    await recommend('choose_one','今天你帮我选一个。');
    const text='我不喝有糖饮料。';const action={kind:'statement' as const,text,persistence:'long_term' as const};
    const remembered=await runtime.feedback({...action,userTurnRef:verifier.register(text,action)});if(!remembered.ok)throw new Error(remembered.error.code);
    await recommend('zero_sugar','今天吃什么？');provider.orders.push(...demoHistory);await recommend('usual','老样子。');
    return {mode:'fixture',notice:'模拟演示：所有商品、金额、营养和历史均为合成数据；没有真实下单。',scenarios};
  } finally {memory.close();rmSync(dir,{recursive:true,force:true});}
}
export function renderRecommendation(result:RecommendationResult):string {
  if(result.status==='needs_input')return result.question;
  if(result.status==='unavailable')return `${result.explanation}\n${result.nextAction}`;
  const lines=result.mode==='fixture'?['模拟演示（合成数据）']:[];
  result.options.forEach(o=>{const role={best_fit:'我选这份',best_value:'更省一点',explore:'换个口味'}[o.role];
    const items=o.itemNames.map((name,i)=>`${name}${o.items[i]!.quantity>1?` × ${o.items[i]!.quantity}`:''}`).join(' + ');
    lines.push(`${role}：${items}，应付 ¥${(o.quote.payable.amountFen/100).toFixed(2)}。`);
    if(o.reasons.some(r=>r.code==='USUAL_REORDER'))lines.push('这是重新核价的上次组合。');
    else if(o.reasons.some(r=>r.code==='VERIFIED_PROTEIN'))lines.push('按已核验的蛋白质信息参与排序。');
  });
  lines.push(...result.notices);if(result.missingData.length)lines.push(`数据缺项：${result.missingData.join('、')}。`);return lines.join('\n');
}
async function terminal() {
  const verifier=new LocalTurnRegistry();const env=await createEnvironment(verifier);let last:Extract<RecommendationResult,{status:'ready'}>|null=null;
  const handle=async(line:string)=>{
    let action:MemoryAction|null=null;
    if(line==='/memory')action={action:'list'};
    if(['/pause','/resume','/clear'].includes(line))action={action:line.slice(1) as 'pause'|'resume'|'clear',userTurnRef:'pending'};
    const command=/^\/(forget|erase|undo|correct)\s+(\S+)(?:\s+([\s\S]+))?$/.exec(line);
    if(command) {
      const [,kind,id,text]=command;
      if(kind==='undo')action={action:'undo',undoRef:id!,userTurnRef:'pending'};
      else if(kind==='correct' && text)action={action:'correct',preferenceId:id!,text,userTurnRef:'pending'};
      else if(kind==='forget' || kind==='erase')action={action:'delete',preferenceIds:[id!],mode:kind==='erase'?'erase':'undoable',userTurnRef:'pending'};
    }
    if(action) {
      if(action.action!=='list') {const {userTurnRef,...details}=action;action.userTurnRef=verifier.register(line,{kind:'memory',...details});}
      console.log(JSON.stringify(await env.runtime.memory(action),null,2));return;
    }
    const remember=/^\/(remember|today)\s+([\s\S]+)$/.exec(line);
    if(remember) {
      const details={kind:'statement' as const,text:remember[2]!,persistence:remember[1]==='today'?'session' as const:'long_term' as const};
      console.log(JSON.stringify(await env.runtime.feedback({...details,userTurnRef:verifier.register(line,details)}),null,2));return;
    }
    if(line==='/yes' || line==='/no') {
      if(!last) {console.log('先选一份当前推荐。');return;}
      const details={kind:line==='/yes'?'accepted' as const:'rejected' as const,recommendationId:last.recommendationId,candidateId:last.options[0]!.candidateId};
      console.log(JSON.stringify(await env.runtime.feedback({...details,userTurnRef:verifier.register(line,details)}),null,2));return;
    }
    if(line.startsWith('/')) {console.log('未识别命令。可用 /memory、/remember、/today、/pause、/resume、/forget、/erase、/correct、/undo、/clear、/yes、/no、/quit。');return;}
    const result=await env.runtime.recommend({utterance:line,intent:parseLocalIntent(line),userTurnRef:verifier.register(line,{kind:'recommend',utterance:line})});
    last=result.status==='ready'?result:null;console.log(renderRecommendation(result));
  };
  try {
    const once=process.argv.slice(2).join(' '); if(once) {await handle(once);return;}
    console.log(`麦搭子 · ${env.mode==='fixture'?'模拟数据':'实时接入'}。输入想吃什么；/quit 退出。`);
    const rl=createInterface({input:process.stdin,output:process.stdout,terminal:process.stdin.isTTY});
    for await(const raw of rl) {const line=raw.trim();if(line==='/quit'){rl.close();break;}if(line)await handle(line);}
  } finally {await env.close();}
}
async function main() {if(process.argv[2]==='demo') {const demo=await runDemo();console.log(demo.notice);for(const s of demo.scenarios)console.log(`\n${s.utterance}\n${renderRecommendation(s.result)}`);}else await terminal();}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(()=>{console.error('McMate 运行失败，请检查本地配置。');process.exitCode=1;});
