# Optional McMate Runtime

随麦Mate Skill 提供的本地 TypeScript 后端。工具名保持 `mcmate_*`，便于兼容现有宿主；Skill 名为 `maimate`。

## 启动

需要 Node.js >=24.21.0。代码使用该版本的 `node:sqlite.DatabaseSync`。

```sh
npm ci --ignore-scripts
npm run build
npm run demo
npm run cli
```

Demo 全部使用合成数据与临时 SQLite。CLI 支持 `/remember 文本`、`/today 文本`、`/memory`、`/pause`、`/resume`、`/forget 偏好ID`、`/erase 偏好ID`、`/correct 偏好ID 文本`、`/undo 引用`、`/clear`、`/yes`、`/no`、`/quit`。`/yes` 只接受推荐，不代表订单完成。

终端自身登记实际输入的来源。该路径不能由模型拿来冒充受信任宿主消息；自动调用 CLI 不赋予持久写入权限。

## MCP

以 `node /绝对路径/maimate-skill/runtime/dist/mcp-server.js` 启动 stdio。也可在本目录用 `npm --silent start`。stdout 只用于 MCP 协议。

三个工具：`mcmate_recommend`、`mcmate_feedback`、`mcmate_memory`。默认 verifier 为 unverifiedHost；反馈与记忆写入返回 UNVERIFIED_TURN。可信宿主可注入 TurnVerifier，验证实际用户消息、具体动作和期限，不能使用模型自行生成的字符串作为证明。接口详见 [Runtime 契约](../skills/maimate/references/runtime-contract.md)。

## 配置

环境变量由启动进程提供；不会自动读取 `.env`。

| 变量 | 用途 |
| --- | --- |
| MCMATE_PROVIDER | fixture（默认）或 live |
| MCMATE_USER_ID | 宿主绑定的本地用户，默认 local |
| MCMATE_DB | 可选 SQLite 绝对路径 |
| MCMATE_RESTAURANT_ID | 已核验门店；fixture 默认 demo-store |
| MCMATE_BUSINESS_ENTITY_ID | 上游业务实体（若需要） |
| MCMATE_CHANNEL | 已核验渠道；fixture 默认 pickup |
| MCMATE_BINDING_MODULE | live 使用的已复核 JS 映射模块绝对路径 |
| MCD_MCP_TOKEN | 由官方渠道获取并通过环境注入的凭据 |

默认数据库在本目录 `.data/fixture/` 或 `.data/live/`。live 还按 Token 指纹隔离用户分区，轮换 Token 会开始新分区。数据库、凭据、构建产物不进入仓库。

Binding 默认导出 `{ id, bindings }`；每个操作含 `verified`、`args(input)`、`isSuccess(nativePayload)`、`normalize(nativePayload,input)`。默认无经过验证的真实绑定，返回 UNSUPPORTED。依据实际 tools/list 与账号样本核验输入、金额单位、状态、完整费用和营养规格后才能启用。测试里的载荷不代表官方当前 schema。

## 当前范围

推荐使用默认规格和固定套餐，不支持任意换配配置。无糖饮品限制下，缺饮品组件证据的固定套餐被排除。未知硬约束证据不能视为通过。引擎做有界搜索，不能称全菜单最低价。

“老样子”先核验适用的已完成单人历史。多人数量报价不等于完整餐位级推荐。没有收藏、愿望清单、订单创建、积分消耗或付款工具。

偏好按用户隔离；删除与清空阻止历史重放恢复旧偏好。暂停停止新增学习，保留已有记忆。彻底删除与清空不保留 Undo；不承诺清除用户备份或供应商远程交易。接受推荐不用于制造完成订单。

官方资料：[平台](https://open.mcd.cn/mcp)、[接入文档](https://open.mcd.cn/mcp/doc)。

## 互动网页与只读诊断

`npm run web` 打开无需账号的预算配餐网页；构建后可用 `npm run web:build`。本机默认地址为 `http://127.0.0.1:8787`，可设置 MCMATE_WEB_PORT。网页用临时记忆，不读取 MCMATE_DB 或 MCMATE_USER_ID，也不提供偏好写入与交易入口。详细状态与实测截图见 [互动示例](../docs/interactive-demo.md)。

`npm run official:inspect` 只做 tools/list，输出读取工具名和 schemaHash；缺 Token 时返回 AUTH_REQUIRED、退出码 1，不输出原始上游错误。真实网页要求本机模块默认导出 `createOfficialPickupProfile(review)`，总体和五项操作均完成实际账号复核。默认 document_tested 不启用真实调用，旧通用绑定不作为网页已验收依据。见 [到店自取验证](../docs/official-pickup-validation.md)。
