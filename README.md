# 麦Mate · MyMate

**麦Mate，My mate。你的麦之宝库，记得你的口味。**

一个麦当劳个人点餐 Skill：支持明确商品、帮我选、老样子、多人需求拆分，以及可控的口味探索。附完整产品架构、麦之宝库视觉指引和可运行的本地推荐 Runtime。

这是个人项目与概念设计，非麦当劳官方产品。**默认演示使用合成菜单、价格、营养和订单。** 真实账号参数映射尚未验收，包内 Runtime 不下单、不付款、不消耗积分。Skill 的场景指导与当前后端已实现能力分开标注。

![麦Mate 产品概念：点餐、麦之宝库、这一餐](docs/assets/maimate-product-v0.2.png)

## 安装 Skill

需要 Python 3，仅用于复制本地 Skill 文件，无额外 Python 依赖。

```sh
git clone https://github.com/sixgadss/maimate-skill.git
cd maimate-skill
python3 scripts/install_skill.py
```

默认安装到 `$CODEX_HOME/skills/maimate`；未设置 `CODEX_HOME` 时使用 `~/.codex/skills/maimate`。目标已存在时拒绝覆盖。其他兼容宿主可指定目录：

```sh
python3 scripts/install_skill.py --destination ~/.agents/skills/maimate
```

在支持本地 Skills 的宿主重新加载后，可用：

```text
用 $maimate 帮我选一餐麦当劳，30 元以内。
用 $maimate 按老样子来，但今天不想吃鸡肉。
用 $maimate 给我们两个人配餐，我喝无糖，他喝普通饮料。
用 $maimate 设计带麦之宝库元素的点餐界面。
```

安装只复制 Skill、参考文件和概念图；不会启动服务、连接账号或修改 MCP 配置。没有相关工具时，Skill 会说明实际能力，不编实时报价或声称记忆已保存。

## 运行本地演示

可选 Runtime 需要 Node.js 24.21.0 或更高版本。

```sh
cd runtime
npm ci --ignore-scripts
npm run build
npm run demo
npm run cli
```

`demo` 在临时数据库演示预算、训练后、代选、无糖和老样子。`cli` 使用本地持久数据库，实际终端输入可以完成偏好闭环。演示数据不代表真实商品或价格。

MCP 宿主可用 `node` 启动本仓库的 **绝对路径** `runtime/dist/mcp-server.js`。也可在 runtime 目录用 `npm --silent start`，避免 npm 横幅污染 stdio。配置方式按宿主实际要求填写，不能把文件安装等同于服务已连接。

默认 stdio 提供只读推荐及偏好查看；写入需要独立于模型的可信用户来源。模型不得通过伪造 `userTurnRef` 或改走 CLI 来绕过验证。

## 三条选餐路径，共用一个宝库

- **直接点餐**：保留明确商品、规格和数量，按实际工具精确核价。
- **帮我选**：有证据的首选；要比较时最多三个合格方案。
- **老样子**：读取有效历史或真实收藏，重新核验可售和完整价格。

多人按临时餐位区分限制，整单报价才决定最终预算。惊喜保留硬约束和本次已看组合；当前明确预算优先，未提出新预算时不默认增加已选方案实付。收藏、优惠、个人偏好和订单历史各有边界。

## 能力状态

| 能力 | 当前交付 |
| --- | --- |
| Skill 路由、偏好规则、探索与去重指导 | 已提供，可由兼容宿主执行；依赖实际数据能力 |
| 预算、营养证据、默认规格推荐、老样子 | 本地 Runtime 已实现，默认合成数据 |
| 持久偏好、完成订单学习 | 可信 CLI / 宿主可用；默认 stdio 写入关闭 |
| 明确商品精确核价 | Skill 可路由至已连接的原生能力；本地推荐工具没有精确篮子输入 |
| 多人不同限制与整单核价 | Skill 有流程与降级规则；Runtime 尚无餐位级接口 |
| 跨轮惊喜去重 | Skill 在已返回候选中按会话筛选；后端没有跨轮排除参数 |
| 真实菜单、优惠、账号与实时价 | Adapter 基础已实现，仍需逐项验证账号映射 |
| 收藏、愿望清单、订单提交、付款 | 本地后端未实现；不得以文案假装可用 |
| App 界面 | 架构、视觉规范和生成效果图；没有前端实现 |

## 文件入口

- [Skill 主文件](skills/maimate/SKILL.md)
- [完整产品架构](docs/product-architecture.md)
- [能力与数据接入](skills/maimate/references/capabilities.md)
- [选餐、多人和惊喜规则](skills/maimate/references/journeys.md)
- [记忆与宝库](skills/maimate/references/memory.md)
- [麦之宝库视觉体系](skills/maimate/references/visual-system.md)
- [Runtime 接口](skills/maimate/references/runtime-contract.md)
- [后端配置与范围](runtime/README.md)
- [验证记录](docs/validation.md)

```text
skills/maimate/      可安装的 Skill、渐进加载参考文件、视觉资产
runtime/            TypeScript 推荐、SQLite 记忆、MCP Adapter、CLI、测试
docs/               产品架构、视觉概念、验证记录
evaluations/        可复现的行为场景与评估要点
scripts/            无覆盖安装脚本
```

## 开发验证

在 runtime 目录运行：

```sh
npm test
npm run typecheck
npm run build
npm run demo
```

验证不连接真实账号、不下单。Skill 的场景测试验证行为判断，Runtime 测试验证代码，二者都不能替代真实账号接入与 App 可用性验收。

概念图通过内置 imagegen 生成，完整[生成提示词](docs/assets/maimate-product-v0.2-prompt.txt)随仓库提供。UI 设计中的金额占位不代表免费。实际价格、优惠与履约数据应来自已核验的[麦当劳官方接入](https://open.mcd.cn/mcp)。
