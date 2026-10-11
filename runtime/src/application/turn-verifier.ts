import { randomUUID } from 'node:crypto';
import { stableHash } from '../domain/schemas.js';
export interface TurnVerifier { verify(ref:string,action:unknown):boolean }
/** Only the trusted host owns this registry; register is never an MCP tool. */
export class LocalTurnRegistry implements TurnVerifier {
  private turns=new Map<string,{hash:string;expires:number}>();
  constructor(private clock=()=>Date.now()) {}
  register(text:string,action:unknown):string {
    if(!text.trim()) throw new Error('Actual human text required');
    for(const [id,t] of this.turns) if(t.expires<=this.clock()) this.turns.delete(id);
    if(this.turns.size>=1000) this.turns.delete(this.turns.keys().next().value!);
    const ref=`host:${randomUUID()}`; this.turns.set(ref,{hash:stableHash(action),expires:this.clock()+300000}); return ref;
  }
  verify(ref:string,action:unknown):boolean {
    const t=this.turns.get(ref); return !!t && t.expires>this.clock() && t.hash===stableHash(action);
  }
}
export const unverifiedHost:TurnVerifier={verify:()=>false};
