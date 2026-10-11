import {parseBudget,createMealState,formatMoney} from './state.js';
const $=id=>document.getElementById(id);const state=createMealState();let controller=null,timer=null,entered=false,mode='fixture';
const money=formatMoney;
function error(text){$('form-error').textContent=text;$('form-error').hidden=!text;$('budget').setAttribute('aria-invalid',text?'true':'false');}
function invalidate(){state.invalidate();controller?.abort();clearTimeout(timer);$('submit').disabled=false;error('');
 if(state.view(Date.now()).payload){$('door').classList.add('stale');$('result-state').textContent='条件已变 · 请重新选餐';$('result-message').textContent='这份组合对应之前的条件。';}}
for(const id of ['budget','sugar','chicken'])$(id).addEventListener('input',invalidate);
function line(label,value){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('quote-lines').append(dt,dd);}
function list(id,texts){$(id).replaceChildren(...texts.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));}
function expired(){if(state.view(Date.now()).phase!=='expired')return;$('door').classList.add('stale');$('result-state').textContent='价格需刷新';$('result-message').textContent='这份报价已过刷新期限，请重新查询。';}
function render(payload){$('door').classList.remove('stale');$('result-message').textContent='';
 if(payload.status!=='ready'){$('meal-result').hidden=true;$('empty').hidden=false;$('result-state').textContent='暂时没有合适的一餐';$('result-message').textContent=payload.message;return;}
 const meal=payload.meal;mode=payload.mode;$('empty').hidden=true;$('meal-result').hidden=false;$('result-state').textContent=mode==='fixture'?'已核验示例组合':'已核验当前报价';
 $('result-source').textContent=mode==='fixture'?'合成示例 · 到店自取':'当前门店 · 到店自取';$('payable-label').textContent=mode==='fixture'?'示例实付':'完整实付';$('payable').textContent=money(meal.payableFen);
 $('food-list').replaceChildren(...meal.items.map(item=>{const li=document.createElement('li'),name=document.createElement('span'),quantity=document.createElement('span');name.textContent=item.name;quantity.textContent=`× ${item.quantity}`;li.append(name,quantity);return li;}));
 list('reasons',meal.reasons);list('evidence',meal.evidence);$('quote-lines').replaceChildren();
 line('商品小计',money(meal.subtotalFen));for(const fee of meal.fees)line(fee.label,money(fee.amountFen));if(!meal.fees.length)line('必付费用',money(0));
 for(const discount of meal.discounts)line(discount.label,`− ${money(discount.amountFen)}`);line('完整实付',money(meal.payableFen));
 line('本次预算',money(meal.budgetFen));line('门店',meal.restaurantId==='demo-store'?'演示门店':meal.restaurantId);
 line('查询时间',new Date(meal.observedAt).toLocaleTimeString('zh-CN'));line('数据来源',meal.source);
 if(!entered){$('door').classList.add('enter');entered=true;}
 clearTimeout(timer);timer=setTimeout(expired,Math.max(0,Date.parse(meal.validUntil)-Date.now()));expired();
}
$('meal-form').addEventListener('submit',async event=>{event.preventDefault();const budgetMaxFen=parseBudget($('budget').value);
 if(budgetMaxFen===null){error('请输入非负金额，最多两位小数。');$('budget').focus();return;}
 error('');controller?.abort();controller=new AbortController();const version=state.invalidate();clearTimeout(timer);
 $('door').classList.add('stale');$('submit').disabled=true;$('result-state').textContent='正在核验这一餐';$('result-message').textContent='';
 try{const response=await fetch('/api/recommend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({budgetMaxFen,avoidSugaryDrinks:$('sugar').checked,excludeChicken:$('chicken').checked}),signal:controller.signal});
  const payload=await response.json();if(!response.ok)throw new Error(payload.message??'查询暂时不可用。');
  if(state.accept(version,payload)){render(payload);$('submit').disabled=false;}
 }catch(e){if(e.name==='AbortError')return;const payload={status:'unavailable',mode,message:'查询暂时不可用，请保留条件后重试。'};
  if(state.accept(version,payload)){render(payload);$('submit').disabled=false;}}
});
fetch('/api/status').then(response=>{if(!response.ok)throw new Error();return response.json();}).then(status=>{
 mode=status.mode;$('mode').textContent=mode==='fixture'?'无需账号 · 示例体验':'真实菜单体验';
 $('demo-note').textContent=mode==='fixture'?'示例商品、价格和营养为合成数据。':'价格和可售状态以本次查询为准。';
 if(status.state!=='available'){$('result-message').textContent='真实接入尚未核验，请完成本机配置。';$('submit').disabled=true;}
}).catch(()=>{$('mode').textContent='连接暂时不可用';$('result-message').textContent='请检查本机服务后刷新页面。';$('submit').disabled=true;});
