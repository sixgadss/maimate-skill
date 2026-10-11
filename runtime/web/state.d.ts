export function formatMoney(fen:number):string;
export function parseBudget(text:string):number|null;
export function createMealState():{
 invalidate():number;
 accept(id:number,value:{status:string;meal?:{validUntil:string}}):boolean;
 view(now:number):{phase:string;payload:unknown};
};
