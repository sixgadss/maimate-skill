import {it,expect} from 'vitest';
import {runDemo} from '../src/cli.js';
import {parseLocalIntent} from '../src/application/preferences-parser.js';
it('runs five synthetic product scenarios with fixture labels and a remembered usual',async()=>{
  const demo=await runDemo(); expect(demo.mode).toBe('fixture');expect(demo.scenarios).toHaveLength(5);
  for(const scene of demo.scenarios) expect(scene.result.status).toBe('ready');
  const ready=(id:string)=>{const r=demo.scenarios.find(s=>s.id===id)?.result;if(!r || r.status!=='ready')throw new Error(`Missing ready ${id}`);return r;};
  expect(ready('budget').options.every(o=>o.quote.payable.amountFen<=2000)).toBe(true);
  expect(ready('choose_one').options).toHaveLength(1);
  expect(ready('workout').options[0]!.items[0]!.productId).toBe('chicken');
  expect(ready('zero_sugar').context.hard.avoidSugaryDrinks).toBe(true);
  expect(ready('usual').options[0]!.items.map(i=>i.productId)).toEqual(['chicken','corn','zero']);
});
it('local intent grammar extracts supported Chinese scenarios without supplying an absent budget',()=>{
  expect(parseLocalIntent('我今天健完身，30 块以内')).toMatchObject({mode:'post_workout',budgetMaxFen:3000});
  expect(parseLocalIntent('今天你帮我选一个')).toMatchObject({chooseOne:true});
  expect(parseLocalIntent('老样子')).toMatchObject({mode:'usual'}); expect(parseLocalIntent('今天吃什么').budgetMaxFen).toBeUndefined();
});
