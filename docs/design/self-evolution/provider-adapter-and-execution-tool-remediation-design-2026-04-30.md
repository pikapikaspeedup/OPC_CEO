# Provider Adapter 与 Execution Tool 收口设计

**日期**: 2026-04-30
**状态**: Provider / ExecutionTool 主线边界已落地；workflow worker 拆分作为独立断点记录
**目标**: 记录 `provider / backend / executor / workflow script` 的当前边界，为主软件自迭代路径保持稳定执行合同。

> 2026-04-30 更新：
> 1. `native-codex` 的 Claude Engine 文本 / tool 主线已固定走 `pi-ai`，并且已删除 `streamQueryNativeCodex()` 这一层主线 special path。
> 2. `NativeCodexExecutor` 已移除。
> 3. `native-codex` 本地 conversation 已统一切到 `api-provider-conversations` / Claude Engine transcript。
> 4. 当前仍保留的专用 native path 只剩 `native-codex` 图像生成。
> 5. `codex / claude-code` 的直接 backend 已降级为 `Legacy*ManualBackend`，只保留兼容/手工入口语义。
> 6. `client/openai/gemini/grok` 这批直连 provider transport shim 已从 Claude Engine API 子系统移除，不再保留测试专用死实现。
> 7. `AIProviderId / ExecutionToolId / AgentBackendId / TaskExecutorId` 已拆分，`getExecutor()` 只接受真正的直接执行器。
> 8. Claude Engine `ExecutionTool` 只包装高权限外部 coder；`shell / file / search / MCP resources` 仍是普通 Claude Engine 工具。

## 1. 这份设计回答什么

这份设计只回答四件事：

1. `native-codex` 为什么曾经看起来像三套东西叠在一起，以及现在已收口到什么程度。
2. `Provider Adapter`、`Claude Engine`、`CLI / workflow script` 应该分别负责什么。
3. 为什么 `Provider Adapter` 必须统一走 `pi-ai`。
4. 当前边界和保留断点如何表述，避免继续发散出新的 provider/runtime 变体。

这份文档不讨论：

1. 多 CLI 的最终产品配置面。
2. UI 设计。
3. 软件自迭代 proposal / approval / merge gate 状态机。

## 2. 当前事实

### 2.1 `native-codex` 曾同时出现在三层

这个问题在 2026-04-30 已完成主收口；历史上它曾同时以三种身份存在：

1. **配置层 transport**
   - `providerProfiles['native-codex'].transport = 'pi-ai'`
   - 文件：`src/lib/providers/ai-config.ts`

2. **部门主线 backend**
   - `native-codex` 被注册成 `new ClaudeEngineAgentBackend('native-codex')`
   - 文件：`src/lib/backends/builtin-backends.ts`

3. **保留直连 executor**
   - 这一层已经移除；`NativeCodexExecutor` 不再存在

当前剩下的结构真相是：

1. `native-codex` 的 provider 主线固定走 `ClaudeEngineAgentBackend + pi-ai`
2. 本地 conversation 也统一走 Claude Engine transcript
3. 专用 native path 只剩图像生成

### 2.2 主线运行事实

当前主线运行链已经收成：

```text
Project / Scheduler / CEO command
-> executePrompt / project run
-> ClaudeEngineAgentBackend('native-codex')
-> Claude Engine orchestration
-> provider reasoning through pi-ai
-> result / verification / evidence persistence
```

也就是说，当前软件自迭代主线不是直接靠 `NativeCodexExecutor` 在干活，而是：

1. Control Plane 触发
2. Project / Prompt Executor 编排
3. Claude Engine 驱动 provider
4. ExecutionTool / runner 执行代码级任务
5. evidence 写回 proposal / project / run

### 2.3 当前真正的结构问题

问题不再是 `native-codex` 主线有没有跑通，而是继续保持执行层口径不再发散：

1. Provider 层必须只承担 `pi-ai` 接入
2. Claude Engine 必须是唯一主线编排层
3. `codex / claude-code` 不能再以 provider/backend 身份重新长出来

当前已经固化的边界是：

```text
Provider Adapter = pi-ai
Claude Engine = 主线编排
CLI coder = ExecutionTool
```

## 3. 设计结论

### 3.1 结论一：Claude Engine 主线的 Provider Adapter 必须统一走 `pi-ai`

这是主线硬规则，不是偏好。

当前执行口径：

1. `Claude Engine` 所承载的 Department / scheduler / prompt-run 主线，其 `Provider Adapter = pi-ai`
2. 不允许主线 provider 再各自维护一条独立 runtime protocol
3. 若某 provider 暂时无法被 `pi-ai` 承接，则该 provider 在主线 Department runtime 中视为暂不支持

边界说明：

1. 这条规则当前已经覆盖 **Claude Engine 主线** 与 `native-codex` 本地 conversation 主链
2. 图像生成仍保留 provider-specific native path
3. 不再保留 `NativeCodexExecutor` 这类直连路径

这条规则成立后，Provider 层只保留：

1. provider 认证
2. model 解析
3. stream / messages / tool schema 归一化
4. provider-native capability 声明

主线 Provider 层不再承担：

1. query loop
2. tool 执行
3. 本地文件读写
4. coding workflow
5. 业务 preflight / finalize

### 3.2 结论二：CLI coder 不是 Provider

`Codex CLI / Claude Code / Gemini CLI` 都不属于 Provider 层。

它们的定位是：

> 被 Claude Engine 调用的高权限执行工具。

因此系统里不应该出现：

1. `codex-cli provider`
2. `claude-code provider`
3. `gemini-cli provider`

它们按独立层处理：

> `Execution Tool`

当前已落地：

1. `ai-config` / Settings Provider 选择面只保留真实 AI provider。
2. `codex / claude-code` 在设置页中单独作为“本机执行工具”展示，不再进入 `defaultProvider / layers / scenes / providerProfiles`。
3. Claude Engine `ExecutionTool` 统一包装 `Codex CLI / Claude Code CLI` 这类高权限外部 coder。
4. `shell / file / search / MCP resources` 仍是 Claude Engine 普通工具，不属于 `ExecutionTool`。

### 3.3 结论三：workflow script 也不是 Provider

`fetch_context.py`、`report_digest.py`、`build_report.py` 这类脚本本质上也不是 provider 逻辑。

它们属于：

> run-boundary workflow worker

因此它们和 CLI coder 一样属于执行层能力，而不是 provider adapter。它们与代码级 `ExecutionTool` 的区别是调用边界不同：workflow script 是 run-boundary worker，CLI coder 是 Claude Engine loop 内可调用的高权限 coder。

补充区分：

1. CLI coder 更像 `in-loop execution tool`
2. workflow script 更像 `run-boundary worker`

两者都不属于 Provider，但调用时机不同，不应混写成同一类运行时角色。

### 3.4 结论四：Claude Engine 是唯一编排主线

Claude Engine 继续承担：

1. run lifecycle
2. memory / knowledge 注入
3. tool permission
4. transcript / retry
5. evidence / result 协调
6. 执行工具调用

它是 orchestrator，不是 provider，也不是业务脚本集合。

## 4. 目标分层

当前结构明确收成四层：

```text
Control Plane
  - Project / Run / Scheduler / Proposal / Approval / Knowledge / Ops

Claude Engine Orchestrator
  - loop
  - permission
  - transcript
  - memory/knowledge injection
  - evidence coordination

Provider Adapter
  - pi-ai only
  - model/auth/stream/tool schema normalization

Execution Layer
  - ExecutionTool: Codex CLI / Claude Code CLI 等高权限外部 coder
  - Workflow worker: preflight / finalize 等 run-boundary 业务脚本
  - Ordinary Claude Engine tools: shell / file / search / MCP resources
```

## 5. 对当前三者关系的正式定义

### 5.1 `providerProfiles['native-codex'].transport = 'pi-ai'`

这是**协议层约束**。

它表达的是：

> `native-codex` 作为模型接入时，标准 transport 必须是 `pi-ai`。

### 5.2 `ClaudeEngineAgentBackend('native-codex')`

这是**运行时主线绑定**。

它表达的是：

> Department / prompt / scheduler 主线任务，应该由 Claude Engine 编排，再通过 `native-codex` provider 推理。

### 5.3 这三者最终已经收成的关系

当前关系已经收成：

```text
ClaudeEngineAgentBackend('native-codex')
-> Provider Adapter (pi-ai)
-> native-codex model
```

额外的 provider-specific native path 只保留给图像生成，不再承担文本 / tools / 本地 conversation 主线。

## 6. 已落地边界与保留断点

### 6.1 `native-codex` special path 已收回

当前实现已经把 `native-codex` 收回到 `streamQueryViaPi()` 主干；同时 `claude-api / openai-api / gemini-api / grok-api / custom` 的主线 native fallback 也已删除，Claude Engine 主线现在按 `pi-ai only` 处理 API-backed provider。

当前状态：

1. `Claude Engine` 主线 provider routing 不再把 `native-codex` 排除出 `pi-ai` 主干
2. 如果 `native-codex` 有 provider-specific 差异，只允许作为 `pi-ai` 下方的小型 shim 存在
3. 不允许继续在 Claude Engine provider 层维护第二套独立 message/tool replay 语义

### 6.2 执行工具层已按当前语义收口

`NativeCodexExecutor` 已移除；`codex / claude-code` 的主线语义已经从“兼容 backend / 手工 API”收口到 Claude Engine `ExecutionTool`。

当前状态：

1. 文档与配置面彻底不再把 CLI coder 叫成 provider/backend
2. 软件自迭代主路径只以 `ExecutionTool` 口径理解本机 CLI coder
3. 手工 `/api/codex*` 入口只保留兼容/调试语义
4. `LegacyCodexManualBackend / LegacyClaudeCodeManualBackend` 只保留兼容/手工入口含义

### 6.3 `workflow-runtime-hooks.ts` 仍是独立架构断点

当前通用 runtime hook 中仍承载部分业务 workflow 的 preflight / finalize 脚本 orchestration。

这个断点不再影响 Provider / ExecutionTool 主线边界结论，但后续迁移时必须保持：

1. 通用 runtime hook 只保留 hook contract
2. 具体业务逻辑迁移到显式 workflow worker
3. orchestrator 只负责选择和调用 worker，不继续承载业务细节

## 7. 当前落地结果

1. `Claude Engine` 主线上的 `Provider Adapter` 统一走 `pi-ai`。
2. `native-codex` 文本 / tool / 本地 conversation 主线已经收回到 Claude Engine transcript；图像生成仍保留 provider-specific native path。
3. `NativeCodexExecutor` 已删除；`codex / claude-code` 只作为 `ExecutionTool` 或 legacy manual path 存在。
4. Claude Engine `coding / full` toolset 已挂上统一 `ExecutionTool`。
5. `ExecutionTool` 统一暴露 `list / run`；`codex / claude-code` 的单轮与多轮差异下沉到底层 executor。
6. Provider / backend / executor 的类型边界已拆开，主线不再把 model provider 和 CLI coder 混成同一个概念。
7. `workflow-runtime-hooks.ts` 的业务 worker 拆分仍作为独立断点，不归入本文件的 Provider / ExecutionTool 主线边界。

## 8. 对软件自迭代主路径的直接影响

这次收口不是抽象美化，而是直接影响软件自迭代主路径是否可控。

如果不做这次收口，后续平台工程部会继续遇到：

1. reasoning provider 和 coding executor 语义不清
2. MCP/tool replay 是否生效无法稳定判断
3. workflow 业务脚本持续挤进通用 runtime
4. 新增 CLI coder 时继续长出新的“provider 变体”

按当前落地边界，主路径已经清晰成：

```text
Scheduler / CEO / Project
-> Claude Engine
   -> reasoning via pi-ai-backed provider
   -> execution via execution tools
-> verification / evidence / proposal / approval
```

## 9. 最终裁决

当前架构不是“机制不够”，而是“执行层边界不干净”。

本文件正式记录当前裁决：

1. `Provider Adapter` 只做模型接入，且必须统一走 `pi-ai`
2. `Claude Engine` 是唯一主线编排层
3. `NativeCodexExecutor` 已删除
4. CLI coder 通过 Claude Engine `ExecutionTool` 承接
5. workflow script 是 run-boundary worker，不是 Provider，也不是代码级 `ExecutionTool`
6. `codex / claude-code` backend 只保留 legacy manual path 语义

本文件只记录 Provider / ExecutionTool 的当前边界；若要拆 `workflow-runtime-hooks.ts`，应作为 workflow worker 独立设计与实施。
