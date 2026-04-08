# AgentBackend 统一抽象详细技术设计

日期：2026-04-08  
状态：Draft / 详细设计已入库  
关联文档：

1. `docs/design/rfc-agent-backend-abstraction.md`
2. `docs/design/prompt-executor-minimal-contract.md`
3. `docs/design/execution-target-architecture.md`

范围：

1. `TaskExecutor` 到 `AgentBackend` 的演进
2. `group-runtime` 与 `prompt-executor` 的 runtime 责任拆分
3. 统一事件流、取消、完成收口、Memory 生命周期钩子

---

## 一页结论

当前系统已经有两层“看起来像抽象、但其实语义还没对齐”的结构：

1. `providers/TaskExecutor`
2. `agent-runs` 的 `executionTarget`

第二层已经开始稳定，第一层还不够。

更准确地说：

1. `executionTarget` / `executorKind` / `triggerContext` 已经把“业务上要执行什么”建模出来了。
2. 但 `TaskExecutor` 还只统一了“怎么启动一次 provider 调用”，没有统一“这次运行如何持续上报、如何结束、如何取消、如何写回 Run”。
3. 因此，真正的 runtime 生命周期今天仍然分散在：
   - `src/lib/agents/group-runtime.ts`
   - `src/lib/agents/prompt-executor.ts`
   - `src/lib/agents/watch-conversation.ts`
4. 如果继续按当前方向给新 provider 加能力，复杂度不会落在 provider 文件本身，而会继续落在 runtime 分支和状态回写上。

所以本设计的核心决策不是“再造一个更大的 provider 抽象”，而是：

> 在 template orchestration 之下，抽出一层只负责“单次 backend session 生命周期”的 `AgentBackend`。

这里的关键边界必须写死：

1. `AgentBackend` 不是新的编排器。
2. `AgentBackend` 只负责一次 agent session 的启动、事件流、取消、追加消息和终态结果。
3. `group-runtime` 继续负责 template/stage/review-loop/source contract/pipeline 推进。
4. `prompt-executor` 继续负责 Prompt Mode 的 prompt 组装和 artifact 语义，但不再自己维护 watcher 与 active session。

这份详细设计相对于 RFC 的一个重要收口是：

> RFC 里的 `run(config): AsyncIterable<AgentEvent>` 在工程上还不够精确。为了支持“先拿 handle，再监听事件，再允许取消/append”，这里正式细化为 `start(config): Promise<AgentSession>`。

也就是说，最终稳定合同不是“返回一个事件流”，而是：

1. 先创建 session
2. 立即拿到 handle 与能力矩阵
3. 再消费 `session.events()`
4. 同时允许通过 `session.cancel()` / `session.append()` 干预

这是当前代码真实需求决定的，不是额外设计偏好。

---

## 1. 目标与非目标

## 1.1 目标

本设计要解决 6 个具体问题：

1. 让 Antigravity 和 Codex 的运行生命周期对上同一套合同。
2. 让 Prompt Mode 不再自己维护 `activePromptRuns` + watcher + 完成收口。
3. 让 Template runtime 的 provider 分支有稳定迁移路径，而不是继续在 `group-runtime.ts` 增长 if/else。
4. 为 Memory 提供统一的 `beforeRun` / `afterRun` 生命周期钩子。
5. 为未来 `claude-api` / `openai-api` / `custom` provider 留出一致接入面。
6. 不破坏现有 `RunRegistry`、`executionTarget`、artifact 和 `agent-runs` API 作为系统真相源的地位。

## 1.2 非目标

本设计明确不在第一阶段处理以下问题：

1. 不重写 `group-runtime` 的 template orchestration。
2. 不把 `sourceContract`、`review-loop`、`delivery-single-pass` 抽进 backend。
3. 不在第一阶段做跨 provider 的工具调用字段标准化。
4. 不在第一阶段让 `project-only` 获得新的运行时。
5. 不在第一阶段替换所有 `TaskExecutor` 使用点；`callLLMOneshot()` 一类 utility 调用可以暂时继续使用旧接口。

---

## 2. 当前实现基线

## 2.1 真实分层

基于当前实现，运行链路更接近下面这张文字图，而不是“上层统一调用 TaskExecutor 就结束了”：

```text
API / Scheduler / CEO / MCP
  -> /api/agent-runs route
    -> dispatch-service (template path)
      -> group-runtime
        -> provider resolve
        -> gateway / grpc / watchConversation
        -> run-registry + project sync + finalization
    -> prompt-executor (prompt path)
      -> provider resolve
      -> gateway / executor / watchConversation
      -> run-registry + run-artifacts

providers/TaskExecutor
  -> antigravity-executor (dispatch only)
  -> codex-executor (sync execute)
```

这意味着今天真正统一的不是 session 生命周期，而是：

1. provider 选择
2. 少量 execute/append/cancel 接口

真正没有统一的，是：

1. handle 什么时候产生
2. status 什么时候从 `starting` 变为 `running`
3. liveState 谁维护
4. 如何判断 completion
5. cancel 后如何抑制晚到结果
6. terminal event 如何写回 artifact 与 envelope

## 2.2 当前职责矩阵

| 模块 | 当前职责 | 是否应保留 |
|:---|:---|:---|
| `run-registry.ts` | Run 真相源、持久化、project pipeline 同步 | 保留 |
| `group-runtime.ts` | Template orchestration、source contract、review-loop、shared conversation、intervention | 保留 |
| `prompt-executor.ts` | Prompt Mode prompt 组装、run 创建、artifact 目录、provider 分支、watch 与 finalization | 部分保留 |
| `watch-conversation.ts` | Antigravity gRPC 观察、heartbeat、stale 检测、错误步骤检测 | 保留但下沉到 backend |
| `providers/*Executor` | provider 叶子能力封装 | 保留但角色调整 |
| `gateway.ts` | owner map、连接解析、pre-registration | 保留 |

## 2.3 当前痛点

### 2.3.1 `TaskExecutor` 合同语义不稳定

当前 `TaskExecutor.executeTask()` 的返回值含义已经分裂：

1. `CodexExecutor` 返回的是“最终完成结果”。
2. `AntigravityExecutor` 返回的是“已派发 handle”，但 `status` 却被写成 `completed`。

这会导致所有上层消费者都必须知道：

1. 如果是 `codex`，可以直接 finalization
2. 如果是 `antigravity`，必须再开 watcher

也就是说，`TaskExecutor` 不是稳定运行合同，只是“provider-specific start primitive”。

### 2.3.2 runtime 逻辑重复

`group-runtime.ts` 和 `prompt-executor.ts` 当前都在重复做以下事情：

1. 维护 active run map
2. 绑定 handle
3. 将 watch 更新写回 `liveState`
4. 在 idle/error step 后 debounce completion
5. 处理 cancel 与 late completion

这类重复不是模板业务逻辑，而是 backend session 生命周期逻辑，应该抽走。

### 2.3.3 Antigravity 与 Codex 的 session model 差异没有被显式建模

当前差异不是“协议不同”这么简单，而是：

1. Antigravity：dispatch-first, observe-later
2. Codex：run-to-completion, return-once

如果不把这种差异显式提升为 session contract，未来接入更多 provider 时仍然会在 runtime 层持续分裂。

---

## 3. 核心设计决策

## 3.1 `AgentBackend` 只表示单次 backend session

这里必须明确：

1. `AgentBackend` 不知道 template graph。
2. `AgentBackend` 不知道 review round。
3. `AgentBackend` 不负责 pipeline downstream trigger。
4. `AgentBackend` 只负责一条 provider session：start / observe / append / cancel / terminal result。

换句话说：

1. Template runtime 仍然是 orchestrator。
2. Prompt runtime 仍然是 Prompt Mode orchestration shell。
3. `AgentBackend` 是两者下面共享的会话层。

## 3.2 细化 RFC：使用 `start(config) -> AgentSession`

RFC 里的 `run(config): AsyncIterable<AgentEvent>` 有一个工程问题：

1. 运行开始时需要立即拿到 handle 写入 Run
2. 之后才能支持 cancel / append
3. 还要允许异步消费事件流

单个 `AsyncIterable` 不能优雅表达“先拿 handle，再消费，再干预”的调用模型。

因此本设计将合同细化为：

```ts
interface AgentBackend {
  readonly providerId: ProviderId;
  start(config: BackendRunConfig): Promise<AgentSession>;
}

interface AgentSession {
  readonly runId: string;
  readonly providerId: ProviderId;
  readonly handle: string;
  readonly capabilities: AgentBackendCapabilities;
  events(): AsyncIterable<AgentEvent>;
  append(request: AppendRunRequest): Promise<void>;
  cancel(reason?: string): Promise<void>;
}
```

这个细化比 RFC 更贴近当前代码需求，而且不会改变 RFC 的方向：

1. 依然是统一事件流
2. 只是把 handle 和 session 生命周期显式化了

## 3.3 `RunRegistry` 继续是真相源

本设计不引入新的平行状态存储。

必须写死的规则：

1. `run-registry.ts` 仍然是运行态真相源
2. `executionTarget` / `executorKind` / `triggerContext` 继续挂在 `AgentRunState`
3. `AgentSessionRegistry` 只是进程内的活跃 session 索引，不是持久化真相

## 3.4 三条轴分离

后续文档与代码中，必须显式区分以下三条轴：

1. `executionTarget`
   - 业务上要执行什么：`template` / `prompt` / `project-only`
2. `executorKind`
   - 运行家族：当前是 `template` / `prompt`
3. `providerId`
   - 底层 backend：`antigravity` / `codex` / future providers

这三者不能继续混用，否则后续 Memory、UI、审计和 provider fallback 都会混乱。

## 3.5 terminal state 不可逆

必须沿用并写死当前 Prompt Mode 已验证过的规则：

1. `cancelled` / `failed` / `timeout` / `completed` 都是终态
2. 终态之后收到的晚到 `completed` / `live_state` 一律丢弃
3. local cancel 也必须压过 remote late completion

这对不支持真正 cancel 的同步 provider 尤其重要。

---

## 4. 目标架构

## 4.1 逻辑结构

```text
entrypoints
  -> dispatch-service / prompt-executor
    -> AgentBackendRegistry
      -> AntigravityBackend
      -> CodexBackend
      -> future backends

shared runtime utilities
  -> AgentSessionRegistry
  -> BackendSessionConsumer
  -> backend finalization helpers

truth/state
  -> RunRegistry
  -> artifact files
  -> project sync
```

## 4.2 新增模块建议

建议新增以下文件：

1. `src/lib/backends/types.ts`
2. `src/lib/backends/errors.ts`
3. `src/lib/backends/session-registry.ts`
4. `src/lib/backends/registry.ts`
5. `src/lib/backends/antigravity-backend.ts`
6. `src/lib/backends/codex-backend.ts`
7. `src/lib/backends/session-consumer.ts`
8. `src/lib/backends/memory-hooks.ts`（先放空骨架，阶段 4 再接）

这些模块不会替换现有 `providers/` 目录，而是先作为 runtime-facing 抽象层并存。

---

## 5. 接口详细定义

## 5.1 Backend 输入合同

```ts
export interface BackendRunConfig {
  runId: string;
  workspacePath: string;
  prompt: string;
  model?: string;
  artifactDir?: string;
  parentConversationId?: string;
  executionTarget?: ExecutionTarget;
  triggerContext?: TriggerContext;
  metadata?: {
    projectId?: string;
    stageId?: string;
    roleId?: string;
    executorKind?: 'template' | 'prompt';
  };
  memoryContext?: MemoryContext;
  timeoutMs?: number;
}
```

决策说明：

1. `workspacePath` 使用绝对路径且不带 `file://`，与当前 provider 代码保持一致。
2. `metadata.stageId` / `roleId` 只是观测和 annotation 语义，不是 template orchestration 输入。
3. `memoryContext` 第一阶段只保留字段，不强制所有 backend 消费。

## 5.2 Session 合同

```ts
export interface AgentBackendCapabilities {
  supportsAppend: boolean;
  supportsCancel: boolean;
  emitsLiveState: boolean;
  emitsRawSteps: boolean;
  emitsStreamingText: boolean;
}

export interface AppendRunRequest {
  prompt: string;
  model?: string;
  workspacePath?: string;
}

export interface AgentSession {
  readonly runId: string;
  readonly providerId: ProviderId;
  readonly handle: string;
  readonly capabilities: AgentBackendCapabilities;
  events(): AsyncIterable<AgentEvent>;
  append(request: AppendRunRequest): Promise<void>;
  cancel(reason?: string): Promise<void>;
}
```

关键决策：

1. `handle` 必须在 `start()` 返回时已经可用。
2. `cancel()` 总是存在，但 provider 可以只提供 local-cancel 语义。
3. `append()` 第一阶段只要求 Antigravity 保真；Codex 可以返回 `append_not_supported` 或 no-op，并由上层能力矩阵阻止入口暴露。

## 5.3 事件合同

第一阶段不做跨 provider 的细粒度工具事件标准化，只统一 runtime 真正需要的事件：

```ts
export interface BackendRunError {
  code:
    | 'invalid_input'
    | 'no_language_server'
    | 'api_key_missing'
    | 'dispatch_failed'
    | 'watch_failed'
    | 'provider_failed'
    | 'cancel_not_supported'
    | 'append_not_supported'
    | 'invalid_response'
    | 'stale_timeout';
  message: string;
  retryable: boolean;
  source: 'backend' | 'provider' | 'watcher' | 'orchestrator';
}

export type AgentEvent =
  | {
      kind: 'started';
      runId: string;
      providerId: ProviderId;
      handle: string;
      startedAt: string;
    }
  | {
      kind: 'live_state';
      runId: string;
      providerId: ProviderId;
      handle: string;
      liveState: RunLiveState;
    }
  | {
      kind: 'completed';
      runId: string;
      providerId: ProviderId;
      handle: string;
      finishedAt: string;
      result: TaskResult;
      rawSteps?: unknown[];
      finalText?: string;
    }
  | {
      kind: 'failed';
      runId: string;
      providerId: ProviderId;
      handle?: string;
      finishedAt: string;
      error: BackendRunError;
      rawSteps?: unknown[];
      liveState?: RunLiveState;
    }
  | {
      kind: 'cancelled';
      runId: string;
      providerId: ProviderId;
      handle?: string;
      finishedAt: string;
      reason?: string;
    };
```

为什么第一阶段没有 `tool_call` / `text_delta`：

1. 当前 Antigravity 已有的是 raw step snapshot，不是稳定 normalized tool event。
2. 当前 Codex 也没有可靠逐步事件流。
3. 第一阶段的目标是统一 runtime lifecycle，而不是统一 provider 协议。

第二阶段以后，如果真的需要 Memory 动态召回或 UI 逐字流式展示，再新增 `observation` 族事件。

---

## 6. Session 生命周期设计

## 6.1 抽象状态机

`AgentSession` 的内部状态机定义如下：

```text
initialized
  -> starting
  -> running
  -> completed | failed | cancelled
```

对应 `AgentRunState.status` 的写回规则：

| Session 事件 | Run 状态 |
|:---|:---|
| session 创建前 | `queued` |
| `started` | `starting` |
| 第一条 `live_state` 或 provider 立即进入执行 | `running` |
| `completed` + result.status=`completed` | `completed` |
| `completed` + result.status=`blocked` | `blocked` |
| `completed` + result.status=`failed` | `failed` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |

补充规则：

1. 对不发 `live_state` 的同步 backend，consumer 在 `started` 后可立即置 `running`。
2. `completed` 事件里的 `TaskResult.status` 仍然保留 `completed|blocked|failed` 三态，不能简单映射成全部 completed。

## 6.2 AntigravityBackend 生命周期

### start 阶段

1. 发现 language server
2. 检查 apiKey
3. `addTrackedWorkspace`
4. `startCascade`
5. `preRegisterOwner`
6. 更新 annotation
7. `sendMessage`
8. 返回 session（此时 handle 已存在）

### events 阶段

1. 内部直接复用 `watchConversation()`
2. watcher 的 `liveState` 转成 `live_state` event
3. watcher 在 idle/error step 之后由 backend 内部做 debounce
4. backend 自己决定何时发 `completed` / `failed`
5. 完成时调用 `compactCodingResult(rawSteps, artifactAbsDir)` 生成 `TaskResult`

### cancel 阶段

1. 若 handle 已有，调用 `grpc.cancelCascade`
2. 无论远端 cancel 是否真正生效，都先将本地 session 标记为 `cancelRequested`
3. 后续晚到 `completed` 事件必须被 session 内部抑制

### 关键原则

1. `watchConversation.ts` 保留不改协议，只改变调用位置。
2. owner map / heartbeat / stale 检测全部留在 AntigravityBackend 内部，不再外泄到 prompt/template runtime。

## 6.3 CodexBackend 生命周期

### start 阶段

1. 生成 synthetic handle，例如 `codex:<runId>`
2. 启动后台 promise 执行 `CodexExecutor.executeTask()`
3. 立即返回 session

### events 阶段

1. 先发 `started`
2. 可选发一个 synthetic running tick（通过 consumer 处理，不强制单独事件）
3. 等待 promise resolve/reject
4. resolve -> `completed`
5. reject -> `failed`

### cancel 阶段

Codex 当前没有真正的 remote cancel，因此第一阶段定义为：

1. session 记录 `cancelRequested`
2. 之后如果后台 promise 完成，consumer 必须丢弃晚到 `completed`
3. route 可以仍然返回 `cancelled`

也就是说，Codex 的 cancel 语义是：

> local cancel guaranteed，remote stop best effort / unsupported。

这和当前 Prompt Mode 已经验证过的做法一致。

---

## 7. Runtime 集成设计

## 7.1 AgentSessionRegistry

新增进程内活跃 session 索引：

```ts
export interface ActiveAgentSessionRecord {
  runId: string;
  providerId: ProviderId;
  handle: string;
  session: AgentSession;
  cancelRequested: boolean;
  terminalSeen: boolean;
}
```

职责：

1. 让 route 层可以按 `runId` 找到活跃 session
2. 统一 cancel / append 入口
3. 避免 `prompt-executor` 和 `group-runtime` 各自维护一套 active map

非职责：

1. 不负责持久化
2. 不是真相源
3. 进程重启后允许全部丢失，由 `RunRegistry` 负责恢复和失败标记

## 7.2 BackendSessionConsumer

新增公共消费器，负责把 `AgentEvent` 写回 `RunRegistry`。

建议签名：

```ts
interface BackendSessionConsumerHooks {
  onStarted?(event: StartedEvent): Promise<void> | void;
  onLiveState?(event: LiveStateEvent): Promise<void> | void;
  onCompleted?(event: CompletedEvent): Promise<void> | void;
  onFailed?(event: FailedEvent): Promise<void> | void;
  onCancelled?(event: CancelledEvent): Promise<void> | void;
}

function consumeAgentSession(
  runId: string,
  session: AgentSession,
  hooks?: BackendSessionConsumerHooks,
): Promise<void>
```

默认能力：

1. 终态保护：已 terminal 时丢弃后续事件
2. 基础状态写回：`startedAt`、`activeConversationId`、`liveState`、`finishedAt`
3. session 完成后自动从 `AgentSessionRegistry` 释放

策略能力：

1. Prompt Mode 通过 hook 接 finalization
2. Template runtime 通过 hook 接 roleProgress、review、input audit、pipeline 触发

## 7.3 PromptExecutor 集成方式

第一阶段，`prompt-executor.ts` 迁移成“Prompt shell + artifact 语义层”：

保留：

1. `PromptExecutionTarget` 归一化
2. task-envelope 组装
3. promptAssetRefs / skillHints 的 prompt 拼装
4. Prompt Mode 结果 envelope 和 manifest 语义

移除：

1. `activePromptRuns`
2. `startPromptWatch()`
3. provider-specific if/else
4. 直接调用 `watchConversation()`

新流程：

1. createRun
2. build artifact dir
3. `backend = getAgentBackend(providerId)`
4. `session = await backend.start(config)`
5. `registerSession(runId, session)`
6. `consumeAgentSession(runId, session, promptHooks)`

## 7.4 group-runtime 集成方式

`group-runtime.ts` 不在第一阶段整体迁移，只迁 provider 边界。

建议顺序：

1. 先迁 legacy-single 路径
2. 再迁多轮作者/审阅者单角色 session 执行
3. 最后才动 shared conversation 与 supervisor 相关分支

原因：

1. orchestration 层仍然很厚
2. 现有 template 路径的行为比 prompt 路径复杂得多
3. 需要先跑通一个稳定 prompt consumer，再迁 template runtime 才安全

---

## 8. 错误处理与重试策略

## 8.1 错误分类

| code | 场景 | retryable |
|:---|:---|:---:|
| `invalid_input` | 缺 prompt、缺 workspace、参数非法 | 否 |
| `no_language_server` | Antigravity 无 server | 是 |
| `api_key_missing` | 缺鉴权 | 否 |
| `dispatch_failed` | `startCascade` / `sendMessage` 失败 | 是 |
| `watch_failed` | gRPC stream 持续失败或 heartbeat 崩溃 | 是 |
| `provider_failed` | Codex/未来 provider 自身报错 | 视情况 |
| `cancel_not_supported` | provider 不支持远端 cancel | 否 |
| `append_not_supported` | provider 不支持追加消息 | 否 |
| `invalid_response` | provider 返回结果不完整 | 是 |
| `stale_timeout` | 长时间无新步骤 | 是 |

## 8.2 run 状态与错误映射

规则：

1. `failed` event 一律写 `run.lastError`
2. `completed.result.status = blocked` 时，不覆盖成 failed
3. cancel route 如果 provider 不支持 remote cancel，仍可返回 cancelled，但日志里要写明 local cancel only

## 8.3 重试策略

第一阶段不做自动重试框架，只定义边界：

1. backend 不自动重试 dispatch
2. `watchConversation` 内部已有 reconnect，可继续保留
3. 手动 retry/restart_role 仍由上层 orchestrator 负责
4. future scheduler/job retry 不属于本设计范围

---

## 9. Memory 生命周期钩子设计

## 9.1 目标

Memory 接入必须建立在稳定 backend lifecycle 上，而不是直接挂到 provider 分支里。

因此第一阶段只写接口和挂点，第二阶段再真正启用。

## 9.2 钩子接口

```ts
export interface MemoryContext {
  projectMemories: MemoryEntry[];
  departmentMemories: MemoryEntry[];
  userPreferences: MemoryEntry[];
}

export interface MemoryHooks {
  beforeRun(config: BackendRunConfig): Promise<BackendRunConfig>;
  afterRun(runId: string, result: TaskResult): Promise<void>;
}
```

## 9.3 挂点

1. `beforeRun`
   - 由 `prompt-executor` / `group-runtime` 在调用 `backend.start()` 前执行
   - 结果写回 `config.memoryContext`
2. `afterRun`
   - 由 `consumeAgentSession` 在处理 `completed` 事件后触发
   - 以 `runId + result + artifactDir` 为输入，做自动提取

## 9.4 第一阶段限制

第一阶段不做：

1. 中途动态召回
2. 细粒度 tool event 驱动的 memory refresh
3. 多 provider 统一 step schema

原因很简单：当前连 provider session lifecycle 都没有统一，先做 Memory 只会把耦合扩散到更多分支。

---

## 10. 迁移计划

## 10.1 阶段 0：补 characterization tests

目标：先锁住现有行为，再抽象。

影响文件：

1. `src/lib/agents/prompt-executor.test.ts`
2. `src/app/api/agent-runs/route.test.ts`
3. `src/lib/agents/shared-conversation.test.ts`
4. 新增 group-runtime characterization tests

必须覆盖：

1. Antigravity handle 先返回、结果后完成
2. cancel 后忽略晚到 completion
3. template executionTarget 兼容
4. prompt run 不污染 pipeline stage

## 10.2 阶段 1：新增 backend 层并先迁 Prompt Mode

目标：让 Prompt Mode 全量走 `AgentBackend`。

影响文件：

1. 新增 `src/lib/backends/*`
2. `src/lib/agents/prompt-executor.ts`
3. `src/app/api/agent-runs/[id]/route.ts`
4. `src/app/api/agent-runs/[id]/intervene/route.ts`

完成标准：

1. `prompt-executor.ts` 不再直接依赖 `watchConversation`
2. `activePromptRuns` 删除
3. cancel 统一走 `AgentSessionRegistry`

## 10.3 阶段 2：抽公共 finalization 与 session consumer

目标：把 Prompt Mode 已验证过的终态保护和 finalization 下沉成公共能力。

影响文件：

1. `src/lib/backends/session-consumer.ts`
2. `src/lib/agents/run-artifacts.ts`
3. `src/lib/agents/prompt-executor.ts`
4. `src/lib/agents/finalization.ts`

## 10.4 阶段 3：迁 group-runtime 的 provider 边界

目标：先替换单次 role session 生命周期，不动 template orchestration。

影响文件：

1. `src/lib/agents/group-runtime.ts`
2. `src/lib/agents/dispatch-service.ts`
3. 相关 intervention 路径

优先顺序：

1. legacy-single
2. isolated role session
3. shared conversation / supervisor

## 10.5 阶段 4：接入 MemoryHooks

目标：统一 run 前注入、run 后提取。

影响文件：

1. 新增 `src/lib/backends/memory-hooks.ts`
2. `prompt-executor.ts`
3. `group-runtime.ts`
4. `department-memory.ts`

---

## 11. 测试矩阵

## 11.1 单元测试

### AntigravityBackend

1. 无 language server -> `failed(no_language_server)`
2. 无 apiKey -> `failed(api_key_missing)`
3. dispatch 成功 -> `started`
4. watch idle -> `completed`
5. error step -> `completed(result.status=failed)` 或 `failed(watch_failed)`，取决于路径
6. cancel 后晚到 completed 被抑制

### CodexBackend

1. start 返回 synthetic handle
2. execute 成功 -> `started` + `completed`
3. execute 抛错 -> `failed(provider_failed)`
4. cancelRequested 后晚到 completed 被抑制

### SessionConsumer

1. started 正确写回 run handle 与 startedAt
2. live_state 正确写回 `liveState`
3. terminal 后忽略后续事件
4. terminal 后自动 release session

## 11.2 集成测试

### Prompt Mode

1. `/api/agent-runs` prompt path 仍返回 201
2. run 能进入 completed / failed / cancelled
3. result-envelope 和 manifest 正常落盘

### Template Mode 回归

1. legacy template 请求不受影响
2. `executionTarget.kind=template` 显式请求不受影响
3. group-runtime 迁移前后 shared conversation 测试保持通过

## 11.3 迁移门槛

进入下一阶段前必须满足：

1. Prompt Mode 的现有测试全部通过
2. build 通过
3. route cancel / intervene 行为未退化
4. run-registry 的 terminal invariants 未破坏

---

## 12. 风险与缓解

## 12.1 风险：把 dispatch-success 当成 completed

这是当前 `AntigravityExecutor` 最大合同问题。

缓解：

1. `started` 与 `completed` 事件彻底拆开
2. backend session 内部负责 completion 判断

## 12.2 风险：过早抽象 template orchestration

缓解：

1. 第一阶段只迁 Prompt Mode
2. 第二阶段只抽 session consumer 与 finalization
3. Template runtime 最后迁

## 12.3 风险：丢失 watcher 的 heartbeat / stale 逻辑

缓解：

1. `watch-conversation.ts` 不重写，只搬调用位置
2. AntigravityBackend 直接包裹现有 watcher

## 12.4 风险：provider 不支持 cancel 导致语义不一致

缓解：

1. `cancel()` 定义为 local cancel guaranteed
2. route 层用能力矩阵控制 UI 和 API 行为
3. terminal 后晚到结果统一丢弃

---

## 13. 本设计写死的决策

这部分是详细设计最重要的稳定结论：

1. `AgentBackend` 是单次 backend session 抽象，不是新的编排器。
2. 相比 RFC，最终采用 `start(config): Promise<AgentSession>`，而不是裸 `run(config)`。
3. `TaskExecutor` 第一阶段继续存在，但只作为 leaf adapter / compatibility layer，不再被视为最终 runtime 合同。
4. `RunRegistry` 继续是真相源；新增的 session registry 只做进程内活跃索引。
5. `executionTarget`、`executorKind`、`providerId` 三条轴必须分离。
6. terminal state 不可逆，cancel 后晚到结果必须抑制。
7. 第一阶段不做细粒度 tool/text normalization，只统一 started/live_state/terminal 事件。
8. Memory 只能挂在统一 backend lifecycle 上，不能继续分散到 provider 分支里。

---

## 14. 当前建议

如果下一步进入实现，我建议严格按下面顺序推进：

1. 先补 characterization tests
2. 先迁 Prompt Mode 到 AgentBackend
3. 再抽公共 session consumer 与 finalization
4. 最后再迁 Template runtime
5. MemoryHooks 放在 Prompt + Template 两条链都稳定之后再接

这是当前最稳、最不容易把 `group-runtime` 这种厚编排层误抽坏的落地顺序。