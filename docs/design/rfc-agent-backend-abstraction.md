# RFC: 统一 AgentBackend 抽象层

**日期**: 2026-04-08  
**状态**: Draft  
**作者**: AI Architect  
**关联**: Craft Agent 双 Backend 研究 (`docs/internals/craft-agents-provider-routing-and-pi-agent-study.md`)

---

## 一句话总结

将当前 7 处 per-provider if/else 分支收敛为统一的 `AgentBackend` 接口 + `AgentEvent` 事件流，使新 Provider（claude-api / openai-api）即插即用，并为 Memory 自动提取/注入提供统一钩子。

---

## 1. 动机

### 1.1 当前问题

当前系统有 **7 处 per-provider 分支**（详见附录 A），分布在 3 个文件中：

| 文件 | 分支数 | 核心问题 |
|------|:------:|---------|
| `group-runtime.ts` | 5 | 资源获取、重用决策、角色路由、supervisor 启动、结果处理 |
| `prompt-executor.ts` | 1 | 同步 vs 异步执行模式 |
| `conversations/route.ts` | 1 | IDE 依赖检查 |

**每增加一个新 Provider，需要修改 3 个文件的 7 个位置**。随着 `claude-api`、`openai-api`、`custom` 等 Provider 加入，维护成本线性增长。

### 1.2 Memory 系统的需求

参考 Claude Code 的 Memory 架构（四类型分类法 + Fork Agent 自动提取 + Sonnet 智能召回），我们未来要实现：

| Memory 能力 | 需要的基础 |
|------------|-----------|
| Run 完成后自动提取记忆 | 统一的 `onComplete` 生命周期钩子 |
| Run 启动时注入相关记忆 | 统一的 `config.memoryContext` 注入点 |
| 跨 Provider 一致的记忆格式 | 统一的 `AgentEvent` 事件流 |
| 记忆召回依赖上下文 | `AgentEvent` 流提供实时信号 |
| 部门级记忆隔离 | Backend scope 天然隔离 |

**当前架构下，Memory 的读写钩子需要在每个 Provider 路径分别实现。AgentBackend 抽象将这个 N 降为 1。**

### 1.3 Craft Agent 的验证

Craft Agent 已经用双 backend（ClaudeAgent + PiAgent）+ 统一 `AgentEvent` 验证了这个架构的可行性：

- Claude 路径：Claude SDK → `ClaudeEventAdapter` → Craft `AgentEvent`
- Pi 路径：Pi SDK → `PiEventAdapter` → Craft `AgentEvent`
- 统一后：所有上层（UI、工具面板、会话持久化）只依赖 `AgentEvent`

**关键教训**：Craft 统一的是**内部事件模型**，不是底层协议。这是正确的抽象层次。

---

## 2. 设计

### 2.1 核心接口

```typescript
// ─── AgentEvent 统一事件流 ───

type AgentEvent =
  | { kind: 'started';    runId: string; handle: string }
  | { kind: 'step';       runId: string; step: AgentStep }
  | { kind: 'progress';   runId: string; progress: number; message?: string }
  | { kind: 'artifact';   runId: string; artifact: ArtifactRef }
  | { kind: 'text_delta'; runId: string; delta: string }
  | { kind: 'completed';  runId: string; result: ResultEnvelope }
  | { kind: 'failed';     runId: string; error: string; retryable: boolean }
  | { kind: 'cancelled';  runId: string }

// ─── AgentBackend 统一接口 ───

interface AgentBackend {
  readonly providerId: ProviderId

  /**
   * 执行任务。统一返回 AsyncIterable<AgentEvent>。
   * - Antigravity：dispatch + gRPC stream → AgentEvent
   * - Codex：同步执行，完成后 yield started + completed
   * - 未来 Provider：各自适配
   */
  run(config: RunConfig): AsyncIterable<AgentEvent>

  /** 向正在运行的任务追加消息（nudge/revise） */
  append(handle: string, message: string): Promise<void>

  /** 取消正在运行的任务 */
  cancel(handle: string): Promise<void>

  /** 能力矩阵 */
  capabilities(): BackendCapabilities
}

// ─── RunConfig 统一输入 ───

interface RunConfig {
  runId: string
  workspacePath: string
  prompt: string
  systemInstructions?: string
  memoryContext?: MemoryContext      // ← Memory 注入点
  inputArtifacts?: ArtifactRef[]
  executionTarget?: ExecutionTarget
  metadata?: Record<string, string>
}

// ─── Memory 注入 ───

interface MemoryContext {
  projectMemories: MemoryEntry[]    // 项目级记忆
  departmentMemories: MemoryEntry[] // 部门级记忆
  userPreferences: MemoryEntry[]    // 用户偏好
}

interface MemoryEntry {
  type: 'user' | 'feedback' | 'project' | 'reference'
  name: string
  content: string
  updatedAt: string
}
```

### 2.2 Backend 实现

#### AntigravityBackend

```typescript
class AntigravityBackend implements AgentBackend {
  readonly providerId = 'antigravity' as const

  async *run(config: RunConfig): AsyncIterable<AgentEvent> {
    // 1. 发现 Language Server
    const server = await findLanguageServer(config.workspacePath)
    
    // 2. Dispatch cascade
    const cascadeId = await this.dispatchCascade(server, config)
    yield { kind: 'started', runId: config.runId, handle: cascadeId }
    
    // 3. gRPC watch stream → AgentEvent
    const stream = watchConversation(cascadeId, server)
    for await (const event of stream) {
      yield this.adaptEvent(config.runId, event)
    }
    
    // 4. Completion
    const result = await this.buildResult(config.runId, cascadeId)
    yield { kind: 'completed', runId: config.runId, result }
  }
  
  private adaptEvent(runId: string, raw: ConversationWatchEvent): AgentEvent {
    // ConversationWatchEvent → AgentEvent 适配
    // 类似 Craft 的 ClaudeEventAdapter
  }
}
```

#### CodexBackend

```typescript
class CodexBackend implements AgentBackend {
  readonly providerId = 'codex' as const

  async *run(config: RunConfig): AsyncIterable<AgentEvent> {
    yield { kind: 'started', runId: config.runId, handle: `codex-${config.runId}` }
    
    // 同步执行（阻塞）
    const executor = getExecutor('codex')
    const result = await executor.executeTask({
      prompt: config.prompt,
      workspacePath: config.workspacePath,
      // ... inject memoryContext into system instructions
    })
    
    // 合成伪步骤（Codex 不提供步骤数据）
    yield { kind: 'step', runId: config.runId, step: { 
      type: 'text', content: result.content 
    }}
    
    yield { kind: 'completed', runId: config.runId, result: toResultEnvelope(result) }
  }
}
```

### 2.3 统一 Runtime 消费

```typescript
// group-runtime.ts — 重构后

async function executeRole(runId: string, roleConfig: RoleConfig) {
  const backend = getBackend(runId)    // ← 工厂函数，替代 7 处 if/else
  const config = buildRunConfig(runId, roleConfig)
  
  for await (const event of backend.run(config)) {
    switch (event.kind) {
      case 'started':
        updateRun(runId, { status: 'running', childConversationId: event.handle })
        break
      case 'step':
        appendStep(runId, event.step)
        break
      case 'completed':
        handleCompletion(runId, event.result)
        break
      case 'failed':
        handleFailure(runId, event.error, event.retryable)
        break
    }
  }
}
```

### 2.4 Memory 生命周期钩子

```typescript
// ─── 统一的 Memory 钩子 ───

class MemoryHooks {
  /** Run 启动前：注入相关记忆到 RunConfig */
  async beforeRun(config: RunConfig): Promise<RunConfig> {
    const memories = await findRelevantMemories({
      query: config.prompt,
      workspacePath: config.workspacePath,
      department: config.executionTarget?.department,
    })
    return { ...config, memoryContext: memories }
  }
  
  /** Run 完成后：从结果中提取新记忆 */
  async afterRun(runId: string, result: ResultEnvelope): Promise<void> {
    const run = getRun(runId)
    if (!run) return
    
    // Fork Agent 提取记忆（参考 Claude Code 的 extractMemories）
    await extractMemoriesFromRun({
      runId,
      prompt: run.task?.prompt,
      result: result.summary,
      steps: result.steps,
      workspacePath: run.workspacePath,
    })
  }
  
  /** 事件流中：根据 step 事件动态召回记忆 */
  async onEvent(event: AgentEvent): Promise<MemoryEntry[] | null> {
    if (event.kind === 'step' && event.step.type === 'tool_use') {
      return findRelevantMemories({
        query: `tool: ${event.step.toolName}`,
        workspacePath: event.runId, // lookup from registry
      })
    }
    return null
  }
}

// ─── 集成到 Runtime ───

async function executeWithMemory(runId: string, roleConfig: RoleConfig) {
  const backend = getBackend(runId)
  const hooks = new MemoryHooks()
  
  // Before: 注入记忆
  let config = buildRunConfig(runId, roleConfig)
  config = await hooks.beforeRun(config)
  
  // During: 消费事件流 + 可选的动态召回
  for await (const event of backend.run(config)) {
    handleEvent(runId, event)
    // 可选：动态记忆召回
    // const memories = await hooks.onEvent(event)
  }
  
  // After: 提取记忆
  const result = getRun(runId)?.result
  if (result) await hooks.afterRun(runId, result)
}
```

---

## 3. 架构对比

### 3.1 Before vs After

```
Before (方案 A):
                    ┌─ if antigravity → dispatchCascade + startWatching
executeRole() ──────┤
                    └─ if codex → executeTask + 直接返回
                    
                    ┌─ if antigravity → dispatch + watch
executePrompt() ────┤
                    └─ else → executeTask + finalize
                    
                    ┌─ if codex → 虚拟对话
createConversation()┤
                    └─ else → gRPC startCascade

After (方案 B):
                                    ┌─ AntigravityBackend.run()
executeRole() ── getBackend() ──────┤  → yield started/step/completed
                    │               └─ CodexBackend.run()
                    │                  → yield started/completed
                    │
                    ├── MemoryHooks.beforeRun()
                    ├── for await (event) { handleEvent() }
                    └── MemoryHooks.afterRun()
```

### 3.2 新增 Provider 的工作量对比

| 操作 | Before | After |
|------|:------:|:-----:|
| 新增 Provider | 改 3 文件 7 处 | 写 1 个 Backend 类 |
| 加 Memory 钩子 | 每个 Provider 各加 | 写 1 次 MemoryHooks |
| 加通知能力 | 每个 Provider 各加 | 在 event loop 加 1 处 |
| 改事件格式 | 无统一格式 | 改 AgentEvent 类型 |

---

## 4. 分期执行计划

### Phase 1：定义接口 + 适配现有 Provider（1-2 天）

**交付物**：
1. `src/lib/agents/backend/types.ts` — `AgentBackend` + `AgentEvent` + `RunConfig` 类型
2. `src/lib/agents/backend/antigravity.ts` — 包装现有 `AntigravityExecutor` + `watchConversation`
3. `src/lib/agents/backend/codex.ts` — 包装现有 `CodexExecutor`
4. `src/lib/agents/backend/factory.ts` — `getBackend(providerId)` 工厂函数
5. 测试：每个 Backend Mock 验证事件流

**不改动**：`group-runtime.ts`、`prompt-executor.ts` 现有代码不动。新代码与旧代码并存。

### Phase 2：迁移 Runtime 消费层（1-2 天）

**交付物**：
1. `prompt-executor.ts` — 改用 `getBackend().run()` 替代 if/else
2. `group-runtime.ts` — 逐步替换 5 处 per-provider 分支
3. `conversations/route.ts` — 替换 1 处 Provider 判断
4. 集成测试：验证 Antigravity/Codex 两条路径行为不变

### Phase 3：Memory 钩子系统（1-2 天）

**交付物**：
1. `src/lib/agents/memory/types.ts` — MemoryEntry, MemoryContext
2. `src/lib/agents/memory/hooks.ts` — beforeRun / afterRun / onEvent
3. `src/lib/agents/memory/extract.ts` — 从 Run 结果提取记忆
4. `src/lib/agents/memory/recall.ts` — 智能召回（Sonnet side-query 或关键词匹配）
5. `src/lib/agents/memory/store.ts` — 文件系统存储（`.md` 格式，兼容 Claude Code 四类型）
6. 测试 + 文档

### Phase 4：新 Provider 验证（1 天）

**交付物**：
1. `src/lib/agents/backend/claude-api.ts` — Claude API 直连 Backend
2. 集成测试验证即插即用
3. 文档更新

---

## 5. 风险与缓解

| 风险 | 严重度 | 缓解 |
|------|:------:|------|
| AsyncIterable 在 Codex 同步场景下多余 | 低 | Codex Backend 直接 yield 2 个事件（started + completed），无性能影响 |
| gRPC watch stream 到 AgentEvent 的适配丢失信息 | 中 | 保留 `raw` 字段在 AgentEvent 中，需要时可访问原始数据 |
| Phase 2 迁移时引入回归 | 中 | 逐文件迁移 + 每步跑全量测试；旧代码保留为 fallback |
| Memory 提取的 LLM 成本 | 低 | 仅在 Run 完成时调用一次 Sonnet side-query，可通过配置关闭 |

---

## 6. 非目标

- **不做协议级统一**（不把 OpenAI SSE 转成 Anthropic message）— Craft 的教训：统一内部事件模型就够了
- **不做 Provider 热切换**（运行中切换 Provider）— 目前没有需求
- **不做 Provider 级 A/B 测试** — 可以在 Phase 4 之后考虑
- **不重写 `TaskExecutor` 接口** — `AgentBackend` 包装它，不替代它

---

## 附录 A：当前 Per-Provider 分支清单

| # | 文件 | 行号 | 分支内容 |
|---|------|------|---------|
| 1 | `group-runtime.ts` | ~374 | Language Server 发现 vs MCP CLI |
| 2 | `group-runtime.ts` | ~1781 | Cascade 重用决策（仅 Antigravity） |
| 3 | `group-runtime.ts` | ~1785 | 角色执行路由（核心分支） |
| 4 | `group-runtime.ts` | ~1851 | Supervisor 启动（仅 Antigravity） |
| 5 | `group-runtime.ts` | ~1858 | 结果处理（watch vs 直返） |
| 6 | `prompt-executor.ts` | ~370 | 同步 vs 异步执行 |
| 7 | `conversations/route.ts` | ~188 | IDE 依赖检查 |

## 附录 B：Claude Code Memory 架构参考

Claude Code 的 Memory 系统核心组件：

| 组件 | 路径 | 职责 |
|------|------|------|
| memdir.ts | `src/memdir/memdir.ts` | Memory 主入口，`loadMemoryPrompt()` |
| memoryTypes.ts | `src/memdir/memoryTypes.ts` | 四类型分类法 |
| findRelevantMemories.ts | `src/memdir/findRelevantMemories.ts` | Sonnet side-query 召回 |
| extractMemories.ts | `src/services/extractMemories/` | Fork Agent 自动提取 |
| agentMemory.ts | `src/tools/AgentTool/agentMemory.ts` | Agent 持久化内存（三作用域） |
| claudemd.ts | `src/utils/claudemd.ts` | CLAUDE.md 发现与加载 |

Memory 生命周期：`LOAD（会话启动）→ QUERY（对话循环） → SAVE（stopHooks 提取）→ CONSOLIDATE（autoDream 合并）`

## 附录 C：Craft Agent 统一事件模型参考

Craft 的统一点：
- `AgentEvent` 联合类型（两条路径收敛）
- `AgentBackend` 接口（ClaudeAgent + PiAgent 的公共抽象）
- `SessionManager` 处理链（统一会话持久化）
- `BaseAgent` 公共能力层（统一工具注册、权限、计划）

**关键设计决策**：Craft 统一的是内部事件模型，不是底层协议。PiEventAdapter 做工具字段兼容（`path→file_path`）但不改协议形状。
