# Interactive Meal Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付无需账号的预算配餐网页、复用示例和可验收的官方只读接入路径。

**Architecture:** 原生网页通过同源 JSON API 调用现有 Runtime。服务仅绑定本机，用临时 SQLite 和未验证的用户来源执行只读推荐。官方绑定逐项验证，真实失败不回退到合成数据。

**Tech Stack:** Node.js >=24.21.0、TypeScript、node:http、node:sqlite、现有 Zod / MCP SDK / Vitest、原生 HTML / CSS / JavaScript；不新增前端框架和模型服务。

**Spec:** [已批准设计](../specs/2026-10-11-interactive-meal-demo-design.md)。用户于本聊天批准设计；实施计划待审阅和执行方式选择。

## Global Constraints

- 单人、立即到店自取；没有下单、付款、领券、积分消费、历史查询和随单购买会员。
- 同一推荐引擎处理 fixture / live；默认示例，真实失败不能静默切换示例。
- 网页只提供本餐预算、避含糖饮品和排除鸡肉；不宣称任意自然语言理解或长期记忆。
- UI 色彩全部 OKLCH、锚色相 85、语义 token；playful、原创细金双拱、字体 Bricolage Grotesque + Noto Sans SC。
- 正文至少 14px、字号最多五档；对比度正文 4.5:1、边界和焦点 3:1；320 / 375 / 414 / 768 / 1440 宽度均验收。
- 焦点环即时；一次结果入场编排不超过 500ms，仅 transform / opacity；reduced-motion 为 150ms 透明度过渡。
- 真实配置与证据只在本机；不公开 Token、账号原始数据、数据库、用户路径或真实门店选择记录。
- 先读适用技能、在隔离工作区执行；逐任务完成有意义的测试再提交，不重复编写现有引擎测试。

## Review Focus

1. 修改条件后慢响应返回：旧结果不得覆盖新条件，Task 3 浏览器验证。
2. 浏览器跨站或 DNS rebinding 请求：拒绝错误 Host / Origin，不返回账号数据，Task 2 API 测试。
3. 配置 live 但缺凭据或未验证绑定：明确不可用，不能出现示例推荐，Task 4 / 6 测试。
4. 菜单优惠依赖随单购会员、组合券不兼容：不自动产生额外权益或错误总价，Task 5 契约测试。
5. 中文名称、缺分类或营养中缺糖字段：未知不变成符合鸡肉排除 / 无糖限制，Task 5 契约测试。

## 文件职责

- `runtime/src/web/contracts.ts`：严格请求与公共响应类型、验证。
- `runtime/src/web/environment.ts`：临时仓库、provider、生命周期，关闭不泄漏句柄。
- `runtime/src/web/presentation.ts`：从真实引擎结果投影商品、费用、来源和限制依据。
- `runtime/src/web/server.ts` / `runtime/src/web-server.ts`：可测试 HTTP 服务 / 终端入口。
- `runtime/web/index.html` / `styles.css` / `app.js`：可访问表单、设计 token、请求与失效状态。
- `runtime/src/official/diagnostics.ts` / `runtime/src/official-diagnostics.ts`：只读诊断 / CLI 入口。
- `runtime/src/providers/official-pickup-normalizers.ts` / `official-pickup-profile.ts`：公开文档映射、经复核启用的操作。
- `runtime/examples/*.ts`：独立运行的领域模块用法；由现有 tsx 执行，不进入 MCP 服务构建。
- `runtime/tests/web-*.test.ts` / `official-*.test.ts`：新增行为与契约测试。
- `docs/interactive-demo.md` / `docs/validation.md` / README / Skill 参考：使用、状态和证据。

### Task 1: 配餐服务契约与共享 Runtime

**Files:** Create `runtime/src/web/contracts.ts`, `environment.ts`, `presentation.ts`; Test `runtime/tests/web-meal.test.ts`。

**Interfaces:**
- Consumes `McMateRuntime.recommend(RecommendRequest): Promise<RecommendationResult>`、`FixtureProvider`、`MemoryRepository`、`unverifiedHost`。
- Produces `WebMealInput = { budgetMaxFen: number; avoidSugaryDrinks: boolean; excludeChicken: boolean }`，strict Zod schema，预算安全整数且非负；缺字段、未知字段、字符串金额均不接受。
- Produces `createWebEnvironment(options: { mode: 'fixture' | 'live'; clock?: () => string }): Promise<WebEnvironment>`，含 `recommend(input): Promise<WebMealResponse>`、`status(): Promise<WebStatus>`、`close(): Promise<void>`。
- `WebStatus` 包含 mode、capability state 和配置门店 ID，不含 userId、Token、地址和数据库路径。`WebMealResponse` 是 ready / needs_input / unavailable 联合；ready 只保留 mode、每项商品名和数量、预算分值、实付分值、费用优惠明细、理由、查询时间、刷新期限和数据来源。

- [ ] 写失败测试 `rejects_invalid_budget_and_unknown_fields`：-1、1.2、字符串、MAX_SAFE_INTEGER+1、未知 `userId` 全拒绝，0 接受。
- [ ] 写 `shares_runtime_without_persistent_learning`：输入 3000 分 + 无糖，结果 ready 且 exactly one；实付不超过 3000、没有 cola；再加排除鸡肉后没有 chicken；环境的偏好列表保持空，重复请求不学习。
- [ ] 写 `zero_budget_does_not_loosen_limits`：0 分返回 unavailable；错误中没有私密路径。
- [ ] 运行 `npm test -- tests/web-meal.test.ts`，确认因尚未实现接口而失败。
- [ ] 实现上述三个模块，临时 `:memory:` 仓库、partySize=1、pickup、chooseOne=true；结构化生成请求，verifier 始终 unverifiedHost。投影按对应商品数量显示，不从名称猜证据。
- [ ] 相同测试通过；`npm run typecheck` 通过；提交 `feat: add read-only web meal service`。

### Task 2: 本机 HTTP 服务与资源白名单

**Files:** Create `runtime/src/web/server.ts`, `runtime/src/web-server.ts`; Modify `runtime/package.json`; Test `runtime/tests/web-server.test.ts`。

**Interfaces:** Consumes Task 1；Produces `startWebServer({ environment, port = 0, webRoot }): Promise<{ url: string; close(): Promise<void> }>`；入口默认端口 8787，`MCMATE_WEB_PORT` 可选整数 1..65535，监听仅 127.0.0.1。

- [ ] 写 HTTP 失败测试：GET status 200；有效 POST 200；schema 无效 400；非 JSON 415；请求体超过 4096 字节 413；未知路径 404；不允许方法 405。
- [ ] 写 Host / Origin 测试：仅当前 `127.0.0.1:<port>` Host；跨站 Origin 和非同源 Fetch Metadata 返回 403；JSON POST 没有 Origin 仅允许无浏览器 Fetch Metadata 的本机 CLI。不发送 CORS 通配符。
- [ ] 写资源测试：只有 `/`、`/styles.css`、`/app.js` 和明确字体文件可访问；编码路径穿越、`.env`、`.data` 均 404。
- [ ] 写并发测试：最多 2 个执行中推荐，额外请求 429；异常和断开后释放计数；关闭终止服务并关闭仓库与 transport。
- [ ] 运行 `npm test -- tests/web-server.test.ts`，确认失败。
- [ ] 实现白名单、no-store API、限定 Host / Origin、4096 字节体限制和固定公共错误；日志不输出请求体、Token 或供应商原始错误。加 `web: tsx src/web-server.ts` 和 `web:build: node dist/web-server.js` 启动脚本，复用现有构建。
- [ ] 对应测试与 typecheck 通过；提交 `feat: serve local interactive meal demo`。

### Task 3: 麦之宝库交互页面

**Files:** Create `runtime/web/index.html`, `styles.css`, `app.js`; Create `docs/interactive-demo.md`。

**Interfaces:** Consumes Task 2 JSON endpoints；网页金额输入为元，最多两位小数，精确转整数分；页面不自行推荐、凑价或生成营养。

- [ ] 在 CSS 开头写 design 戳和全部 token，再写组件；中文标题/正文 700/400，五档 16 / 20 / 25 / 31.25 / 39.06px，语义化 4pt 间距和命名层级。加载两款字体，使用 swap；不添第三款字体。
- [ ] 实现顶部示例标识、左侧表单、右侧开放结果区、薄金双拱元素；移动端表单在前。按钮固定短文案，输入有 label，错误关联 aria-describedby，结果有礼貌 aria-live，依据用原生 details。
- [ ] 实现初始、加载、ready、无结果、错误、条件已变、报价过期状态。输入变化即清除当前“合格”状态；AbortController + 递增请求序号防止旧结果覆盖。首次结果只做一次入场。
- [ ] 刷新期限到达后显示“价格需刷新”；隐藏已核验状态，保留旧组合供查看。费用、优惠、示例标识和本地刷新非锁价提示准确呈现。
- [ ] 通过浏览器测试：改预算、无糖、鸡肉排除、0预算、网络失败恢复、键盘完整操作、慢请求后修改条件、报价过期。不得出现旧数据对应新限制。
- [ ] 在 320 / 375 / 414 / 768 / 1440 检查横向滚动与按钮换行；测正文、边界和焦点对比度；验证 reduced-motion；逐条回答用户前端规约十二项。记录实际截图和检查结果。
- [ ] 提交 `feat: build Maimate treasure-vault meal interface`。不用为纯样式写镜像测试；API 和业务逻辑已有独立验证。

### Task 4: 脱敏官方只读诊断

**Files:** Create `runtime/src/official/diagnostics.ts`, `runtime/src/official-diagnostics.ts`; Modify `runtime/package.json`; Test `runtime/tests/official-diagnostics.test.ts`。

**Interfaces:** Consumes `McpTransport`；Produces `inspectOfficialTools(transport): Promise<{ state: 'discovered' | 'unavailable'; tools: Array<{ name: string; schemaHash: string }>; errorCode?: string }>`。允许显示的工具名仅附近门店、菜单、详情、当前门店券、算价；不导出账号载荷。

- [ ] 写失败测试：分页发现、重复游标拒绝、缺 Token 返回 AUTH_REQUIRED；故意含 Token/电话号码的上游错误不出现在结果；工具发现不能标记 account_verified。
- [ ] 运行 `npm test -- tests/official-diagnostics.test.ts`，确认失败。
- [ ] 实现诊断、安全 CLI；复用 OfficialMcpTransport；只做 tools/list 并保证 finally close。脚本 `official:inspect`。
- [ ] 测试与 typecheck 通过；无凭据运行应给明确未连接状态、退出码非零，不打印堆栈。提交 `feat: add safe official MCP discovery`。

### Task 5: 到店自取契约映射

**Files:** Create `runtime/src/providers/official-pickup-normalizers.ts`, `official-pickup-profile.ts`; Test `runtime/tests/official-pickup.test.ts`；如确有需要，最小修改现有 adapter 的扩展接口，保持默认 unverifiedProfile。

**Interfaces:** Consumes现有 BindingProfile / Binding、decimalToFen、quoteRequestSchema / validateQuote；Produces `createOfficialPickupProfile(review: PickupReview): BindingProfile`。`PickupReview` 必须明确经复核的操作集合、schema hash、各金额字段单位、费用完整性字段、默认商品组成和商品证据。默认没有 review，不启用真实操作。

- [ ] 写金额测试：菜单 `18.90` 元→1890 分，报价1890分不再乘100；指数、负数、多于两位小数、溢出拒绝。
- [ ] 写 scope 测试：pickup 映射 orderType=1 / beType=1；即时请求不携带 ISO reservationDate；外送/预约/随单购拒绝；不存在用户选定门店时不生成占位编码。
- [ ] 写商品测试：未知分类和 foodTags 保留未知；营养缺糖保持 null；仅经审核的精确商品/规格事实能表达无糖或鸡肉；默认套餐组成未核实不进入推荐。
- [ ] 写券测试：只有唯一兼容商品时把 couponId/couponCode 放入该项；不兼容、过期、重复匹配和缺 couponCode 拒绝。名称和营销标签不等于资格证据。
- [ ] 写报价测试：商品金额 + 必付费用 - 优惠 = total；数量、商品与请求不一致拒绝；缺费用不设 completeFees；随单购优惠不可当免费优惠；有效期采用本地30秒刷新窗口，不宣称上游锁价。
- [ ] 写 adapter 测试：没 review、schemaHash改变、缺任一必要操作时真实推荐不可用；不会调用创建订单、历史、领取券或积分操作。
- [ ] 运行 `npm test -- tests/official-pickup.test.ts`，确认失败；实现严格原始载荷校验及经过验证的映射，不修改公开示例来伪造真实通过。
- [ ] 契约测试和既有 provider-contract 测试通过；提交 `feat: add reviewed pickup mapping contracts`。没有账号时保持 document_tested 状态，不能将 verified 标志用于未经账号复核的生产调用。

### Task 6: 真实接入、状态和有限只读验证

**Files:** Modify `runtime/src/web/environment.ts`, `.env.example`, `runtime/README.md`; Create `docs/official-pickup-validation.md`; Test `runtime/tests/web-live.test.ts`。

**Interfaces:** Consumes Tasks 4 / 5，继续使用既有 MCMATE_BINDING_MODULE 配置；用户自有模块基于复核工厂导出 profile。真实门店选择在本机 CLI/配置完成，网页不传任意账户或门店。

- [ ] 写 live 测试：缺 Token / 门店 / binding / schema匹配时 status 明示不可用；推荐不返回 fixture；供应商断开保持 live unavailable；临时环境不读取用户已有偏好 DB。
- [ ] 运行测试确认失败，再实现配置、mode 锁定和结果来源校验。默认网页脚本 fixture；live 必须显式配置，不能继承意外的默认用户身份。
- [ ] 通过测试，按官方文档写本机配置步骤，不要求用户在聊天粘贴 Token。
- [ ] 仅检查凭据是否可用，不读取或输出凭据值。若未配置，说明未进行真实验收，交付诊断与配置说明后保留此项未完成。
- [ ] 有账号时先发现实际 schema，再经用户在本机选定的门店做菜单/详情/券/算价只读验收，按字段复核金额、完整费用和限制证据；限制缺证据应拒绝，无糖不可用也须准确记为未通过。
- [ ] 文档记录调用日期、验证项目、结果与剩余问题，不保存原始账号响应或认证材料。通过的操作才启用；未完成不称真实闭环完成。
- [ ] 提交 `feat: connect validated live pickup mode`；真实验收未完成时用准确的状态描述提交配置和降级实现。

### Task 7: 复用例子、验证与仓库交付

**Files:** Create `runtime/examples/recommendation.ts`, `preferences.ts`, `provider.ts`; Modify README、`runtime/package.json`、`docs/validation.md`、`skills/maimate/references/capabilities.md`、`runtime-contract.md`；Create `docs/assets/interactive-demo.png`（真实运行截图）。

**Interfaces:** 三例分别演示 recommendMeals、临时 MemoryRepository 的实际写入读取、McDonaldsProvider 的 fixture 实现；没有新“通用平台”接口。Script 为 `example:recommendation`、`example:preferences`、`example:provider`，分别用 tsx 执行同名 examples 文件。

- [ ] 例子使用临时数据库，关闭后清理，输出中带示例标识；不让模型/网页通过例子伪装受信任用户输入。
- [ ] 运行三例，验证推荐预算、偏好读写和供应商能力输出可核对；README 首屏先解释价值、给启动命令和实际运行截图，能力表准确区分示例、契约验证和真实账号验证。
- [ ] 在 runtime 运行 `npm test`、`npm run typecheck`、`npm run build`、`npm run demo`，结果全通过；Web 入口和构建入口均能启动，验证 SIGINT / 关闭释放端口。
- [ ] 重新验证 Skill 安装不覆盖已有目标、文档链接和新增引用；不重复无变更部分的完整场景评估。
- [ ] 做全分支评审，聚焦金额、限制、模式边界和网页数据失效；按实际执行技能规定使用评审工具，不擅自另开用户聊天。
- [ ] Git diff check 与公开文件扫描通过，提交；通过 GitHub 连接器同步已验证文件。若创建 PR，挂到本聊天；禁止 force push 覆盖用户更新。
- [ ] 公开仓库文件与本地一致，README 图可加载；展示可运行页面和截图，明确真实验收是否完成以及本机启动命令。不承诺 Star 数。

## 计划自检与执行交接

所有设计范围分别落到 Tasks 1–7；新 HTTP 边界、结果失效、未知商品证据、金额单位和 live 降级有明确验收。新增接口都只属于网页或本机绑定，不冒充已发布 MCP 工具；没有扩大交易授权。

建议 Native：本会话逐任务实施，共享 Runtime / HTTP / 页面接口紧密相关，直接执行便于连续验证。用户审阅本计划并选择执行方式后，按选定方法实施。
