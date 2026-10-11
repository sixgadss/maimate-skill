import assert from 'node:assert/strict';
import {MemoryRepository} from '../src/memory/repository.js';
// Direct repository API demonstration, not user authorization for an agent to persist data.
const memory=new MemoryRepository(':memory:','example-only',()=>new Date().toISOString());
try{
 assert(memory.recordStatement('example-statement',{key:'drink.sugar_policy',value:'avoid_sugary_drinks',rule:'exclude',target:null,scope:{}},'long_term'));
 const listed=memory.manage({action:'list'});assert(listed.ok&&listed.action==='list'&&listed.preferences.length===1);
 console.log(JSON.stringify({source:'临时记忆示例',result:listed},null,2));
 const cleared=memory.manage({action:'clear',userTurnRef:'example-clear'});assert(cleared.ok);
 const after=memory.manage({action:'list'});assert(after.ok&&after.action==='list'&&after.preferences.length===0);
 console.log('示例偏好已从临时数据库清空。');
}finally{memory.close();}
