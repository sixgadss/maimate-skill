import type { MealIntent } from '../contracts/runtime.js';
import type { Product } from '../contracts/provider.js';
import type { PreferenceChange } from '../memory/preferences.js';
import { decimalToFen } from '../providers/native-normalizers.js';
/** Deliberately closed grammar. Host LLMs may extract broader context into validated intent. */
export function parseLocalIntent(text:string):MealIntent {
  const intent:MealIntent={};
  const budget=/(\d+(?:\.\d{1,2})?)\s*(?:块|元)\s*(?:钱)?\s*(?:以内|以下|之内)/.exec(text);
  if(budget) intent.budgetMaxFen=decimalToFen(budget[1],'yuan');
  if(/老样子|跟以前一样|平时那个/.test(text)) intent.mode='usual';
  else if(/健完身|健身完|训练后|练完|蛋白质/.test(text)) intent.mode='post_workout';
  else if(/换.*口味|换点|不想重复/.test(text)) intent.mode='explore';
  else if(/赶时间|马上开会|赶高铁/.test(text)) intent.mode='hurry';
  else if(/省钱|便宜|最值|块以内|元以内/.test(text) || budget) intent.mode='value';
  if(/选一个|只给一个|就一个/.test(text)) intent.chooseOne=true;
  if(/不想重复|不想吃重复/.test(text)) intent.goal='no_repetition';
  else if(/吃饱|饱一点/.test(text)) intent.goal='satisfying';
  else if(/减脂|低热量/.test(text)) intent.goal='lower_energy';
  if(/今天.*(?:不吃|不想吃).*鸡肉/.test(text)) intent.excludedFoodTags=['chicken'];
  if(/不喝(?:有糖|含糖)饮料|只喝(?:零度|无糖饮料)/.test(text)) intent.avoidSugaryDrinks=true;
  const minutes=/只有\s*(\d+)\s*分钟/.exec(text); if(minutes) {intent.timeBudgetMinutes=Number(minutes[1]);intent.mode='hurry';}
  if(/外送|外卖/.test(text)) intent.channel='delivery'; else if(/自取/.test(text)) intent.channel='pickup';
  return intent;
}
export function parsePreference(raw:string,products:Product[],provider:string):{change:PreferenceChange;sessionOnly:boolean}|null {
  const text=raw.trim().replace(/^[记記]住\s*[:：，]?\s*/,'').replace(/[。！!]$/,'');
  const sessionOnly=/^(今天|这次|这一餐)/.test(text);
  const body=text.replace(/^(今天|这次|这一餐|以后)/,'');
  const base={target:null,scope:{}};
  if(/^(?:我)?(?:基本)?(?:不喝有糖饮料|不喝含糖饮料|只喝零度|只喝无糖饮料)$/.test(body))
    return {change:{...base,key:'drink.sugar_policy',value:'avoid_sugary_drinks',rule:'exclude'},sessionOnly};
  if(/^(?:我)?(?:不要添加糖|不吃添加糖)$/.test(body)) return {change:{...base,key:'food.added_sugar',value:true,rule:'exclude'},sessionOnly};
  if(/^(?:我)?(?:不吃鸡肉|不想吃鸡肉)$/.test(body)) return {change:{...base,key:'food.tag.chicken',value:true,rule:'exclude'},sessionOnly};
  if(/^(?:我)?(?:不限制糖|没有糖限制)$/.test(body)) return {change:{...base,key:'drink.sugar_policy',value:'no_restriction',rule:'soft'},sessionOnly};
  const matched=/^(?:我)?(喜欢|不吃|不要再推荐)(.+)$/.exec(body);
  if(matched) {
    const found=products.filter(p=>p.name===matched[2]);
    if(found.length!==1) return null;
    const p=found[0]!; return {change:{key:`food.product.${provider}:${p.productId}`,target:{provider,productId:p.productId},value:matched[1]==='喜欢',rule:matched[1]==='喜欢'?'soft':'exclude',scope:{}},sessionOnly};
  }
  return null;
}
