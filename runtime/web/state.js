export function formatMoney(fen){
 if(!Number.isSafeInteger(fen)||fen<0)throw new RangeError('Invalid amount');
 const amount=BigInt(fen);return `¥${amount/100n}.${String(amount%100n).padStart(2,'0')}`;
}
export function parseBudget(text) {
 const match=/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(text.trim());
 if(!match)return null;
 const amount=BigInt(match[1])*100n+BigInt((match[2]??'').padEnd(2,'0'));
 return amount<=BigInt(Number.MAX_SAFE_INTEGER)?Number(amount):null;
}
export function createMealState(){
 let version=0,payload=null,stale=false;
 return {
  invalidate(){version++;stale=payload!==null;return version;},
  accept(id,value){if(id!==version)return false;payload=value;stale=false;return true;},
  view(now){const phase=stale?'stale':!payload?'empty':payload.status!=='ready'?'unavailable':Date.parse(payload.meal.validUntil)<=now?'expired':'ready';return {phase,payload};},
 };
}
