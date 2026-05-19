# Antigravity 降级评估：从主逻辑到平级 Provider

> 背景：Antigravity IDE 的额度持续走低，不能再作为主路径承担全部生产流量。本文评估"把 Antigravity 降级为像 Codex CLI 一样的可选 Provider"是否可行、代价多大、需要先补哪些坑。
>
> 调研基于 `src/lib/bridge/`、`src/lib/providers/`、`src/lib/agents/`、`src/lib/backends/` 和 `docs/internals/` 的源码与设计文档。

## 2026-05-09 实施状态

已落地：
- 组织级默认 provider 已改为 `claude-api`，不再默认回落到 `antigravity`。
- Department run / Prompt run 的 session handle 绑定已改为 provider-neutral，不再只给 `antigravity` 写 `childConversationId / activeConversationId`。
- review-loop shared conversation reuse 已从 provider 名判断改为 backend capability 判断。
- supervisor 周期巡检已改为基于 `AgentBackend` diagnostics + evaluate session 的通用主线，不再只在 `provider === 'antigravity'` 时启动。
- `restart_role` / review-loop resume 不再为了取消旧会话或恢复执行而强依赖 Antigravity native runtime。

仍保留到后续阶段：
- `~/.gemini/antigravity/**` 路径与 home 命名迁移。
- `/api/conversations` 与 Department run 主链的进一步统一。
- Antigravity richer diagnostics / annotation 与通用 diagnostics 的能力继续对齐。

---

## 一、我的判断（先给立场）

**方向完全正确，但不能一步切。**

调研下来，Antigravity 在系统里的位置已经远比"一个 Provider"更深：它一边是协议路径（gRPC + Connect Streaming），一边是隐形的"能力供给者"——Language Server 替我们做了 system prompt 拼装、规则注入、live state 推送、shared conversation 复用。这些能力当前的代码都没在 Node 端实现过，只是默认"反正 Antigravity 会做"。

如果直接把 default 切到 `claude-api`，代码不会报错，但你会发现：
- Supervisor 巡检静默不再启动（`group-runtime.ts:2142` 写死了 `provider === 'antigravity'`）；
- `.agents/rules/*.md` 的 trigger 规则不再生效（IDE 端的 Language Server 不再帮你读盘）；
- 多轮 review 的 token 消耗会从"O(轮次)"退化成"O(轮次²)"，因为没有 shared cascade 复用了。

这三件事都不会抛异常，只会"变笨"。所以**降级必须先补能力，再切默认值，最后清理死代码**——三步，顺序不能乱。

---

## 二、调研速读：三类机制

### A. Antigravity 独有（去掉就丢失能力）

**协议级独有**——这些是 gRPC 私有协议，无法用其它 Provider 复刻：
- `bridge/discovery.ts:93-187` 用 `ps aux + lsof` 抓每个 IDE 实例的 PID/端口/CSRF/workspaceId
- `bridge/gateway.ts:139-241` 通过 `GetAllCascadeTrajectories` 反查 cascade owner，构建 `convOwnerMap`
- `bridge/grpc.ts:42-205` 实现 `application/connect+json` 二进制 envelope（5 字节 header）
- `StartCascade` + `UpdateConversationAnnotations(antigravity.task.hidden=true)` 是创建隐藏子对话的唯一入口（`antigravity-executor.ts:73-95`）
- `StreamAgentStateUpdates` 增量推送 `indices`/`totalLength`，对应 step-merger.ts + watch-conversation.ts:113，**Codex 和 Claude Code 都没有这种"实时步级状态流"**
- Artifact Auto-Approve 协议（`builtin-backends.ts:527-576`）—— `proceedArtifact` + `ARTIFACT_APPROVAL_STATUS_APPROVED` 仅 AG 有
- IDE 端 system-prompt 自动拼装：`/dev-worker` 前缀进 `items[].text`，由 Language Server 自己读 `.agents/rules/`，Node 端零代码（`IDE_CUSTOM_INSTRUCTIONS.md:46-49`）

**概念级独有**——行为/约定独有，但若做兼容协议层可重建：
- 隐藏子对话 + 后台 cascade（`antigravity.task.{hidden,parentId,stageId,runId}` 注解）
- Supervisor 巡检（`supervisor.ts:67-200` 周期性 `getTrajectorySteps`）
- Shared cascade（`sharedState.authorCascadeId`）让多轮 review 复用同一条会话，这是 AG 独有的 token 优化路径
- 端到端工件落盘 + 文件轮询双信号（`builtin-backends.ts:578-616` 同时轮询 `delivery-packet.json` / `result.json` 兜底 stream 失联）

### B. 已被抽象层覆盖（去掉无影响）

- `TaskExecutor` / `AgentSession` / `AgentBackend` 接口已经 transport 无关：`providers/types.ts:97-112`、统一事件流 `started / live_state / completed / failed / cancelled`
- `getExecutor()` 工厂分派（`providers/index.ts:60-74`）已支持把 antigravity 当成可选项
- `resolveProvider` + capability fallback（`ai-config.ts:505-553` + `department-execution-resolver.ts:219-293`）已经能在 antigravity 不支持时回退
- ClaudeEngine 通路（`claude-engine-backend.ts`）覆盖 native-codex / claude-api / openai-api / gemini-api / grok-api / custom，能力上是 AG 之外覆盖最广的路径
- Pipeline / Stage / Run / DAG / ReviewEngine / ScopeGovernor 全部是纯逻辑层，对任何 Executor 工作
- Memory hooks（`builtin-backends.ts:1106-1126`）已把组织/项目/用户记忆注入到 `baseInstructions`

### C. 隐式耦合（去掉会断裂）

这一节最关键——以下是降级时真正的雷区：

- **`group-runtime.ts` 至少 10 处硬编码 `provider === 'antigravity'`**：236-243（resolveNativeRuntime 必走）、473-478 / 508-513（写 childConversationId）、1124-1128（dispatch 入口分流）、1288（bindConversationHandle）、1430-1432（appendMessage 报错）、1562-1564（Supervisor 临时降级）、1663（restart_role 只走 native）、2142-2143（**startSupervisorLoop 仅 antigravity**）、2148/2306/2359/2370（authoritative 检查 + shared cascade）
- **Workflow 注入分裂在两层**：`asset-loader.ts:216-230` 解析 `/dev-worker` → `~/.gemini/antigravity/gateway/assets/workflows/dev-worker.md`，但拼进 prompt 的时机随 Provider 不同。**Antigravity 路径长期依赖 IDE 端规则系统补 `.agents/rules`**——切到 codex/claude-code 后，规则文件不会自动注入
- **`StreamAgentStateUpdates` 等价物在其它 Provider 上不存在**：Codex/Claude Code legacy session 只在结束时一次性 emit `completed`；ClaudeEngine 的 `supportsStepWatch: false`。Supervisor 和 Stuck 检测的唯一数据源消失
- **Supervisor / Evaluate / Diagnostics 直调 `grpc.*`**：必须重写为基于 `getRecentSteps`，但 Codex/Claude Code 端没实现这个方法
- **`~/.gemini/antigravity/...` 路径硬编码遍布 50+ 文件**：仅是路径耦合，可改名但量大
- **`isAuthoritativeConversation`**（`runtime-helpers.ts:24-26`）：用 `activeConversationId` 判定 superseded branch——这个概念只对 AG 有意义（cascade 可被 fork/revert），其它 Provider 永远不会 supersede。换 Provider 后会变成死代码，但遗留 run 数据可能误触发

---

## 三、三种降级方案对比

| 方案 | 内容 | 工作量 | 风险 | 适用情境 |
|:--|:--|:--|:--|:--|
| **激进**：直接删 bridge | 把 `bridge/`、`antigravity-executor.ts`、`grpc.ts`、所有 `~/.gemini/antigravity` 路径全部移除 | 大（涉及 50+ 文件 rename + 删除 ~3000 行） | **高**：Supervisor、Live state、Shared cascade 全部丢失，且立即静默退化；遗留数据迁移问题 | ❌ 不推荐 |
| **保守**：仅切默认值 | 把 `defaultProvider` 改成 `claude-api`，其余代码原封不动 | 极小（~5 行） | **中**：上面三个能力坑会立刻显现，"功能没坏，但变笨了" | ❌ 不推荐 |
| **中庸**：先补能力，再降级，最后清理 | 三阶段推进：能力补齐 → opt-in Provider → 死代码清理 | 中等（~2-3 周） | **可控**：每阶段都有回退路径，最大风险（Supervisor 静默失效）在阶段 0 解决 | ✅ **推荐** |

---

## 四、推荐路径：三阶段中庸方案

### 阶段 0：能力补齐（先补三个坑，不动主链路）

**目标**：让非 antigravity 的 Provider 拥有"够用的看护与上下文能力"，否则降级后会静默退化。

**0.1 Supervisor 抽象化**（最关键）
- 在 `AgentBackend` 接口上加 `getRecentSteps(handle, limit)` 能力声明
- 给 `ClaudeEngineBackend` 实现 `getRecentSteps`（基于内部 message buffer）
- 把 `supervisor.ts:67-200` 从直接调 `grpc.*` 改为调 `backend.getRecentSteps`
- 移除 `group-runtime.ts:2142-2143` 的 `provider === 'antigravity'` 守卫
- 工作量：~2 天 · 风险：可控（旧路径保留，新路径走 backend）

**0.2 `.agents/rules/` 注入到 Node 端**
- 在 `claude-engine-backend.ts` 的 `baseInstructions` 拼装链路里加 rules 解析器
- 解析 frontmatter（`trigger: always_on / manual / auto / globs`）
- 当 trigger 是 `always_on` 时强制注入；`globs` 匹配当前 workspace 文件时注入
- 工作量：~1 天 · 注意：codex-executor.ts:52 现有的 `~/.gemini/antigravity/memory/` 兜底应当**只**在没有 workspace rules 时才生效，不要重复注入

**0.3 ClaudeEngine 端的 conversation reuse**
- 给 `ClaudeEngineBackend` 加 `appendMessage` 真实实现（当前可能是抛错）
- 在 `group-runtime.ts:2306, 2370` 的 sharedState 路径上把 `provider === 'antigravity'` 守卫改成 `backend.capabilities.supportsAppend`
- 工作量：~1-2 天 · 收益：多轮 review 的 token 消耗保持线性

**阶段 0 验收**：把 `defaultProvider` 临时切到 `claude-api` 跑一个完整 Pipeline（4 阶段 review-loop），确认：Supervisor 启动且能检测 stuck、`.agents/rules/` 中标 always_on 的规则进入了 prompt、第 N+1 轮 review 的 token 不是第 N 轮的全量重发。

### 阶段 1：把 Antigravity 降级为 opt-in Provider

**目标**：清理 `group-runtime.ts` 中的硬编码分支，让 antigravity 成为众多 Provider 之一，不再享有特权。

**1.1 默认值切换**
- `ai-config.ts:38` 的 `defaultProvider` 改为 `claude-api`
- 修 `DEFAULT_CONFIG.layers` 中所有 antigravity 默认值
- `department-setup-dialog.tsx` 的 NativeSelect 把 antigravity 移到列表末尾或加 "(legacy)" 标签

**1.2 group-runtime.ts 分支泛化**
按调研报告 C 节列的 10 处依次处理。重点：
- `1124-1133`：把 `server, apiKey` 从公共参数中剥离，只在 antigravity 分支构造
- `1663` restart_role：必须改为 `getAgentBackend(provider).start(config)` 通用入口
- `1430-1432` appendMessage 错误信息：判断依据从 provider 名改为 `capabilities.supportsAppend`

**1.3 Workflow 注入路径统一**
- 把 `applyProviderExecutionContext` 的拼接逻辑作为唯一真相源
- 删除"靠 IDE 端读盘"的隐式假设——所有 Provider 都走显式注入

**阶段 1 验收**：在 `claude-api` 默认下完整跑通 OPC 三种执行场景（Coordinated / Ad-hoc / Strategic），把 antigravity 当作 opt-in fallback 测一次，确保两边都能跑且互不干扰。

### 阶段 2：长期清理（低优先级、机会主义）

- `bridge/` 整层标记为 `bridge/antigravity/`，明确它是 antigravity-specific adapter
- `~/.gemini/antigravity/` 路径全局重命名为 `~/.<product>/`（建议：`~/.opc/` 或 `~/.cowork/` 之类与产品身份对齐）
- `convOwnerMap` 持久化到 sqlite 的部分（`gateway-db.ts`）保留但加注释说明只在 antigravity 选用时有效
- `MODEL_PLACEHOLDER_M26 / M47` 等占位符替换为真实模型 id
- `antigravity.task.*` annotations 在非 antigravity 路径上确认无人消费、安全删除
- `isAuthoritativeConversation` / `activeConversationId` 加迁移脚本：把存量 run 数据中的 superseded 标记清掉，避免误触发

**阶段 2 不阻塞业务**——可以在写新功能时顺手清理。

---

## 五、降级时最容易踩的三个坑（再强调）

这三个是调研里我反复警惕的，单独列出来：

**坑 1：Supervisor 静默不启动。**
`group-runtime.ts:2142` 当前写死 `if (provider === 'antigravity') startSupervisorLoop(...)`。如果阶段 0 没补，切默认值后整个公司"没人巡检"——run 卡住时不会自动 nudge，CEO 也不会收到 stuck 事件。这是 OPC 北极星里"治理闭环"的核心能力，必须保留。

**坑 2：`.agents/rules/` 失效但不报错。**
`docs/IDE_CUSTOM_INSTRUCTIONS.md:62-65` 已经有警告：codex 兜底只读 `~/.gemini/antigravity/memory/`（组织级），不读 workspace 的 `.agents/rules/`。这意味着：用户辛苦写的部门规则、人设、约束，切 Provider 后**全部静默丢失**。代码不会报错，输出会"看起来差不多但更平庸"。必须在阶段 0 补。

**坑 3：Shared cascade 优化丢失。**
AG 的 review-loop 之所以 token 高效，是因为同一个 Pipeline 内多轮 review 复用同一条 cascade（`sharedState.authorCascadeId`）。切到一次性子对话模型后（codex 默认就是这样），每轮 review 都会重发完整上下文——`docs/internals/ag-vs-claude-code-multi-agent.md` 里量化过这个差距，AG 比 CC 在某些场景上 token 消耗低 6.9 倍。降级前必须确认 ClaudeEngine 端能复用 conversation。

---

## 六、与产品愿景的对齐检查

这次降级与北极星（"AI 软件组织系统"）和长期路线图的关系：

- **节点 1（执行底座收口）**：本次降级实质上就是在加速节点 1。`ExecutionBackend` 契约统一、capability matrix 引入、Stage Runtime 不再依赖 transport 细节——这些目标和"把 antigravity 降为平级"高度重合。
- **节点 2（治理内核闭环）**：阶段 0 的 Supervisor 抽象化是治理闭环的前置。
- **战略边界第三条**："不在执行内核统一前继续横向扩 provider"——本次降级正是在统一执行内核。

所以这不是一个"省钱的权宜之计"，而是恰好对齐产品主线的架构动作。**额度问题反倒成了推动正确架构演进的契机**。

---

## 七、立即可做的下一步（本周）

如果只能挑三件事开始动手，我建议：

1. **跑通"阶段 0 验收"小实验**：在一个隔离环境里把 `defaultProvider` 临时切到 `claude-api`，跑一遍 review-loop，把 Supervisor 不启动、规则丢失、token 暴涨这三个症状量化记录下来，作为后续修复的基线。
2. **写"Supervisor 抽象化"的设计稿**：基于现有 `getRecentSteps` 接口，补一份 1-2 页的 mini RFC，明确 ClaudeEngineBackend 端怎么实现、怎么和 sharedState 兼容。
3. **盘点 `~/.gemini/antigravity/` 的所有引用**：grep 一遍，分类标记（路径 / 业务逻辑 / 注释），为阶段 2 的全局重命名做准备。

---

## 八、一句话结论

> Antigravity 不是该被切除的器官，而是该被降级的旧引擎。但在拔掉它的电源之前，必须先把它默默替你做过的三件事——巡检、规则注入、会话复用——补到 ClaudeEngine 这边来。补完之后，它就真的只是众多 Provider 中的一个，而你的系统也就真正"独立"了。

---

*版本：v1.0 · 基于源码与文档调研 · 与产品演进、长期路线图、Post-Migration Roadmap 保持一致。*
