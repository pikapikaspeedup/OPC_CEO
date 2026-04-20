# Native Codex -> Claude Engine Provider 链独立复核（子任务 C，2026-04-20）

**日期**: 2026-04-20  
**范围**:

- `src/lib/backends/claude-engine-backend.ts`
- `src/lib/claude-engine/api/retry.ts`
- `src/lib/claude-engine/api/native-codex/index.ts`
- `src/lib/backends/builtin-backends.ts`
- `src/lib/agents/department-capability-registry.ts`
- 补充核对：
  - `src/lib/agents/department-execution-resolver.ts`
  - `src/lib/agents/prompt-executor.ts`
  - `src/lib/claude-engine/api/openai/convertMessages.ts`

**目标**: 复核除 `provider=openai` 之外，是否还存在会让 `native-codex` 实际不走专用 adapter，或导致 `review-loop` 失败的关键断点。

---

## 1. 结论摘要

### 已确认修复

旧审计文档里的主断点已经不是当前事实：

1. `builtin-backends.ts` 已把 `native-codex` Department 主链注册到 `ClaudeEngineAgentBackend('native-codex')`
2. `resolveApiBackedModelConfig('native-codex')` 现在返回：
   - `provider: 'native-codex'`
3. `retry.ts` 也已把 `provider === 'native-codex'` 路由到：
   - `streamQueryNativeCodex(options)`

所以：

- **目前没有再看到“native-codex 被重新映射回 openai，因此不走专用 adapter”这条断点。**

### 仍然存在的关键断点

本轮确认至少还有 **2 个真实断点**，另有 **1 个路由层放大器**：

1. **native-codex 的多轮工具循环仍不是结构化协议回放，而是把 `tool_use / tool_result` 压平成文本再发回模型**
2. **`requiredArtifacts` 的校验时序早于平台 finalization，`result-envelope.json / artifacts.manifest.json` 会被过早要求存在**
3. **capability registry 仍把 `native-codex` 当成完整 `review-loop` provider，但这个判断没有覆盖上面两条真实 readiness 条件**

---

## 2. Finding A：没有新的 provider 重映射断点，专用 adapter 已经在主链命中

### 证据

`claude-engine-backend.ts`:

- `resolveApiBackedModelConfig('native-codex')`
- 返回 `provider: 'native-codex'`

`retry.ts`:

- `case 'native-codex': return streamQueryNativeCodex(options);`

### 判断

就“是否还会绕开 native-codex 专用 adapter”这个问题而言：

- **答案是否定的。**

这条 provider 路由主链现在已经闭合。

---

## 3. Finding B：native-codex 的工具循环仍是文本压平，不是原生 tool-result 协议

### 证据

`src/lib/claude-engine/api/native-codex/index.ts` 中：

1. `toNativeCodexMessages(...)` 会把历史消息统一走 `flattenTextBlocks(...)`
2. `flattenTextBlocks(...)` 对：
   - `tool_use`
   - `tool_result`
3. 不是转成结构化消息，而是转成：
   - `<tool-use ...>...</tool-use>`
   - `<tool-result ...>...</tool-result>`

也就是说，后续 turn 里：

- assistant 之前的 tool call
- user 侧回灌的 tool result

都只是普通文本。

配套测试 `src/lib/claude-engine/api/__tests__/native-codex.test.ts` 还把这个行为锁成了当前预期：

- “flattens prior tool interactions before sending them to native-codex”

### 对照

`src/lib/claude-engine/api/openai/convertMessages.ts` 对其他 OpenAI-compatible provider 的处理是：

1. `tool_use` -> `assistant.tool_calls`
2. `tool_result` -> `role: 'tool'` + `tool_call_id`

也就是**结构化工具对话**。

而 native-codex 当前不是。

### 影响判断

这不会让请求“走错 provider”，但会让 Claude Engine 的**多轮工具闭环语义退化**：

1. 第一轮 native-codex 发起工具调用没问题
2. 工具执行后，结果并不是按原生协议继续回灌
3. 后续是否继续稳定使用工具、是否严格对齐 tool-call id、是否可靠消费工具结果，主要变成“模型是否能从 XML 风格文本里自我恢复语义”

这对：

- `review-loop`
- 强 artifact 任务
- 需要多次文件检查/修订/验证的任务

风险都明显更高。

### 严重级别

- **High**

这是一个真实的执行语义断点，不是单纯“模型表现波动”。

---

## 4. Finding C：`requiredArtifacts` 校验时序和平台 envelope 产出时序冲突

### 证据链

#### 1. `department-execution-resolver.ts` 会给非轻任务注入基线 artifacts

当前 `buildRequiredArtifacts(...)` 会把这些路径加入 `runtimeContract.requiredArtifacts`：

- `task-envelope.json`
- `result-envelope.json`
- `artifacts.manifest.json`

其中：

- `workflow-run` 至少要求 `result-envelope.json` + `artifacts.manifest.json`
- 其它 profile 还会再加 `task-envelope.json`

#### 2. `prompt-executor.ts` 在 backend 启动前只写了 `task-envelope.json`

`executePrompt(...)` 中：

1. 先创建 artifact dir
2. 先写：
   - `task-envelope.json`
3. 再 `backend.start(...)`

#### 3. `result-envelope.json / artifacts.manifest.json` 是后置 finalization 才写

同一文件中：

- `writePromptFinalization(...)`

才负责写：

- `result.json`
- `artifacts.manifest.json`
- `result-envelope.json`

并且这个动作发生在：

- `consumeAgentSession(... onCompleted -> finalizePromptRun(...))`

也就是 backend 已经先发出 completed 事件之后。

#### 4. `ClaudeEngineAgentSession.run()` 会在 backend 内先做 `requiredArtifacts` 校验

`src/lib/backends/claude-engine-backend.ts` 中：

1. `engine.chat(prompt)` 结束
2. 立即 `validateRequiredArtifacts(this.runtimeContract.requiredArtifacts)`
3. 若缺失则直接推送 `failed`
4. 只有全部存在才推送 `completed`

### 判断

这意味着：

1. `task-envelope.json` 的时序是对的
2. 但 `result-envelope.json / artifacts.manifest.json` 是平台后置写入，不应在 backend 完成前就要求存在

因此当前链路里，只要 `effectiveRuntimeContract.requiredArtifacts` 包含这些平台 envelope：

- Claude Engine backend 就可能在 finalization 之前先失败

这不是 native-codex 专属 bug，但因为：

1. `native-codex` 现在被 capability registry 提升为 Claude Engine 主链 provider
2. `review-loop`/强约束任务正是最依赖这套 runtime contract 的路径

所以它会直接影响本次审计目标。

### 严重级别

- **Critical**

这是时序层面的硬断点，足以让强任务在 provider 正确命中后仍然失败。

---

## 5. Finding D：capability registry 仍然过早乐观

### 证据

`department-capability-registry.ts` 中：

1. 只要 `native-codex` backend 已经是 Claude Engine 主链
2. 或 backend 暴露了强 Department runtime capabilities
3. 就直接把 `native-codex` 升格成：
   - `runtimeFamily = 'claude-engine'`
   - `supportedExecutionClasses = ['light', 'artifact-heavy', 'review-loop', 'delivery']`

### 判断

这个判断并没有验证：

1. native adapter 是否支持结构化工具结果回放
2. `requiredArtifacts` 是否与 finalization 时序兼容

所以 routing 层现在判断的是：

- “backend 类型已经切换”

不是：

- “review-loop readiness 已真正闭环”

### 严重级别

- **High**

它本身不是执行断点，但会把流量继续送进存在真实断点的路径。

---

## 6. 最小修复建议

### 方案 1：最小风险止血

在 `department-capability-registry.ts` 里，**先不要把 `native-codex` 宣称为 `review-loop` capable**。

最小做法：

1. 保留 `native-codex -> Claude Engine` 主链
2. 但临时移除 `review-loop` 出现在 `supportedExecutionClasses`
3. 或把升级条件改成同时满足：
   - native adapter 结构化 tool-result replay 已完成
   - requiredArtifacts / finalization 时序已打通

优点：

- 改动小
- 可以立即避免 routing 继续把 review-loop 流量打到未完全就绪的路径

### 方案 2：真正补齐 native adapter

在 `src/lib/claude-engine/api/native-codex/index.ts` / `src/lib/bridge/native-codex-adapter.ts` 中：

1. 不再把历史 `tool_use / tool_result` 压平成 XML 文本
2. 改为按 Codex Responses API 的结构化函数调用/函数输出协议继续回灌

这是正确方向，但不是最小改动。

### 方案 3：拆分 backend 级 artifact contract 和平台级 finalization artifact

当前最危险的问题是把平台 envelope 也放进 backend 的 `requiredArtifacts`。

最小修复可以是二选一：

1. `department-execution-resolver.ts` 不再把：
   - `result-envelope.json`
   - `artifacts.manifest.json`
   注入 backend 级 `requiredArtifacts`
2. 或保留它们，但把校验从 `ClaudeEngineAgentSession.run()` 挪到 finalization 之后

在这两者里，更稳的是：

- **平台 envelope 只在 finalization 后校验，不放进 backend 前置验收。**

---

## 7. 最终判断

### 回答用户问题

#### 1. 除 `provider=openai` 外，是否还有断点？

- **有。至少还有两个关键断点。**

#### 2. 会不会让 native-codex 实际不走专用 adapter？

- **不会。当前主链已经会命中 native-codex 专用 adapter。**

#### 3. 会不会继续导致 review-loop 失败？

- **会。**

最关键的不是 provider 命中错误，而是：

1. native adapter 的工具闭环仍是文本压平
2. backend 对平台 envelope 的 artifact 校验时序过早

---

## 8. 本轮验证

执行：

```bash
npm test -- src/lib/claude-engine/api/__tests__/native-codex.test.ts src/lib/agents/department-capability-registry.test.ts src/lib/agents/department-execution-resolver.test.ts src/lib/backends/__tests__/claude-engine-backend.test.ts
```

结果：

- `4 files passed`
- `29 tests passed`

说明：

1. 当前测试覆盖能证明 provider 主链和现有 flatten 行为都被锁定
2. 但现有测试**没有覆盖**“platform envelope 在 backend 完成前就被 requiredArtifacts 强制存在”的时序断点
3. 也没有覆盖“native-codex 用结构化 tool-result replay 跑通 review-loop”的 readiness
