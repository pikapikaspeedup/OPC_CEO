# Multi-Agent 系统架构深度对比报告

**Antigravity Mobility CLI (V5.4) vs Claude Code Team Agent**

> 基于源码级分析的系统性对比。覆盖架构设计、执行模型、Token 消耗、并行机制、安全治理、状态管理等 12 个维度。

---

## 摘要

Antigravity (AG) 和 Claude Code (CC) 分别代表了当前 Multi-Agent 系统设计的两种极端策略：**显式编排治理** vs **Prompt 驱动隐式协作**。本文从 12 个维度展开对比分析，量化了两者在 Token 消耗上的 ~6.9× 差距，并提出了融合两者优势的混合架构方案。

---

## 1. 设计哲学

### 1.1 AG：显式 DAG 编排 + 中央治理

AG 的多 Agent 系统是一个**项目治理框架**。它的核心假设是：

> 软件交付有明确的阶段划分（需求 → 架构 → 开发），这些阶段的依赖关系、审查规则、产物契约可以也应该被预先定义。

这个假设落地为以下设计：

- **Template / GraphPipeline** 定义流程 DAG
- **Source Contract** 声明上下游依赖
- **Typed Contracts (V4.4)** 在编译期校验产物兼容性
- **Scope Audit** 自动审计代码修改范围
- **Resource Quota** 约束执行规模

关键源码模块：
- `src/lib/agents/dag-compiler.ts` — 将 Template 编译为 DAG IR
- `src/lib/agents/dag-runtime.ts` — 运行 DAG，驱动 stage 推进
- `src/lib/agents/contract-validator.ts` — 校验数据契约
- `src/lib/agents/scope-governor.ts` — Scope 越权审计
- `src/lib/agents/fan-out-controller.ts` — 并行分支管理

### 1.2 CC：Prompt 驱动的本地 Swarm

CC 的多 Agent 系统是一个**本地 Swarm OS**。它的核心假设是：

> 认知型任务的拆分和编排不应该硬编码，应该让 LLM 根据上下文动态决定。代码只需要提供可靠的协作原语。

这个假设落地为以下设计：

- `coordinatorMode.ts` 的 system prompt 定义协调策略（Research → Synthesis → Implementation → Verification）
- `AgentTool` 拉起 worker（一次性 subagent 或长驻 teammate）
- 文件 mailbox 做跨进程消息总线
- 共享 task list 做任务分配和状态追踪
- 权限桥接回 leader

关键源码模块：
- `src/coordinator/coordinatorMode.ts` — Coordinator prompt（~400 行纯 prompt 工程）
- `src/utils/swarm/inProcessRunner.ts` — In-process teammate 长驻循环
- `src/utils/teammateMailbox.ts` — 文件消息总线
- `src/utils/tasks.ts` — 共享任务系统
- `src/hooks/useInboxPoller.ts` — Leader 控制面中枢

### 1.3 核心差异一句话

| | AG | CC |
|--|---|---|
| 谁决定流程 | **代码**（Template JSON） | **Prompt**（Coordinator system prompt） |
| 调度器在哪 | `dag-runtime.ts` | 不存在——"调度逻辑"在 prompt 里 |
| Agent 的角色 | stage 内执行者 | 流程参与者 + 执行者 |

---

## 2. Agent 生命周期

这是两个系统最深层的执行模型差异。

### 2.1 AG：一次性隔离子对话

```
Runtime dispatch → 创建 Hidden Child Conversation → Agent 执行 Workflow → 写 result.json → 子对话结束
```

每个 role（如 pm-author、architecture-reviewer）在每轮审查中都是**全新的、完全独立的子对话**。上下文从零开始，通过读取 `input/` 目录来获取上游产物。

**优点**：
- 完美隔离——Agent 间不可能互相污染
- 确定性更强——相同输入 → 相似输出
- 崩溃不传染——一个子对话失败不影响其他

**代价**：
- 每次都要重新注入 system prompt + 代码库上下文 + 上游产物
- 无法利用同一个 Stage 内审查轮次间的上下文积累
- Token 消耗随轮次线性增长

### 2.2 CC：双模型——Job vs Actor

CC 有两种截然不同的 Agent 生命周期：

#### 2.2.1 普通 Background Subagent（Job 模式）

```
AgentTool spawn → runAgent() 执行单轮 → <task-notification> 回到主线程 → 结束
```

一次性任务。类似 AG 的 `coding-basic`。

#### 2.2.2 Team Teammate（Actor 模式）

```
spawnTeammate() → runInProcessTeammate() → [循环: runAgent() → idle → 等待消息/任务 → 下一轮]
```

长驻 actor，等效于一个"持续在线的同事"。关键实现在 `inProcessRunner.ts`：

```
┌──────────────────────────────┐
│  runInProcessTeammate()      │
│  ┌────────────────────────┐  │
│  │ runAgent() 执行本轮    │  │
│  │ (维护 allMessages)     │  │
│  └────────────────────────┘  │
│           ↓                  │
│  idle_notification           │
│           ↓                  │
│  waitForNextPromptOrShutdown │
│  ├─ pendingUserMessages?     │
│  ├─ mailbox 消息?            │
│  ├─ 可 claim 任务?          │
│  └─ 继续轮询                │
│           ↓                  │
│  [回到 runAgent()]           │
└──────────────────────────────┘
```

**关键区别**：teammate 的 `allMessages` 跨轮次积累。当 token 超过 `autoCompactThreshold` 时自动压缩历史：

```typescript
// inProcessRunner.ts:1071-1104
if (tokenCount > getAutoCompactThreshold(model)) {
  const compactedSummary = await compactConversation(allMessages, ...);
  allMessages.length = 0;
  allMessages.push(...buildPostCompactMessages(compactedSummary));
}
```

### 2.3 AG 缺失的能力

AG 没有 Actor 模式。每次审查轮都是新子对话，author R2 无法利用 R1 的上下文积累。如果 AG 引入类似 CC 的长驻 worker，可以：
- review-loop 中 author 保留前一轮的完整推理链
- dev pilot 在遇到阻塞时保持上下文等待人工输入

---

## 3. 通信机制

### 3.1 AG：产物文件传递（单向、异步）

```
Stage A → 写产物到 specs/ 或 architecture/ → Runtime 复制到 Stage B 的 input/ → Stage B 读取
```

- **单向**：只能从上游流向下游
- **全文复制**：上游产物完整复制，不做摘要
- **无实时通信**：Agent 间无法互相发消息

### 3.2 CC：Mailbox + SendMessage（双向、实时）

CC 的通信走两条路：

**Mailbox 文件总线**（`teammateMailbox.ts`）：
```
writeToMailbox() → lockfile → 读 inbox JSON → append 消息 → 写回 → 解锁
```

承载的不只是文本消息，还有：
- `permission_request` / `permission_response` — 权限桥接
- `shutdown_request` / `shutdown_approved` — 优雅停机
- `plan_approval_request` — Plan 模式审批
- `idle_notification` — 状态脉冲
- `task_assignment` — 任务分配通知

**SendMessage 工具**：teammate 通过工具调用显式发送消息。Prompt 明确规定：

> "Just writing a response in text is not visible to others on your team — you MUST use the SendMessage tool."（`teammatePromptAddendum.ts`）

**Leader 侧消费**（`useInboxPoller.ts`）：
- 500ms 轮询读取未读消息
- 按消息类型分类处理
- 普通消息包装为 `<teammate-message>` XML 注入模型上下文
- 权限请求转发到 ToolUseConfirmQueue

### 3.3 差异与启示

| 维度 | AG | CC |
|:-----|:---|:---|
| 方向 | 单向（上游→下游） | 双向（peer-to-peer） |
| 实时性 | 无（阶段完成后才可见） | 有（500ms 轮询） |
| 通道复用 | 仅传递业务产物 | 消息 + 权限 + 控制信号 |
| 隔离性 | 完美隔离 | 共享命名空间（需要锁） |

CC 的 peer 通信在 fan-out 场景下非常有价值。例如：两个并行的 dev worker 发现修改了同一个文件 → 可以通过 mailbox 协调，而不是等 join 阶段才发现冲突。

---

## 4. 任务分配模型

### 4.1 AG：Push-only 静态分配

```
Template 定义 pipeline → Runtime 按顺序 dispatch → fan-out 时按 workPackagesPath 切片分配
```

每个分支在 dispatch 时就绑定了特定的 work package。分支完成后不能自动接手其他分支的工作。

### 4.2 CC：Push + Pull 混合

CC 有两种任务分配方式并存：

**Push（显式指派）**：
```
Leader/Model → TaskUpdate(owner: "worker-a") → worker-a mailbox 收到 task_assignment
```

**Pull（自动领取）**：
```
worker idle → waitForNextPromptOrShutdown() → findAvailableTask() → claimTask()
```

`claimTask()` 的实现（`tasks.ts`）：
- 检查 task 是否 pending
- 检查是否已有 owner
- 检查 blockedBy 是否有未完成依赖
- 原子更新 owner 和 status

这让 CC 的 worker pool 天然具有**负载均衡**能力：快 worker 多做，慢 worker 少做。

### 4.3 AG 可以学什么

在 fan-out 场景中引入 **弹性 Work Package 池**：

```
当前:  fan-out → 固定 N 个子 Project，各领 1 个 package
建议:  fan-out → 创建共享 package 池 + K 个 worker project
       worker 完成当前 package 后自动 claim 下一个
       所有 package 完成后触发 join
```

这要求修改 `fan-out-controller.ts` 的逻辑——从"按 index 创建固定子 Project"变为"维护 package 池 + 动态分配"。

---

## 5. 代码隔离——Git Worktree

这是 CC 的一个 AG 完全缺失的能力。

### 5.1 CC 的 Worktree 隔离

CC 的 `/batch` skill（`skills/bundled/batch.ts`）明确要求：

> "All agents must use `isolation: "worktree"` and `run_in_background: true`."

效果：
- 每个 worker 在独立的 git worktree 中工作
- 完全的文件系统隔离——worker A 的修改不会影响 worker B
- 每个 worker 可以创建独立的 branch 和 PR
- worktree 在 worker 结束后自动清理（`destroyWorktree()` in `teamHelpers.ts`）

### 5.2 AG 的隔离模型

AG 的所有 Agent 都在**同一个工作区**的同一个分支上工作。fan-out 的多个分支 worker 共享同一个文件系统。隔离依赖：
- `write-scope-plan.json` 声明允许修改的文件范围
- Scope Audit 事后审计越权

### 5.3 差异分析

| | AG | CC |
|--|---|---|
| 隔离层级 | 逻辑隔离（scope plan） | 物理隔离（git worktree） |
| 冲突风险 | 高—并行 worker 可能改同一文件 | 低—每个 worker 独立分支 |
| 清理机制 | 手动 | `git worktree remove --force` → fallback `rm -rf` |
| PR 工作流 | 不支持 | 每个 worker 可独立创建 PR |

AG 在高并发 fan-out 场景应考虑引入 worktree 隔离。

---

## 6. 安全与权限

### 6.1 AG 的安全体系

AG 的安全核心是 **事后审计 + 产物契约**：

- **Scope Audit**（`scope-governor.ts`）：自动比对实际修改文件 vs `write-scope-plan.json` 声明
- **Typed Contracts**（`contract-validator.ts`）：编译期检查上下游数据格式兼容性
- **Resource Quota**（`resource-policy-engine.ts`）：限制 runs/branches/iterations 数量

但 AG 没有**代码层工具约束**——Worker 能否执行某个操作完全依赖 Workflow prompt 的指令。

### 6.2 CC 的安全体系

CC 的安全核心是 **工具白名单 + 权限集中回 Leader**：

**代码层工具约束**：
```
constants/tools.ts 中定义多组工具集：
- ALL_AGENT_DISALLOWED_TOOLS    — 所有 agent 禁用
- ASYNC_AGENT_ALLOWED_TOOLS     — 异步 agent 可用
- COORDINATOR_MODE_ALLOWED_TOOLS — coordinator 有限工具集
- IN_PROCESS_TEAMMATE_ALLOWED_TOOLS — teammate 额外工具
```

Coordinator mode 只能用：`Agent`, `SendMessage`, `TaskStop`, `SyntheticOutput`——**无法直接读写文件或执行命令**。这从代码层确保了 coordinator 只做协调不做执行。

**权限桥接**：
```
Worker 触发危险操作 → permission_request 写入 mailbox 
→ Leader useInboxPoller() 读取 → 展示给用户确认 
→ permission_response 写回 worker mailbox → Worker 继续/放弃
```

实现中先注册 callback 再发送 request，防止 race condition。

### 6.3 互补分析

| 安全维度 | AG | CC | 互补方向 |
|:--------|:---|:---|:---------|
| 工具执行约束 | ❌ 仅 prompt | ✅ 代码层白名单 | AG 应引入 |
| 产物范围审计 | ✅ Scope Audit | ❌ 无 | CC 可借鉴 |
| 数据契约校验 | ✅ Typed Contracts | ❌ 无 | CC 可借鉴 |
| 成本控制 | ✅ Resource Quota | ❌ 无硬限制 | CC 可借鉴 |
| 权限批准模型 | ⚠️ autoApprove 开关 | ✅ 集中回 Leader | AG 可增强 |

---

## 7. Token 消耗深度对比

### 7.1 消耗结构差异

**AG 的消耗模型**：
```
每个 Stage × 每轮 = 完整 System Prompt + 代码库上下文 + 上游产物全文 + 工具调用 + 输出
```

**CC 的消耗模型**：
```
Leader: System Prompt (首次创建 cache) + 累积对话 (cache read 1/10 价)
Worker: 首次独立 SP + 后续 SendMessage 增量
Auto-compact: 超限时压缩历史为摘要
```

### 7.2 CC 的 4 套 Token 节约机制

#### 机制 1：Prompt Caching

CC 基于 Anthropic API，支持 `cache_read_input_tokens`（`cost-tracker.ts` 明确追踪）。Cache read 价格 = 首次注入的 **1/10**。

Leader 的 system prompt 在 team 生命周期内只付一次全价。AG 基于 Gemini（支持 Context Caching），但每个 Hidden Child Conversation 完全独立，**没有利用跨 stage cache**。

**量化**：假设 system prompt 5K tokens
- AG: 13 × 5K = 65K 全价
- CC: 5K 全价 + 12 × 0.5K (cache read) = 11K
- **差距: ~6×**

#### 机制 2：Worker Continue

CC 的 Coordinator Prompt 明确规定何时 continue vs spawn：

> "High overlap → continue. Low overlap → spawn fresh."（`coordinatorMode.ts:295-315`）

`SendMessage` 继续既有 worker 时，增量 token ≈ 新消息的几句话（~200 tokens）。AG 没有任何"继续上一个子对话"的能力。

**量化**：假设 research worker 已消耗 30K input
- AG (等效场景): 新会话重新消耗 30K
- CC (SendMessage continue): 增量 ~200 tokens
- **差距: ~150×**

#### 机制 3：Auto Compact

```typescript
// inProcessRunner.ts:1073-1076
const tokenCount = tokenCountWithEstimation(allMessages)
if (tokenCount > getAutoCompactThreshold(model)) {
  const compactedSummary = await compactConversation(allMessages, ...)
}
```

长驻 teammate 的 50K token 历史 → 压缩为 ~5K 摘要。AG 的 worker 不存在长驻循环，无法利用此机制。

#### 机制 4：轻量状态脉冲

CC 的 teammate 不返回完整 transcript，只发 idle notification（轻量 summary）。Leader 消耗极低。

AG 的 Governor 需要读取完整的 `implementation-summary.md`、`test-results.md` 等来理解结果。

### 7.3 量化对比

以中等复杂度功能（3 轮审查 + 开发交付）为基准：

| 消耗点 | AG 估算 | CC 估算 | 差距 |
|:------|:--------|:--------|:-----|
| System prompt × 会话数 | 5K × 13 = **65K** | 5K + 12×0.5K = **11K** | 6× |
| 上游产物读取（累计） | 15K × 8 下游 = **120K** | 15K×1 + 3×2K = **21K** | 5.7× |
| Review 循环上下文 | 6 × 25K = **150K** | 3 × 5K = **15K** | 10× |
| 代码库上下文重注入 | 20K × 13 = **260K** | 20K × 4 + cache = **30K** | 8.7× |
| 输出 tokens | 13 × 3K = **39K** | 5 × 3K = **15K** | 2.6× |
| **总计** | **~634K** | **~92K** | **~6.9×** |

> 注意：理论估算。实际差距取决于任务复杂度、代码库大小、审查轮数。CC 的 cache 命中依赖请求间隔（Anthropic cache TTL 5 分钟）。

### 7.4 AG 的 Token 优化路线图

| 优先级 | 优化项 | 预期收益 |
|:------|:------|:--------|
| **P0** | **单对话模式**（串行 role 复用 conversation） | **Token ~73% 节约** |
| **P0** | `resource-policy-types.ts` 增加 `tokens` / `costUSD` | 成本防线 |
| **P1** | review-loop 上下文继承 | Token 2-3× 节约 |
| **P1** | 产物摘要注入（替代全文） | 下游 40-60% 节约 |
| **P2** | Gemini Context Caching | SP 消耗降 ~6× |
| **P3** | Worker Continue 能力 | 特定场景 100×+ |

### 7.5 单对话模式——最高 ROI 的单点优化

**核心发现**：AG 的 `grpc.sendMessage()` 已经支持向已有 cascadeId 发送后续消息。这意味着 `executeReviewRound()` 中的串行 role 完全可以复用同一个 conversation，而不是每次 `createAndDispatchChild()` 新建子对话。

详细设计见 → [single-conversation-mode-design.md](single-conversation-mode-design.md)

**三种策略**：

| 模式 | 行为 | 节约率 | 适用场景 |
|:-----|:-----|:------|:---------|
| `shared` | 所有串行 role 共享一个 conversation | ~73% | Token 敏感场景 |
| `auto` | Author 跨轮复用，Reviewer 始终独立 | ~60% | 平衡质量与成本 |
| `isolated` | 每个 role 独立 conversation（当前默认） | 0% | 向后兼容 |

**为什么这是 P0**：一次改动（`executeReviewRound()` 约 50 行核心代码），立即获得 ~73% token 节约。不影响治理体系（Scope Audit、Contracts、Journal 全部不变）。底层 gRPC 已支持，无需协议层改动。

---

## 8. 并行编排

### 8.1 AG：声明式 Fan-out/Join

```json
{
  "stageType": "fan-out",
  "fanOutSource": {
    "workPackagesPath": "docs/work-packages.json",
    "perBranchTemplateId": "wp-dev-template",
    "maxConcurrency": 3
  }
}
```

优点：可预测、可 lint、可静态验证。
缺点：静态切片，无法动态调整并行度。

### 8.2 CC：Prompt 驱动并行 + Batch Skill

**Coordinator 级别**：
> "Launch independent workers concurrently whenever possible"（`coordinatorMode.ts`）

**Batch Skill**（`skills/bundled/batch.ts`）：
- 拆分为 5-30 个独立 work unit
- 每个 unit 在独立 git worktree 中运行（`isolation: "worktree"`）
- Worker 自动 commit + push + create PR
- Coordinator 实时追踪进度表格

### 8.3 差异总结

| | AG | CC |
|--|---|---|
| 并行定义 | 静态（Template JSON） | 动态（prompt + batch skill） |
| 并发控制 | `maxConcurrency` 硬限制 | 无硬限制 |
| 文件隔离 | 无（共享工作区） | Git worktree |
| Join 机制 | 声明式 `joinPolicy: 'all'` | Coordinator 手动追踪 |
| 数据契约 | ✅ | ❌ |

---

## 9. 状态管理与恢复

### 9.1 AG：层次化持久状态 + 6 种恢复动作

```
~/.gemini/antigravity/gateway/
├── agent_runs.json                   ← 全局 Run 注册
├── projects.json                     ← 全局 Project 注册
├── projects/{projectId}/
│   ├── checkpoints/                  ← Checkpoint 快照
│   └── journal.jsonl                 ← 执行日志

demolong/projects/{projectId}/runs/{runId}/
├── task-envelope.json, result-envelope.json
├── result.json, artifacts.manifest.json
└── [specs/ | architecture/ | delivery/ | review/]
```

恢复动作：`recover` / `nudge` / `restart_role` / `force-complete` / `cancel` / `skip`

### 9.2 CC：文件状态 + Transcript 恢复

```
~/.claude/
├── teams/{team}/config.json
├── tasks/{taskListId}/{taskId}.json
├── inbox/{team}/{agent}.json
└── transcripts/
```

恢复：从 transcript 首消息恢复 team context。无 checkpoint、无 journal、无精细化恢复。

### 9.3 AG 的明确优势

AG 的 `checkpoint-manager.ts` 和 `execution-journal.ts`：
- 自动 checkpoint（loop 迭代 + 关键节点）
- JSONL 格式审计日志
- 从任意 checkpoint 恢复
- 10 个上限 + 自动清理

CC 一旦 crash 只能从头开始。

---

## 10. 质量保障

### 10.1 AG：结构化审查引擎

`review-engine.ts` 实现完整审查循环：

```
Author 产出 → Reviewer 审查 → decision: approved/revise/rejected
  ↓ (revise)
Author 修改 → Reviewer 再审 → ... (最多 maxRounds 轮)
```

Reviewer 在 `review/result-round-{N}.json` 写入结构化 decision，机器可读。

### 10.2 CC：Prompt 级 Verification

Coordinator Prompt 要求最后做 verification：

> "Verification means proving the code works, not confirming it exists."

但这是 prompt 建议，不是代码强制。

### 10.3 差异

| | AG | CC |
|--|---|---|
| 审查强制性 | 代码强制 | Prompt 建议 |
| 审查结构化 | 机器可读 JSON | 自由文本 |
| 最大轮数控制 | `maxRounds` 硬限制 | 无 |
| Scope 验证 | 自动审计 | 无 |

---

## 11. 混合架构蓝图

### 11.1 设计原则

> 在 AG 的显式编排骨架上，选择性嫁接 CC 的协作原语。保留 AG 的治理优势，补强协作效率短板。

### 11.2 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    混合 Multi-Agent Runtime                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────── 治理层（AG 保留）──────────────┐                     │
│  │  Template/GraphPipeline → DAG Compiler     │                     │
│  │  Source Contract → Contract Validator       │                     │
│  │  Scope Governor → Scope Audit              │                     │
│  │  Resource Quota + Token Budget (新增)       │                     │
│  │  Review-loop Engine                         │                     │
│  │  Checkpoint Manager + Execution Journal     │                     │
│  └─────────────────────────────────────────────┘                     │
│                         ↓                                            │
│  ┌──────────── 运行时层（混合）────────────────┐                     │
│  │  DAG Runtime                                │                     │
│  │    ├─ Stage Dispatch                        │                     │
│  │    ├─ Fan-out Controller                    │                     │
│  │    │   ├─ 静态分配（保留）                  │                     │
│  │    │   └─ 弹性 Pool + claimTask()（新增）   │  ← CC Pull-based   │
│  │    └─ Join Controller                       │                     │
│  │  Worker Runtime                              │                     │
│  │    ├─ Hidden Child Conversation (保留)       │                     │
│  │    ├─ 持久 Worker 模式 (新增, 可选)          │  ← CC Actor        │
│  │    ├─ Git Worktree 隔离 (新增)              │  ← CC Worktree     │
│  │    └─ 工具白名单 (新增)                     │  ← CC Tool Guard   │
│  └─────────────────────────────────────────────┘                     │
│                         ↓                                            │
│  ┌──────────── 协作层（CC 嫁接）───────────────┐                     │
│  │  Mailbox 轻量消息通道 (新增)                │                     │
│  │    ├─ Peer-to-Peer Message                  │                     │
│  │    ├─ Permission Bridge                     │                     │
│  │    └─ Shutdown 双向握手                     │                     │
│  │  Heartbeat 状态脉冲 (新增)                  │                     │
│  │    ├─ 当前步骤 + 进度                       │                     │
│  │    └─ stale 检测增强                        │                     │
│  └─────────────────────────────────────────────┘                     │
│                         ↓                                            │
│  ┌──────────── Token 优化层（新增）────────────┐                     │
│  │  产物摘要注入（替代全文复制到 input/）       │                     │
│  │  Review-loop 上下文继承                     │                     │
│  │  跨 Stage Prompt Cache（Gemini API）        │                     │
│  │  Token Budget in Resource Policy            │                     │
│  └─────────────────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 11.3 分阶段实施

| 阶段 | 实施项 | 影响模块 | 风险 | 收益 |
|:-----|:------|:--------|:-----|:-----|
| **P0** | **单对话模式** | `group-runtime.ts` | 中 | **Token ~73%** |
| **P0** | Token Budget in Resource Quota | `resource-policy-*` | 低 | 成本防线 |
| **P0** | Worker Heartbeat | `group-runtime`, 新 `heartbeat` | 低 | 可观测性 |
| **P1** | Shutdown 双向握手 | `dag-runtime`, workflow | 低 | 避免半成品 |
| **P1** | 代码层工具白名单 | `group-types`, `group-runtime` | 中 | 安全升级 |
| **P2** | 产物摘要注入 | `digest-helpers` 扩展 | 中 | Token 40-60% |
| **P2** | Gemini Context Caching | `llm-oneshot`, 新 cache 管理 | 中 | SP ~6× |
| **P3** | Git Worktree 隔离 | `fan-out-controller`, 新 worktree | 高 | 并行安全 |
| **P3** | Pull-based 弹性 Claim | `fan-out-controller`, 新 claim | 高 | 吞吐量 |
| **P3** | Peer-to-Peer Mailbox | 新 `worker-mailbox` | 高 | 并行协调 |

---

## 12. AG 的独有优势——以及如何结合 CC 源码进一步放大

前面的分析可能让人觉得 AG 处处落后。**恰恰相反**——AG 拥有一整套 CC 完全没有的"硬约束-可审计-可重放"能力。以下逐一拆解 AG 的 7 大独有优势，并给出利用 CC 源码中的模式来**进一步放大**这些优势的具体方案。

### 12.1 Scope Audit — CC 零等效物

**AG 的现状**：

`scope-governor.ts` 提供两层防线：
1. **前置冲突检测** — `checkWriteScopeConflicts()`：fan-out 前检查多个 WP 的 writeScope 是否重叠
2. **后置越权审计** — `buildWriteScopeAudit()`：每个 delivery 完成后对比 `allowed vs actual` 修改文件

这在 CC 中**完全不存在**。CC 的 worker 可以自由修改任何文件，coordinator 无法感知越权。

**如何放大 — 借鉴 CC 的 Hook 系统**：

CC 的 `types/hooks.ts` 定义了一套 **PreToolUse / PostToolUse** Hook 机制：
```typescript
// CC hooks.ts — 在工具执行前/后拦截
hookSpecificOutput: z.object({
  hookEventName: z.literal('PreToolUse'),
  permissionDecision: permissionBehaviorSchema().optional(),  // approve/block
  updatedInput: z.record(z.string(), z.unknown()).optional(), // 可修改输入
})
```

AG 可以借鉴此模式将 Scope Audit 从**事后审计**升级为**事前拦截**：

```
                现状                              放大后
  Agent 完成 → buildWriteScopeAudit()    Agent writeFile() → PreWrite Hook
  发现越权 → 标记 warning                → checkScope() → 超范围 → block
  Governor 事后处理                       → Agent 被迫修正
```

**具体实施**：在 `group-runtime.ts` 的 watch-conversation 环节，解析 Agent 的工具调用输出，当检测到文件写入时，实时校验 `allowedWriteScope`。超范围写入直接注入 `system message` 警告——不需要等到 delivery 才发现。

**预期效果**：将 Scope 违规发现时间从 "交付后" 提前到 "发生时"，省去 1-2 轮修正循环。

---

### 12.2 Typed Contracts — 编译期阻止坏数据流转

**AG 的现状**：

`contract-validator.ts` 实现了 5 条校验规则：
1. **Output → Input 兼容性** — 每条 edge 的上下游 artifact 格式匹配
2. **Fan-out Contract** — 分支数据契约对齐
3. **Join Merge Contract** — 合并数据格式兼容
4. **Artifact 路径冲突 + ID 唯一性** — 防止产物互相覆盖
5. **stageType ↔ contract 一致性** — 类型系统自洽

CC 完全依赖 prompt 来"希望"worker 产出正确格式的数据。没有编译期校验，没有运行时契约检查。

**如何放大 — 借鉴 CC 的 Schema Validation Pattern**：

CC 的 SDK 系统（`entrypoints/sdk/coreSchemas.ts`）大量使用 Zod schema 来强制校验消息格式：
```typescript
// CC 对每种消息类型都有严格 schema
const SDKTaskProgressMessageSchema = z.object({
  subtype: z.literal('task_progress'),
  task_id: z.string(),
  ...
})
```

AG 可以借鉴这个模式，将 Typed Contracts 从**静态 lint** 升级为**运行时 artifact 校验**：

```
                现状                              放大后
  Template lint → 检查契约定义         Template lint → 检查契约定义 (保留)
  运行时 → 不检查产物实际格式          运行时 → Agent 产出 → Zod schema validate
                                       → 不匹配 → 自动注入修正指令
```

在 `group-runtime.ts` 的 `finalizeDeliveryRun()` 中增加：runtime 拿到 `result.json` 后，用 contract 定义的 JsonSchema 做一次 Zod 校验。不匹配 → 自动触发 revise 轮，而不是让下游 stage 拿到坏数据。

---

### 12.3 显式 DAG + GraphPipeline — CC 根本无法"lint 一个 prompt"

**AG 的现状**：

AG 的流程是**可序列化、可版本化、可 lint**的数据结构：
```
Template JSON → dag-compiler.ts → DagIR → dag-runtime.ts 执行
             → contract-validator.ts lint
             → pipeline-graph.ts 进行拓扑验证
```

CC 的 "流程" 完全在 coordinator 的 system prompt 里。你无法 lint 一个自然语言的协调策略。

**如何放大 — 借鉴 CC 的 Skill System 做 Template Marketplace**：

CC 的 Skill 系统（`skills/loadSkillsDir.ts`）是一套"可复用的知识包"，带 frontmatter 元数据：
```typescript
// CC Skill = markdown + frontmatter
{
  displayName, description, allowedTools,
  argumentHint, argumentNames, whenToUse,
  version, model, disableModelInvocation
}
```

AG 的 Template/GraphPipeline 天生就是这个概念的**强类型版本**。放大方向：

1. **Template 市场** — 为 Template JSON 增加 Skill 风格的元数据（`whenToUse`、`argumentHint`、`version`），让 AI 可以**自动选择最匹配的 Template**
2. **Template 组合** — AG 已有 `subgraph-types.ts`（可复用子图 + I/O Ports + 编译时展开）。这是 CC Skill 系统根本做不到的——CC 的 Skill 不能嵌套组合
3. **Template 推荐引擎** — 基于 AG 的 `generation-context.ts`（收集 workspace 上下文 + group 摘要），自动推荐或生成最佳 Template

**竞争壁垒**：CC 的 Skill 只是 markdown + prompt，不可组合、不可验证。AG 的 Template 是强类型 DAG + Subgraph Port + Contract，**可以像函数一样组合调用**。

---

### 12.4 Checkpoint / Journal — CC 的致命弱点

**AG 的现状**：

- `checkpoint-manager.ts`：自动 snapshot pipeline state，最多 10 个/project，FIFO 淘汰
- `execution-journal.ts`：JSONL 日志记录 10 种事件类型（node:activated, condition:evaluated, gate:decided, loop:iteration 等）
- 支持**从任意 checkpoint 恢复**到历史状态

CC 的弱点：一旦 crash → 只有 transcript 恢复 → 所有 teammate 状态丢失 → 从头开始。

**如何放大 — 借鉴 CC 的 Compact Boundary**：

CC 的 compaction 系统有一个巧妙设计——`SDKCompactBoundaryMessage`：
```typescript
const SDKCompactBoundaryMessageSchema = z.object({
  subtype: z.literal('compact_boundary'),
  compact_metadata: z.object({
    // 标记哪些消息被 compact 了，哪些保留
    // resume 时可以从 boundary 恢复
  })
})
```

AG 可以结合这个思路增强 Checkpoint：

```
当前 Checkpoint: pipeline state 快照 → 恢复后 Agent 重新执行整个 stage
增强 Checkpoint: pipeline state + Agent partial transcript boundary
               → 恢复后 Agent 从上一次 compact boundary 继续
               → 不需要完全重头执行
```

这让 AG 的"恢复"从 **stage 级粒度** 细化到 **Agent 对话中间断点**。

---

### 12.5 AI 流程生成 + 风险评估 — CC 没有等效物

**AG 的现状**：

`pipeline-generator.ts` + `risk-assessor.ts` + `generation-context.ts` 组成一套完整的 **AI 辅助流程设计系统**：

1. 用户描述目标 → LLM 生成 GraphPipeline → 自动验证 DAG + Contracts
2. `assessGenerationRisks()` 评估 5 个维度的风险：complexity / cost / reliability / security / availability
3. `hasCriticalRisk()` 阻止高风险 Pipeline 被保存
4. 所有 draft 必须人工 confirm 才能持久化

CC 完全没有这个能力——CC 依赖人工写 prompt 来协调 worker。

**如何放大 — 借鉴 CC 的 MagicDocs 自动文档更新**：

CC 的 `services/MagicDocs/prompts.ts` 实现了一套"后台自动更新文档"的模式：
```
对话结束后 → 提取新知识 → 更新 Magic Doc → 保持文档"活"着
```

AG 可以将此模式应用到 Template 进化：

```
Project 完成后 → 分析 execution-journal.jsonl
→ 发现模式：某些 stage 总是被 skip / 某些 loop 总是 3 轮才通过
→ 自动生成 Template 优化建议
→ 或直接产出改进版 Template draft
```

**"自进化的 Template"** 是 CC 不可能做到的——因为 CC 没有结构化的执行日志来学习。AG 的 journal.jsonl 天然支持这种分析。

---

### 12.6 Resource Quota — CC 的成本失控风险

**AG 的现状**：

`resource-policy-engine.ts` 执行策略检查，支持 5 种资源维度 × 3 种动作（warn/block/pause）：
- runs, branches, iterations, stages, concurrent-runs

CC **没有任何成本硬限制**。cost-tracker.ts 只做记账，不做拦截。Token 消耗越过阈值时只做 auto-compact（压缩），不做停止。

**如何放大 — 增加 Token 维度 + 借鉴 CC 的 Hook 拦截**：

```typescript
// 当前 resource-policy-types.ts 只有：
resource: 'runs' | 'branches' | 'iterations' | 'stages' | 'concurrent-runs'

// 放大后：
resource: 'runs' | 'branches' | 'iterations' | 'stages' | 'concurrent-runs'
        | 'tokens' | 'costUSD' | 'wallclock-minutes'
```

结合 CC 的 PreToolUse Hook 模式：在每次 LLM 调用前，检查 token 消耗是否超限 → 超限时暂停 stage 并通知用户。

这让 AG 成为**唯一一个能在 Multi-Agent 场景下做成本硬控的平台**。

---

### 12.7 Review Engine — 结构化对抗审查

**AG 的现状**：

`review-engine.ts` 实现了规则引擎式的审查：
```typescript
static evaluate(state: AgentRunState, policy: ReviewPolicyAsset): 'approved' | 'revise' | 'rejected' | 'revise-exhausted'
```

支持多种条件（eq, neq, lt, gt, contains），可以根据 round 数、artifact 格式、任意嵌套字段做决策。

CC 的 "verification" 只是 prompt 建议——"Prove the code works, don't just confirm it exists"。没有强制执行。

**如何放大 — 借鉴 CC 的双层 QA + Fresh Eyes**：

CC 的 coordinator prompt 定义了一个精妙的双层 QA 模式：
> "Workers self-verify before reporting done. This is the first layer of QA; a separate verification worker is the second layer."
> "Verifying code a different worker just wrote → Spawn fresh — Verifier should see the code with fresh eyes, not carry implementation assumptions"

AG 可以将此编码到 Review Policy 中：

```json
{
  "rules": [
    {
      "conditions": [{ "field": "reviewerContextOverlap", "operator": "gt", "value": 0.5 }],
      "outcome": "spawn-fresh-reviewer"
    }
  ]
}
```

即：如果 reviewer 和 author 在同一个 conversation 中有高度上下文重叠 → 强制使用全新的 reviewer 子对话（fresh eyes）。这把 CC prompt 里的"建议"变成了 AG 的"规则强制执行"。

---

## 13. AG 优势放大路线图总览

| 优先级 | AG 优势 | 放大方向 | 借鉴 CC 模式 | 预期效果 |
|:------|:--------|:---------|:------------|:---------|
| **P0** | Resource Quota | + tokens/costUSD 维度 | Hook 拦截 | 唯一能硬控成本的平台 |
| **P0** | Scope Audit | 事后审计 → 实时拦截 | PreToolUse Hook | 越权发现提前 1-2 轮 |
| **P1** | Typed Contracts | + 运行时 artifact 校验 | Zod Schema | 坏数据不流入下游 |
| **P1** | Review Engine | + fresh eyes 强制规则 | CC 双层 QA | 审查质量提升 |
| **P1** | Template/DAG | + Skill 元数据 + 推荐 | CC Skill System | Template 可发现性 |
| **P2** | Checkpoint/Journal | + compact boundary | CC Compact Boundary | 细粒度恢复 |
| **P2** | Pipeline Generator | + 自进化 Template | CC MagicDocs | 执行经验 → Template 优化 |
| **P3** | Subgraph | + Template Marketplace | CC Skill Marketplace | 复用生态 |

---

## 14. 总结

### 两个系统的定位

| | AG | CC |
|--|---|---|
| **适合** | 可重复工程交付、审计追踪场景 | 开放式探索、一次性复杂任务 |
| **优势** | 可预测性、安全性、可恢复性 | 灵活性、Token 效率、适应性 |
| **代价** | Token ~6.9×、缺 peer 通信 | 无静态验证、无 scope audit |

### AG 不可替代的 7 大优势

| # | 优势 | CC 有吗 | AG 独占原因 |
|:--|:-----|:--------|:-----------|
| 1 | **Scope Audit** | ❌ | CC 的 worker 可以改任何文件，无越权检测 |
| 2 | **Typed Contracts** | ❌ | CC 完全依赖 prompt 保证数据格式 |
| 3 | **显式 DAG + Lint** | ❌ | 你无法 lint 一个自然语言 prompt |
| 4 | **Checkpoint + Journal** | ❌ | CC crash 后只能从头开始 |
| 5 | **Resource Quota** | ❌ | CC 的 cost-tracker 只记账不拦截 |
| 6 | **AI 流程生成 + 风险评估** | ❌ | CC 没有结构化流程可以生成 |
| 7 | **可复用 Subgraph** | ❌ | CC 的 Skill 不可组合 |

### 双向借鉴策略

> **从 CC 学效率，从 AG 学治理** → **然后用 CC 的模式放大 AG 的治理优势**

1. **从 CC 借入**（弥补短板）：Token 优化、peer 通信、弹性 claim、worktree 隔离
2. **用 CC 模式放大 AG 优势**（拉大差距）：
   - Hook 系统 → 增强 Scope Audit 实时性
   - Zod Schema → 增强 Contract 运行时校验
   - MagicDocs → 驱动 Template 自进化
   - Compact Boundary → 增强 Checkpoint 粒度
   - Skill 元数据 → 增强 Template 可发现性
   - 双层 QA → 增强 Review Engine

### 最终结论

> AG 的独有优势不是"我们也有 CC 没有的东西"这种对等叙事。**AG 拥有的是一整套 CC 在架构层根本不可能后补的能力**——你无法为一个 prompt-driven 系统补上"编译期 Contract 校验"，你无法为一个没有 Journal 的系统补上"自进化 Template"。这些不是功能缺失，而是**架构选择的结果**。
>
> 真正的策略是：**用 CC 的效率原语弥补 AG 的短板；同时用 CC 的 Hook/Schema/MagicDocs 模式放大 AG 的治理壁垒，让这些独有优势产生 10× 的效果而不是 1×。**
