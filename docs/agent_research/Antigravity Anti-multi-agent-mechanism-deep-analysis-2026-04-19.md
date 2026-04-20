# Antigravity Multi-Agent 机制深度分析

**日期**: 2026-04-19
**范围**: 基于源码级完整阅读的 Multi-Agent 系统机制分析

---

## 一、Multi-Agent 机制总览

### 1.1 架构模型：显式 DAG 编排 + 中央治理

AG 的 Multi-Agent 不是"多个 AI 自由协作"，而是一个 **项目治理框架**，核心假设是：

> 软件交付有明确的阶段划分（需求 → 架构 → 开发），依赖关系、审查规则、产物契约可以也应该被预先定义。

### 1.2 系统分层

```
┌─────────────────────────────────────────────────────┐
│ CEO Agent (ceo-agent.ts)                            │  ← 顶层入口
│  自然语言 → LLM 解析 → 创建 Project / Job           │
├─────────────────────────────────────────────────────┤
│ Dispatch Service (dispatch-service.ts)               │  ← 统一派发
│  解析 Template → 校验 Contract → dispatchRun()       │
├─────────────────────────────────────────────────────┤
│ Group Runtime (group-runtime.ts, ~2400行)            │  ← 核心引擎
│  ├─ dispatchRun() → 路由 executionMode               │
│  ├─ executeSerialEnvelopeRun() → review-loop/delivery│
│  ├─ executeReviewRound() → Author/Reviewer 串行      │
│  └─ executeRoleViaAgentSession() → 创建子会话执行    │
├─────────────────────────────────────────────────────┤
│ Fan-Out Controller (fan-out-controller.ts)           │  ← 并行分支
│  ├─ tryFanOut() → 读取 work packages → 分支创建     │
│  ├─ tryJoin() → 等待所有分支完成 → 汇聚             │
│  └─ tryDispatchNextQueuedBranch() → 并发控制         │
├─────────────────────────────────────────────────────┤
│ DAG Pipeline (pipeline/)                             │  ← 流程引擎
│  ├─ dag-compiler.ts → Template → DAG IR              │
│  ├─ dag-runtime.ts → 拓扑推进                       │
│  └─ graph-compiler.ts → GraphPipeline 编译           │
├─────────────────────────────────────────────────────┤
│ 治理层                                               │  ← 约束与审计
│  ├─ contract-validator.ts → 编译期数据契约校验        │
│  ├─ scope-governor.ts → WriteScope 冲突检测          │
│  ├─ review-engine.ts → 结构化审查决策引擎            │
│  ├─ resource-policy-engine.ts → 资源配额策略         │
│  ├─ checkpoint-manager.ts → 状态快照与恢复           │
│  └─ execution-journal.ts → JSONL 执行审计日志        │
└─────────────────────────────────────────────────────┘
```

### 1.3 Agent 生命周期

每个 Agent（Role）的生命周期是 **一次性隔离子对话**：

```
dispatchRun() 
  → 创建 AgentRunState (run-registry)
  → executeRoleViaAgentSession()
    → backend.start(backendConfig) → 创建 AgentSession
    → registerAgentSession()
    → consumeAgentSession() → 监听 onCompleted/onFailed/onCancelled
  → Agent 在子会话中执行 workflow
  → 写 result.json / delivery-packet.json
  → 子会话结束 → 进入下一个 Role 或 Stage
```

**关键特征**：每个 Role 在每轮审查中都是 **全新的、完全独立的子对话**。上下文从零开始，通过读取 `input/` 目录获取上游产物。

---

## 二、并行与串行处理

### 2.1 串行机制：Review Loop

Review Loop 是 AG 最核心的串行编排模式（`executeReviewLoop()`）：

```
Round 1:
  Author (roles[0]) → 执行 workflow → 写产物到 specs/
  Reviewer (roles[last]) → 读 specs/ → 审查 → DECISION: APPROVED/REVISE/REJECTED

Round 2 (if REVISE):
  Author → 读上一轮 review → 修改产物
  Reviewer → 再审
  ... 最多 maxRounds 轮
```

**串行保证机制**：
- `executeReviewRound()` 内部 `for (let i = startRoleIndex; i < group.roles.length; i++)` 严格顺序执行
- 每个 Role 通过 `await executeRoleViaAgentSession()` 同步等待完成
- 下一个 Role 只有在前一个完成后才会启动

**V5.5 共享对话模式优化**：
- 当 `AG_SHARED_CONVERSATION=true` 时，Author 跨轮复用同一个 cascade
- Reviewer 始终独立（"fresh eyes"原则）
- 安全阀：当 `estimatedTokens > SHARED_CONVERSATION_TOKEN_RESET (100K)` 时自动退回隔离模式

### 2.2 并行机制：Fan-Out / Join

Fan-Out 是声明式并行，由 `fan-out-controller.ts` 实现：

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

**并行执行流程**：

```
Stage A 完成 → emitProjectEvent('stage:completed')
  → handleProjectEvent() → tryFanOut()
    → readWorkPackages() → 读取 JSON 文件获取工作包列表
    → 对每个 workPackage:
       ├─ index < maxConcurrency → 立即 dispatch
       │   → createProject() → dispatchInitialProjectStage()
       │   → updateBranchProgress(status: 'running')
       └─ index >= maxConcurrency → 排队
           → updateBranchProgress(status: 'queued')

Branch 完成 → emitProjectEvent('branch:completed')
  → tryDispatchNextQueuedBranch() → 检查 slots → dispatch 下一个
  → tryJoin() → 所有分支完成? → 标记 fan-out stage completed
    → 写 fan-out-summary.json
    → 触发下游 stage
```

**并发控制**：
- `maxConcurrency` 硬限制并行分支数（`fan-out-controller.ts:221-222`）
- 支持运行时覆盖：`project.pipelineState.templateOverrides.maxConcurrency`
- `maxConcurrency <= 0` 或未设置 = 无限制

**关键限制**：
- **静态切片**：工作包在 dispatch 时就确定，不支持动态调整
- **无负载均衡**：快分支不能接手慢分支的工作
- **共享文件系统**：所有分支共享同一个工作区，无 git worktree 隔离

### 2.3 DAG 级别的并行与串行

DAG Runtime (`dag-runtime.ts`) 控制 Stage 级别的推进：

```
Stage 完成 → getDownstreamNodes(ir, completedStageId)
  → 对每个下游 node:
     → canActivateNode() → 检查所有上游是否完成
     → 满足条件 → dispatchRun()
```

- **串行**：节点有单一上游依赖 → 严格顺序执行
- **并行**：节点有多个独立分支 → 自动并行激活
- 由 DAG 拓扑自然决定，不需要显式标注

---

## 三、Agent 约束分析：强约束 vs 弱约束

### 3.1 强约束（代码层硬性保证）

| 约束 | 实现模块 | 机制 |
|:-----|:---------|:-----|
| **Source Contract** | `contract-validator.ts` | 编译期校验上下游 artifact 格式兼容性（5条规则）|
| **Resource Quota** | `resource-policy-engine.ts` | Pre-dispatch 检查资源消耗，超限 block/pause |
| **Token Quota** | `token-quota.ts` | dispatch 前检查 workspace token 配额 |
| **Review Policy** | `review-engine.ts` | 规则引擎强制 maxRounds/decision 覆盖 |
| **Timeout** | `group-runtime.ts` | 每个 Role 有 `timeoutMs`，超时自动 cancel |
| **Execution Mode 路由** | `group-runtime.ts` | `orchestration` 类型节点禁止直接 dispatch |
| **Checkpoint 上限** | `checkpoint-manager.ts` | 每项目最多 10 个，FIFO 淘汰 |
| **Intervention 锁** | `group-runtime.ts` | `activeInterventions` Set 防止并发干预同一 run |

### 3.2 弱约束（Prompt 层建议性约束）

| 约束 | 实现方式 | 可靠性 |
|:-----|:---------|:------|
| **Workflow 指令** | 注入 system prompt | LLM 可能不遵守 |
| **WriteScope Plan** | `write-scope-plan.json` 声明允许修改的文件 | 事后审计，不实时拦截 |
| **输出格式** | Prompt 要求写 `result.json` / `delivery-packet.json` | LLM 可能遗漏 |
| **DECISION 标记** | Prompt 要求 reviewer 输出 `DECISION: APPROVED/REVISE/REJECTED` | 有 fallback 提取逻辑 |
| **Input Read 协议** | 要求 Agent 先读 task-envelope 再读 input artifacts | 有审计但不拦截 |

### 3.3 约束边界分析

**强约束覆盖的是**：
- "能不能做"（资源配额、token 限制）
- "做的顺序对不对"（DAG 拓扑、Source Contract）
- "做多久"（Timeout）
- "做几轮"（maxRounds）

**弱约束覆盖的是**：
- "做的内容对不对"（完全依赖 LLM 遵守 prompt）
- "改的文件对不对"（事后审计 Scope Audit）
- "输出格式对不对"（有 fallback 但不保证）

**系统级缺失**：
- 无代码层工具白名单（Agent 能执行任何工具调用）
- 无实时文件写入拦截（不像 Claude Code 的 PreToolUse Hook）
- WriteScope 冲突只在 fan-out 前静态检测，不在运行时实时拦截

---

## 四、过程检视与结果控制机制

### 4.1 实时监控：Supervisor Loop

`supervisor.ts` 实现 AI 驱动的实时监控：

```
Agent 开始执行
  → startSupervisorLoop(runId, cascadeId, goal, ...)
    → 创建独立 supervisor 对话（hidden, turbo mode）
    → 每 3 分钟 review 一次：
       1. 拉取最近 8 个 steps
       2. 对比上轮 stepCount/lastStepType
       3. 构建 review prompt → 发给 supervisor conversation
       4. 解析 JSON 响应：{status: HEALTHY|STUCK|LOOPING|DONE}
       5. 连续 3 次 STUCK → suggestAction: cancel
    → 最多 10 轮 review
    → 写 supervisorSummary
```

### 4.2 心跳检测：Watch Conversation

`watch-conversation.ts` 提供非 AI 的实时脉冲监控：

- **gRPC Stream**：实时接收步骤更新
- **Heartbeat Poll**：每 30s 轮询步骤（stream 可能静默）
- **Stale Detection**：3 分钟无新步骤 → `staleSince` 标记
- **Error Detection**：扫描最后步骤的 `CORTEX_STEP_STATUS_ERROR/CANCELED`

### 4.3 审查引擎：Review Engine

`review-engine.ts` 是结构化的规则引擎：

```typescript
ReviewEngine.evaluate(state, policy)
  → 遍历 policy.rules
  → 每条 rule 有 conditions: [{field, operator, value}]
  → 支持 eq/neq/lt/gt/contains
  → 全部条件满足 → 返回 rule.outcome
  → 无匹配 → 返回 fallbackDecision
```

**可配置的审查策略示例**：
- `round_count > 3` → `revise-exhausted`（强制终止循环）
- `artifact.format contains 'json'` → `approved`（格式校验）

### 4.4 执行日志：Execution Journal

`execution-journal.ts` 记录 10 种事件类型到 JSONL：

```
node:activated / node:completed / node:failed
condition:evaluated / gate:decided / switch:routed
loop:iteration / loop:terminated
checkpoint:created / checkpoint:restored
```

### 4.5 检视控制的完整链路

```
┌────────────────────────────────────────────────────────┐
│                    检视层级                              │
├────────────────────────────────────────────────────────┤
│                                                         │
│  Level 1: 实时心跳 (watch-conversation.ts)              │
│    30s 轮询 → stepCount/staleSince/errorSteps           │
│    作用：快速发现"Agent 死了"或"Agent 卡了"              │
│                                                         │
│  Level 2: AI Supervisor (supervisor.ts)                 │
│    3min 间隔 → 分析 8 个最近步骤 → HEALTHY/STUCK/LOOPING │
│    作用：判断"Agent 在做有效工作还是空转"                │
│                                                         │
│  Level 3: Review Engine (review-engine.ts)              │
│    每轮结束 → 规则评估 → approved/revise/rejected        │
│    作用：结构化判断"产物质量是否达标"                    │
│                                                         │
│  Level 4: Scope Audit (scope-governor.ts)               │
│    交付后 → 对比 allowed vs actual 文件修改              │
│    作用：事后发现"Agent 越权改了不该改的文件"            │
│                                                         │
│  Level 5: Execution Journal (execution-journal.ts)      │
│    全程 → 记录所有控制流决策                             │
│    作用：事后审计和流程优化                               │
│                                                         │
│  Level 6: Checkpoint (checkpoint-manager.ts)            │
│    关键节点 → 快照 pipeline state                        │
│    作用：出错时可回滚到上一个好的状态                    │
│                                                         │
│  Level 7: Intervention (group-runtime.ts)               │
│    人工/自动 → nudge/restart_role/evaluate/cancel        │
│    作用：卡住时的主动干预手段                            │
│                                                         │
└────────────────────────────────────────────────────────┘
```

### 4.6 结果控制闭环

```
Agent 执行完成
  → normalizeRoleSessionResult() → 标准化结果
  → enforceCanonicalInputReadProtocol() → 检查是否读了上游产物
  → buildRoleInputReadAudit() → 生成 input-read 审计报告
  → isReviewer?
     ├─ Yes → extractReviewDecision() → 从 result.json/steps 提取 DECISION
     │        → ReviewEngine.evaluate() → 规则引擎可覆盖 LLM 决策
     │        → approved → finalizeAdvisoryRun() → 写 result-envelope
     │        → revise → round++ → 回到 Author
     │        → rejected/exhausted → 标记 blocked
     └─ No  → delivery? → finalizeDeliveryRun() → 检查 delivery-packet.json
              → tryAutoTriggerNextStage() → 推进 pipeline 下一阶段
```

---

## 五、系统设计的优点与缺点

### 5.1 优点

#### ✅ 1. 完整的治理体系（行业独有）

AG 拥有一整套在 prompt-driven 系统中 **根本不可能后补** 的能力：
- Typed Contracts（编译期数据校验）
- Scope Audit（越权检测）
- Execution Journal（审计日志）
- Checkpoint/Restore（状态恢复）
- Resource Quota（成本硬控）

这不是功能缺失，是 **架构选择的结果**。Claude Code 等 prompt-driven 系统无法补上编译期 Contract 校验。

#### ✅ 2. 可预测性极强

- Template JSON 定义流程 → 可 lint、可版本化、可 diff
- DAG 编译 → 拓扑排序保证执行顺序
- Source Contract → 编译期发现数据不兼容
- 同一 Template + 同一输入 → 高度相似的执行路径

#### ✅ 3. 故障恢复能力

6 种恢复动作：`recover` / `nudge` / `restart_role` / `force-complete` / `cancel` / `skip`
- Checkpoint 支持从任意快照恢复
- Intervention 机制支持不中断 pipeline 的情况下修复单个 Role
- 崩溃不传染：一个子对话失败不影响其他

#### ✅ 4. 多层检视体系

从 30s 心跳到 3min AI Supervisor 到审查引擎到事后 Scope Audit，形成完整的检视纵深。

#### ✅ 5. AI 流程自生成 + 风险评估

`pipeline-generator.ts` + `risk-assessor.ts` 组成 AI 辅助流程设计系统，这在其他系统中完全不存在。

### 5.2 缺点

#### ❌ 1. Token 消耗高（~6.9× vs Claude Code）

每个 Role 每轮都是全新子对话 → 重复注入：
- System prompt（~5K tokens × 13 次 = 65K）
- 代码库上下文（~20K tokens × 13 次 = 260K）
- 上游产物全文复制

V5.5 共享对话模式（`AG_SHARED_CONVERSATION`）部分缓解，但仍是 feature flag 级别。

#### ❌ 2. 无 Agent 间实时通信

- 通信仅通过文件产物传递（单向、异步）
- 无 peer-to-peer 消息机制
- 并行分支无法实时协调（两个 dev worker 改同一文件 → 等 join 才发现冲突）

#### ❌ 3. 无物理文件隔离

- Fan-out 的所有分支共享同一个工作区的同一个分支
- 隔离依赖 WriteScope 声明 + 事后审计
- 无 git worktree 隔离 → 并行修改同文件风险高

#### ❌ 4. 无代码层工具约束

- Agent 能执行任何工具调用（读写任何文件、执行任何命令）
- 完全依赖 Prompt 指令约束行为
- 不像 Claude Code 有 `ALL_AGENT_DISALLOWED_TOOLS` 等白名单机制

#### ❌ 5. 静态任务分配

- Fan-out 时工作包在 dispatch 时就绑定
- 分支完成后不能自动接手其他分支的工作
- 无 pull-based 弹性 claim 机制 → 无法负载均衡

#### ❌ 6. Scope Audit 是事后的

- `checkWriteScopeConflicts()` 只在 fan-out 前静态检测
- `buildWriteScopeAudit()` 在 delivery 完成后才执行
- 越权修改在发生时不被拦截，需等到事后才发现

#### ❌ 7. 无长驻 Actor 模式

- 每个 Role 每轮都是全新子对话
- Author R2 无法利用 R1 的推理链和上下文积累
- 不支持 Worker 在任务间保持状态等待新消息

### 5.3 优缺点权衡总结

| 维度 | AG 得分 | 说明 |
|:-----|:--------|:-----|
| **可预测性** | ★★★★★ | Template DAG + Contract = 强确定性 |
| **安全审计** | ★★★★☆ | 有 Scope/Contract/Journal，但缺实时拦截 |
| **故障恢复** | ★★★★★ | Checkpoint + Journal + 6种恢复动作 |
| **Token 效率** | ★★☆☆☆ | 每 Role 全新子对话，重复注入严重 |
| **并行能力** | ★★★☆☆ | 有 fan-out/join，但缺隔离和动态调度 |
| **通信能力** | ★★☆☆☆ | 仅单向文件传递，无实时通信 |
| **灵活性** | ★★★☆☆ | Template 强约束 = 可预测但不灵活 |
| **可观测性** | ★★★★★ | Supervisor + Watch + Journal + Audit 四层 |
| **成本控制** | ★★★★☆ | Resource Quota + Token Quota，但缺 token 维度 |

---

## 结论

AG 的 Multi-Agent 系统是一个 **"治理优先"的项目编排框架**。它在可预测性、可审计性、可恢复性方面处于行业领先，但在 Token 效率、Agent 间通信、文件隔离方面存在明显短板。

核心设计取舍：**用更高的 Token 成本和更低的灵活性，换取了更强的治理保障和可预测性**。这在需要审计追踪的可重复工程交付场景（如企业级软件开发 pipeline）是正确的选择，但在一次性探索型任务中会显得过重。
