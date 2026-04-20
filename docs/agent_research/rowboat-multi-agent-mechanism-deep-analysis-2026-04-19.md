# Rowboat Multi-Agent 机制深度分析

> 分析日期：2026-04-19
> 源码版本：rowboat monorepo (apps/rowboat + apps/x)
> 核心文件：`agents-runtime/agents.ts`(1579行) · `agents/runtime.ts`(1252行) · `agent-handoffs.ts`(290行) · `pipeline-state-manager.ts`(322行) · `workflow_types.ts`(199行) · `runs.ts`(139行) · `abort-registry.ts`(171行)

---

## 一、Multi-Agent 机制总览

Rowboat 包含 **两套独立的 Multi-Agent 系统**，分别服务 Web Dashboard 和 Electron 桌面端。

### 1.1 Web Dashboard 版：OpenAI Agents SDK Workflow 编排

**架构模型**：Handoff-Driven Workflow（基于 OpenAI Agents SDK 的 Agent 切换编排）

核心入口：`apps/rowboat/src/application/lib/agents-runtime/agents.ts` → `streamResponse()`

```
用户消息 → getStartOfTurnAgentName() 确定起始 Agent
         → turnLoop (while, 最多 25 次迭代)
           → OpenAI Agents SDK run(agent, inputs, {stream, maxTurns:25})
             → 处理 streaming events
               → raw_model_stream_event → 文本/工具调用
               → handoff_occurred → Agent 切换
               → message_output_item → 内部 Agent 回退
               → tool_call_output_item → 工具结果
           → 检查是否 user_facing Agent 产出文本 → 终止
```

**Agent 类型体系**（`WorkflowAgent` schema）：

| 类型 | outputVisibility | controlType | 含义 |
|------|-----------------|-------------|------|
| conversation | user_facing | retain / relinquish_to_start | 直接面向用户的对话 Agent |
| post_process | internal | relinquish_to_parent | 后台处理 Agent |
| escalation | user_facing | retain | 兜底升级 Agent |
| pipeline | internal | relinquish_to_parent | 流水线步骤 Agent |

**Agent 间切换机制**：

1. **Handoff（切换）**：Agent A 调用 `transfer_to_<AgentB>` 工具 → SDK 自动切换到 Agent B
2. **Pipeline Chain**：Pipeline 中的 Agent 无 handoff 权限，由 `handlePipelineAgentExecution()` 控制器按序推进
3. **Stack-based 回退**：内部 Agent 完成后，从 stack pop 出父 Agent 继续

### 1.2 Electron 桌面版：Vercel AI SDK Subflow 递归

**架构模型**：Agent-as-a-Tool Subflow（Agent 被注册为工具，LLM 决定何时调用子 Agent）

核心入口：`apps/x/packages/core/src/agents/runtime.ts` → `AgentRuntime.trigger()` → `streamAgent()`

```
用户消息 → AgentRuntime.trigger(runId)
         → while(true) 主循环
           → AgentState 从 event log 重建状态
           → streamAgent() 异步生成器
             → 处理 pendingToolCalls
               → type=agent → 递归调用 streamAgent()（子流）
               → type=builtin → execTool()
               → type=mcp → execMcpTool()
             → 检查 pendingAskHumans / pendingPermissions → 暂停
             → 消费 messageQueue 中的新用户消息
             → streamLlm() 调用 Vercel AI SDK streamText()
             → 处理 tool-call → spawn-subflow 事件
```

**Agent 定义**：Markdown 文件（YAML frontmatter + 指令文本），存储在 `~/.rowboat/agents/` 目录。

**子流机制**：Agent 的 tools 中可以声明 `type: "agent"` 的工具，调用时会递归进入子 Agent 的 `streamAgent()`，所有事件带 `subflow: [toolCallId, ...]` 前缀向上冒泡。

---

## 二、并行与串行处理

### 2.1 串行机制

**Web Dashboard 版**：

| 串行机制 | 实现 | 位置 |
|---------|------|------|
| turnLoop 主循环 | `while(true)` + `MAXTURNITERATIONS=25` | agents.ts:1341 |
| SDK run 同步等待 | `await run(agent, inputs, {maxTurns:25})` | agents.ts:1389 |
| Pipeline Chain | `handlePipelineAgentExecution()` 按序推进 | agents.ts:1186 |
| Handoff 串行切换 | 一次只能 transfer 到一个 Agent | agent_instructions.ts:93 |
| 工具调用串行 | pending tool calls 追踪，完成前不切换 Agent | agents.ts:1092 |

**Electron 桌面版**：

| 串行机制 | 实现 | 位置 |
|---------|------|------|
| Agent 主循环 | `while(true)` 同步循环 | runtime.ts:876 |
| 子流递归 | `for await (const event of streamAgent(...))` 同步等待 | runtime.ts:938 |
| LLM 单步 | `stopWhen: stepCountIs(1)` 每次只走一个 LLM step | runtime.ts:1173 |
| 权限等待 | pending permissions/ask-human → `return` 暂停 | runtime.ts:983 |

### 2.2 并行机制

**Web Dashboard 版**：

⚠️ **无真正的并行执行**。所有 Agent 在同一个 `turnLoop` 中串行运行。Pipeline 的多个步骤也是严格串行的。唯一的"并发"来自 OpenAI Agents SDK 内部的 tool 并行调用（同一个 Agent 可以同时发起多个 tool call），但 Agent 间切换是完全串行的。

**Electron 桌面版**：

同样 **无 Agent 级并行**。子流递归调用是同步 `for await` 的。唯一的并行性来自 LLM 内部的多 tool call（同一轮可以调用多个工具），但这也是在 `pendingToolCalls` 循环中逐一处理的。

### 2.3 对比总结

| 维度 | Web Dashboard | Electron 桌面版 |
|------|--------------|-----------------|
| Agent 级并行 | ❌ 无 | ❌ 无 |
| Tool 级并行 | SDK 内部可能并行 | 逐一串行处理 |
| Pipeline 并行 | ❌ 严格串行 | N/A（无 Pipeline） |
| 子 Agent 并行 | ❌ 串行切换 | ❌ 递归同步 |

---

## 三、约束体系：强约束 vs 弱约束

### 3.1 强约束（工程硬编码，不可绕过）

**Web Dashboard 版**：

| 约束 | 实现 | 强度 |
|------|------|------|
| Agent 类型枚举 | `z.enum(['conversation','post_process','escalation','pipeline'])` | ★★★★★ |
| controlType 验证 | `StrictWorkflowAgent.refine()` — pipeline 必须 internal + relinquish_to_parent | ★★★★★ |
| maxCallsPerParentAgent | 内部 Agent 每个父 Agent 最多调用 N 次（默认 3） | ★★★★ |
| turnLoop 迭代上限 | `MAXTURNITERATIONS = 25` | ★★★★ |
| SDK maxTurns | `MAX_AGENT_TURNS = 25` | ★★★★ |
| Pipeline Agent 无 handoff | `currentAgent.handoffs = []` | ★★★★★ |
| 同 Agent 自跳过 | `if (agentName === event.item.targetAgent.name) return` | ★★★★ |
| TransferCounter | `AgentTransferCounter` 追踪每对 Agent 的调用次数 | ★★★★ |

**Electron 桌面版**：

| 约束 | 实现 | 强度 |
|------|------|------|
| RunsLock | `runsLock.lock(runId)` — 同一 Run 不可并发触发 | ★★★★★ |
| AbortSignal | `signal.throwIfAborted()` 每轮/每工具检查 | ★★★★★ |
| 权限门控 | `isBlocked()` → `tool-permission-request` → 等待用户批准 | ★★★★★ |
| Session 命令白名单 | `sessionAllowedCommands` — 已批准命令可复用 | ★★★★ |
| LLM 单步限制 | `stopWhen: stepCountIs(1)` | ★★★★★ |
| Process Kill | `abort()` → SIGTERM → 200ms → SIGKILL + 进程组杀 | ★★★★★ |

### 3.2 弱约束（Prompt 指令，依赖 LLM 遵守）

**Web Dashboard 版**：

| 约束 | 实现 | 弱点 |
|------|------|------|
| Agent Instructions | `CONVERSATION_TYPE_INSTRUCTIONS` / `TASK_TYPE_INSTRUCTIONS` / `PIPELINE_TYPE_INSTRUCTIONS` | LLM 可能不遵守 |
| 转移规则 | `CHILD_TRANSFER_RELATED_INSTRUCTIONS` — "一次只转一个 Agent" | prompt 级约束 |
| 放弃控制指令 | `TRANSFER_GIVE_UP_CONTROL_INSTRUCTIONS` — 动态注入 | prompt 级约束 |
| 输出格式约束 | "不要输出 JSON""加 Internal message 前缀" | prompt 级约束 |
| RAG 使用指令 | `RAG_INSTRUCTIONS` — "不要编造信息" | prompt 级约束 |

**Electron 桌面版**：

| 约束 | 实现 | 弱点 |
|------|------|------|
| Agent Instructions | Markdown 文件中的指令文本 | LLM 可能不遵守 |
| Voice 输出格式 | `<voice>` 标签要求（长达数千字的格式指令） | prompt 级约束 |
| 搜索启用 | "使用 web-search 工具" | prompt 级约束 |

### 3.3 约束比例

- **Web Dashboard 版**：强约束 ~55% / 弱约束 ~45%（大量行为依赖 prompt 指令引导 Agent 正确切换）
- **Electron 桌面版**：强约束 ~70% / 弱约束 ~30%（权限系统、进程管理等硬编码较多）

---

## 四、检视与控制机制

### 4.1 Web Dashboard 版：4 层检视

| 层级 | 机制 | 作用 |
|------|------|------|
| 1. 事件流 | `emitEvent()` yield 每一条消息 | 实时可见每个 Agent 的输出 |
| 2. TransferCounter | 追踪 Agent 间调用次数 + maxCallsPerParentAgent | 防止无限循环 |
| 3. turnLoop 上限 | `MAXTURNITERATIONS=25` 硬切 | 防止死循环 |
| 4. PrefixLogger | 多层嵌套日志（agent-loop → iter-N → event-type） | 调试追踪 |

**关键缺失**：
- ❌ 无结构化结果审查（父 Agent 审查子 Agent 产出依赖 LLM 自行判断）
- ❌ 无 Checkpoint / 回滚机制
- ❌ 无人工干预点（除非 Agent 自行调用 ask-human）
- ❌ 无 Token 预算硬限制（UsageTracker 只记录不限制）

### 4.2 Electron 桌面版：6 层检视

| 层级 | 机制 | 作用 |
|------|------|------|
| 1. Event Log | RunEvent 持久化到 JSONL + SQLite | 完整事件回放 |
| 2. Subflow 树 | `subflow: [toolCallId, ...]` 标记嵌套深度 | 父子关系追踪 |
| 3. 权限门控 | `tool-permission-request/response` + scope(once/session/always) | 危险操作拦截 |
| 4. Ask-Human | `ask-human-request/response` 暂停等待 | 人在回路 |
| 5. Abort 机制 | 两级终止：graceful(SIGTERM) → force(SIGKILL) | 强制停止 |
| 6. Bus 发布 | 每个事件通过 Bus 发布到 UI | 实时可视化 |

**关键缺失**：
- ❌ 无子 Agent 递归深度限制（理论上可无限递归）
- ❌ 无迭代预算（主循环无硬性上限）
- ❌ 无结构化产出验证

---

## 五、防偷懒 / 防进度不一致机制

### 5.1 Web Dashboard 版

| 机制 | 实现 | 效果 |
|------|------|------|
| controlType 强制回退 | `relinquish_to_parent` / `relinquish_to_start` | 内部 Agent 完成后必须交还控制权 |
| Stack-based 追踪 | 父 Agent push 到 stack，子 Agent 完成后 pop | 确保控制权归还 |
| 给弃控制指令注入 | `maybeInjectGiveUpControlInstructions()` 动态注入 | 强化子 Agent 归还行为 |
| maxCallsPerParentAgent | 内部 Agent 调用次数限制 | 防止无限委托 |
| Pipeline 控制器 | `handlePipelineAgentExecution()` 外部推进 | Agent 无法跳过步骤 |

**弱点**：
- ❌ 无产出质量检查（Agent 输出 "Internal message: done" 就算完成）
- ❌ 无进度百分比追踪
- ❌ 无超时强制终止（只有迭代次数上限）

### 5.2 Electron 桌面版

| 机制 | 实现 | 效果 |
|------|------|------|
| 子流完成检查 | `if (!subflowState.getPendingAskHumans().length && !subflowState.getPendingPermissions().length)` | 子 Agent 必须完成所有待处理 |
| 最终响应提取 | `subflowState.finalResponse()` | 子 Agent 必须产出文本响应 |
| 权限阻断 | 危险工具等待批准才能执行 | 防止静默执行 |
| Abort 链传播 | 同一 AbortSignal 传递到所有子流 | 统一终止 |

**弱点**：
- ❌ 无迭代上限（主循环只检查"最后消息是否是 assistant 文本"来终止）
- ❌ 子 Agent 可以产出空响应就算完成
- ❌ 无任务分解进度追踪

---

## 六、工程效果 vs AI 能力贡献度

### 6.1 Web Dashboard 版

| 维度 | 工程贡献 | AI 贡献 | 说明 |
|------|---------|---------|------|
| Agent 切换决策 | 20% | **80%** | LLM 决定何时调用 `transfer_to_<Agent>` |
| Pipeline 执行 | **90%** | 10% | 步骤顺序由工程代码控制，Agent 只负责单步执行 |
| 工具调用 | 30% | **70%** | LLM 决定调用什么工具、传什么参数 |
| 控制权回退 | **60%** | 40% | controlType 硬编码 + prompt 引导 |
| 错误处理 | **95%** | 5% | TransferCounter、迭代上限、Stack 管理 |
| **综合** | **~40%** | **~60%** | |

### 6.2 Electron 桌面版

| 维度 | 工程贡献 | AI 贡献 | 说明 |
|------|---------|---------|------|
| 子 Agent 调用决策 | 10% | **90%** | 完全由 LLM 决定是否调用 agent 类型工具 |
| 权限管控 | **95%** | 5% | isBlocked() + 命令白名单 |
| 任务执行 | 20% | **80%** | LLM 自主规划和执行 |
| 进程管理 | **100%** | 0% | AbortRegistry 完全工程控制 |
| 状态重建 | **100%** | 0% | AgentState.ingest() 从 event log 重建 |
| **综合** | **~45%** | **~55%** | |

### 6.3 总结

**Rowboat 整体：工程 ~42% / AI ~58%**

Rowboat 的 Multi-Agent 系统**高度依赖 AI 大模型能力**。两个版本的核心调度决策（何时切换 Agent、调用什么工具、如何分解任务）都由 LLM 在运行时做出。工程层提供的是：防护栏（迭代上限、调用计数、权限门控）、状态管理（event log、stack、pipeline state）、通信基础设施（streaming、bus、message queue）。

---

## 七、设计优缺点

### 7.1 优点

| 优点 | 评分 | 说明 |
|------|------|------|
| **双系统适配** | ★★★★ | Web 版用 OpenAI Agents SDK 做 Workflow 编排，桌面版用 Vercel AI SDK 做自主代理，各取所长 |
| **Agent 定义简洁** | ★★★★★ | 桌面版用 Markdown 文件定义 Agent（YAML frontmatter + 指令），零代码创建 Agent |
| **Pipeline 串行链** | ★★★★ | Web 版支持 Pipeline 多步串行，有完整的状态管理器 |
| **权限门控（桌面版）** | ★★★★★ | 三级 scope(once/session/always)、命令黑名单、进程组杀 |
| **事件溯源（桌面版）** | ★★★★★ | 完整的 RunEvent 事件流 + JSONL 持久化，可回放整个执行过程 |
| **状态重建** | ★★★★ | 桌面版从 event log 完整重建 AgentState，支持断点续执行 |
| **Streaming 原生** | ★★★★ | 两个版本都是 AsyncGenerator 全流式输出 |
| **子流嵌套** | ★★★★ | 桌面版的 subflow 机制支持理论无限嵌套 |

### 7.2 缺点

| 缺点 | 评分 | 说明 |
|------|------|------|
| **无 Agent 级并行** | ★★ | 两个版本都是严格串行，无法并行执行多个 Agent |
| **无结构化产出审查** | ★★ | 子 Agent 产出无 schema 验证，父 Agent 审查依赖 LLM 判断 |
| **Web 版无权限系统** | ★★ | Web Dashboard 版完全没有工具权限门控 |
| **子流无深度限制** | ★★ | 桌面版理论上可无限递归子 Agent（无 MAX_DEPTH） |
| **主循环无迭代上限（桌面版）** | ★★ | 桌面版 `streamAgent()` 的 while(true) 无硬性上限 |
| **两套系统不统一** | ★★★ | Web 和桌面版是完全独立的实现，无代码复用 |
| **Pipeline 状态管理初级** | ★★★ | `PipelineStateManager` 用内存 Map 存状态，无持久化 |
| **prompt 约束占比高（Web 版）** | ★★ | Web 版 ~45% 的行为靠 prompt 约束，LLM 不遵守则失控 |
| **无 Checkpoint/回滚** | ★★ | 两个版本都没有 checkpoint 机制 |
| **TransferCounter 无重置** | ★★★ | 调用计数按 turn 累积，无法在长对话中重置 |

---

## 附录：与其他系统对比

| 维度 | Rowboat (Web) | Rowboat (Electron) | AG (对比) | Hermes (对比) |
|------|--------------|-------------------|-----------|--------------|
| 架构模型 | Handoff Workflow | Agent-as-Tool Subflow | DAG + 中央治理 | LLM-Driven Delegation |
| Agent 并行 | ❌ | ❌ | ✅ Fan-Out/Join | ✅ ThreadPool batch |
| 强约束比例 | ~55% | ~70% | ~65% | ~60% |
| 结构化审查 | ❌ | ❌ | ✅ ReviewEngine | ❌ |
| Checkpoint | ❌ | ❌ | ✅ CheckpointMgr | ❌ |
| 权限门控 | ❌ | ✅ 3级 | ✅ Intervention | ❌ |
| 代码行数 | ~2400 | ~1400 | ~8000+ | ~1200 |
| 工程/AI | 40/60 | 45/55 | 70/30 | 25/75 |
