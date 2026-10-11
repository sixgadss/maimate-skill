# McMate 本地 Runtime 契约 v0.1

这是项目内已实现的接口；是否可调用取决于宿主是否启动本地服务。调用前检查实际工具及 schema。默认 stdio 启动支持只读推荐和 list，反馈及记忆变更会返回 UNVERIFIED_TURN。完整类型在 src/contracts，本文可独立使用。

## 通用约定

- 所有金额为 CNY 整数分；日期为含时区偏移的 ISO 8601。
- account/userId 由宿主或本地绑定，不能作为 LLM 可任意选择的参数。
- 写操作的 `userTurnRef` 必须由宿主验证真实用户消息和具体动作；字符串本身不是授权。只读推荐可以使用普通关联标记，例如 readonly，它不会开启历史同步或决策持久化。
- `recommendationId`、`candidateId` 是不透明引用，不自行构造。
- 价格、营养等事实带来源；fixture 结果必须显示为模拟。

## mcmate_recommend

输入：

```ts
{
  userTurnRef: string;
  utterance: string;
  intent: {
    mode?: 'default' | 'value' | 'post_workout' | 'explore' | 'hurry' | 'usual';
    chooseOne?: boolean;
    budgetMaxFen?: number;
    partySize?: number;
    channel?: 'pickup' | 'dine_in' | 'delivery' | 'drive_through';
    restaurantId?: string;
    addressRef?: string;
    serviceAt?: string;
    mealPeriod?: 'breakfast' | 'lunch' | 'dinner' | 'late_night';
    timeBudgetMinutes?: number;
    goal?: 'satisfying' | 'protein' | 'lower_energy' | 'no_repetition';
    maxEnergyKcal?: number;
    excludedAllergens?: string[];
    avoidSugaryDrinks?: boolean;
    avoidAddedSugar?: boolean;
    excludedFoodTags?: string[];
    excludedProductIds?: string[];
    sessionPreferenceExceptions?: string[];
  };
}
```

未出现的字段省略；不能猜 user location、门店 ID、商品 ID 或过敏史。本轮硬约束必须完整提取，Runtime 核对真实用户表述后合并。avoidSugaryDrinks 与 avoidAddedSugar 可同时为 true；任一字段 false 必须有本次明确放开相应普通饮食限制的表述，不能解除过敏约束。excludedFoodTags 只使用 Runtime 支持的已验证商品属性，未知属性不能按名称猜。历史选择由 Runtime 读取，不让 LLM 转述猜测的“个人档案”。精确定位、地址和令牌由已有宿主授权与选择流程提供。

结果为以下三类之一：

```ts
type Result =
  | { status: 'ready'; recommendationId: string; mode: 'live' | 'fixture';
      context: MealContext; options: Option[]; evidence: Evidence[];
      validUntil: string; missingData: string[]; notices: string[]; searchCoverage: 'bounded' }
  | { status: 'needs_input'; field: string; question: string; reason: string }
  | { status: 'unavailable'; reason: string; explanation: string;
      nextAction: string; rejectedReasons: Array<{ code: string; count: number }> };
```

`Option` 包含 candidateId、role、items、itemNames、mealFingerprint、quote、score、reasons。role 为 best_fit / best_value / explore；options 长度为 1..3，chooseOne 时恰为 1。usual 模式先独立验证历史原组合，通过就唯一返回；失效才说明原因并改为普通推荐，不让普通排序静默换掉老样子。

quote 包含 quoteId、basketHash、snapshotHash、完整 request、payable（currency / amountFen）、completeFees、verifiedTotal、sellable、observedAt、validUntil、evidenceId。`ready` 要求费用完整、总价核验、商品可售、通过所有硬限制，并且未超有效期。

reasons 是 `{ code, evidenceIds }` 列表。Evidence 含 id、kind、sourceRef、observedAt、certainty、facts。certainty 分 explicit、verified、inferred。只改写提供的 facts；拒绝理由和 missingData 不自动构成正面优势。

人民币展示：用整数分格式化到小数点后两位，可删除尾随零；“标价”不等于“当前应付价”。不同候选只能在同 scope 与可比较需求下比较。

## mcmate_feedback

输入为以下一种：

```ts
{ kind: 'accepted' | 'rejected'; recommendationId: string;
  candidateId: string; userTurnRef: string }
{ kind: 'meal_feedback'; orderId: string; text: string; userTurnRef: string }
{ kind: 'statement'; text: string; persistence: 'session' | 'long_term';
  userTurnRef: string }
```

Runtime 检查 turn 与语义、候选归属和事件幂等。accepted 只记录选择；完成订单只由 Provider 同步，不能让 Skill 用 feedback 声称已完成。statement 的 persistence 是提取建议，仍由 Runtime 核对“今天”与“长期”的来源。

输出 `{ ok: true, kind, changedScope: string[] }` 或 `{ ok: false, error: { code, message } }`。只有 ok=true 才能声称对应操作成功。关闭自动学习时仍允许明确记忆。当前支持无糖、添加糖、鸡肉排除及菜单唯一商品名的明确喜欢/排除；不识别的自由文本返回 UNSUPPORTED_STATEMENT，“今天”不允许写成长期偏好。

## mcmate_memory

输入：

```ts
{ action: 'list' }
{ action: 'correct'; preferenceId: string; text: string; userTurnRef: string }
{ action: 'delete'; preferenceIds: string[]; mode?: 'undoable' | 'erase';
  userTurnRef: string }
{ action: 'undo'; undoRef: string; userTurnRef: string }
{ action: 'pause' | 'resume'; userTurnRef: string }
{ action: 'clear'; userTurnRef: string }
```

list 返回偏好类型、值、范围、来源、证据强度/过期状态和学习开关。写操作返回 `{ ok: true, action, changedScope, undo: { ref, validUntil } | null }` 或错误。delete 禁止旧历史重新构建被删 key；clear 删除本地偏好、学习事件及派生记忆，记录历史重放禁用规则，保留订单恢复所需的操作记录。保留的恢复记录不能参与老样子或重新学习。用户若要求连交易缓存都清空，需 Runtime 支持对应范围，不能擅自宣称已执行。

可逆更正与学习开关可保留短期 Undo 引用，不弹确认框。delete 默认 undoable：在仅本地短期缓冲保留恢复数据，超过有效期销毁；undo 将偏好和历史重放阻止状态在同一事务恢复，核验账户、版本和期限。用户说彻底删除时设置 mode=erase；erase 和 clear 不留恢复副本，undo=null。清空按实际范围执行，不扩大到供应商远程账户。

## 宿主验证与订单边界

宿主需持有独立于模型工具调用的 TurnVerifier。CLI 只从实际终端输入登记精确动作；登记接口不对 MCP 暴露。真实宿主可以注入自己的验证器，不能把“模型提交的 turnId 非空”当验证。默认服务不存在 register-turn、order-prepare 或 order-commit 工具，createOrder 返回 UNSUPPORTED，不产生真实订单。
