# Provider Adapter 与 Execution Tool 收口设计

**日期**: 2026-04-30  
**状态**: 已部分实施 / 持续收口中  
**目标**: 收口当前 `provider / backend / executor / workflow script` 混层问题，为软件自进化主路径建立稳定执行边界。  

> 2026-04-30 更新：
> 1. `native-codex` 的 Claude Engine 文本 / tool 主线已固定走 `pi-ai`，并且已删除 `streamQueryNativeCodex()` 这一层主线 special path。
> 2. `NativeCodexExecutor` 已移除。
> 3. `native-codex` 本地 conversation 已统一切到 `api-provider-conversations` / Claude Engine transcript。
> 4. 当前仍保留的专用 native path 只剩 `native-codex` 图像生成。
> 5. `codex / claude-code` 的直接 backend 已降级为 `Legacy*ManualBackend`，只保留兼容/手工入口语义。
> 6. `client/openai/gemini/grok` 这批直连 provider transport shim 已从 Claude Engine API 子系统移除，不再保留测试专用死实现。

## 1. 这份设计回答什么

这份设计只回答四件事：

1. `native-codex` 为什么曾经看起来像三套东西叠在一起，以及现在已收口到什么程度。
2. `Provider Adapter`、`Claude Engine`、`CLI / workflow script` 应该分别负责什么。
3. 为什么 `Provider Adapter` 必须统一走 `pi-ai`。
4. 后续应该如何收口，避免继续发散出新的 provider/runtime 变体。

这份文档不讨论：

1. 多 CLI 的最终产品配置面。
2. UI 设计。
3. 自进化 proposal / approval / merge gate 状态机。

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

以当前 AI 情报工作室日报定时任务为例，真实运行链已经是：

```text
scheduler
-> executePrompt
-> Prompt Mode 命中 /ai_digest
-> ClaudeEngineAgentBackend('native-codex')
-> workflow runtime preflight/finalize scripts
-> result / verification / knowledge persistence
```

也就是说，当前稳定跑通的业务链已经不是直接靠 `NativeCodexExecutor` 在干活，而是：

1. Scheduler 触发
2. Prompt Executor 编排
3. Claude Engine 驱动 provider
4. workflow scripts 拉上下文、上报、校验

### 2.3 当前真正的结构问题

问题不再是 `native-codex` 主线有没有跑通，而是剩余执行层口径是否还能继续发散：

1. Provider 层必须只承担 `pi-ai` 接入
2. Claude Engine 必须是唯一主线编排层
3. `codex / claude-code` 不能再以 provider/backend 身份重新长出来

因此当前需要继续收口的是：

```text
Provider Adapter = pi-ai
Claude Engine = 主线编排
CLI coder = ExecutionTool
```

## 3. 设计结论

### 3.1 结论一：Claude Engine 主线的 Provider Adapter 必须统一走 `pi-ai`

这是主线硬规则，不是偏好。

后续执行口径：

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

因此后续系统里不应该出现：

1. `codex-cli provider`
2. `claude-code provider`
3. `gemini-cli provider`

它们应该进入一个独立层：

> `Execution Tool`

当前已落地：

1. `ai-config` / Settings Provider 选择面只保留真实 AI provider。
2. `codex / claude-code` 在设置页中单独作为“本机执行工具”展示，不再进入 `defaultProvider / layers / scenes / providerProfiles`。

### 3.3 结论三：workflow script 也不是 Provider

`fetch_context.py`、`report_digest.py`、`build_report.py` 这类脚本本质上也不是 provider 逻辑。

它们属于：

> run-boundary workflow worker

因此它们应该和 CLI coder 一样，被统一视为执行层能力，而不是被塞进 provider adapter 或通用 runtime hook 中持续膨胀。

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

目标结构应明确收成四层：

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

Execution Tool
  - CLI coder
  - workflow preflight worker
  - workflow finalize worker
  - shell / file / MCP-backed execution tools
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

## 6. 当前必须整改的三个点

### 6.1 `native-codex` special path

当前实现已经把 `native-codex` 收回到 `streamQueryViaPi()` 主干；同时 `claude-api / openai-api / gemini-api / grok-api / custom` 的主线 native fallback 也已删除，Claude Engine 主线现在按 `pi-ai only` 处理 API-backed provider。

这是当前最大的不一致点。

整改目标：

1. `Claude Engine` 主线 provider routing 不再把 `native-codex` 排除出 `pi-ai` 主干
2. 如果 `native-codex` 有 provider-specific 差异，只允许作为 `pi-ai` 下方的小型 shim 存在
3. 不允许继续在 Claude Engine provider 层维护第二套独立 message/tool replay 语义

### 6.2 执行工具层的剩余问题

`NativeCodexExecutor` 已移除，但 `codex / claude-code` 仍需继续从“兼容 backend / 手工 API”语义收口到统一的 Claude Engine `ExecutionTool` 心智。

剩余目标：

1. 文档与配置面彻底不再把 CLI coder 叫成 provider/backend
2. 自进化主路径只以 `ExecutionTool` 口径理解本机 CLI coder
3. 手工 `/api/codex*` 入口只保留兼容/调试语义

### 6.3 `workflow-runtime-hooks.ts` 的业务膨胀

当前通用 runtime hook 中已经塞入：

1. `ai_digest`
2. `ai_bigevent`

对应的 preflight / finalize 业务脚本 orchestration。

整改目标：

1. 通用 runtime hook 只保留 hook contract
2. 具体业务逻辑迁移到显式 workflow worker
3. orchestrator 只负责选择和调用 worker，不继续承载业务细节

## 7. 推荐的收口顺序

### Phase 0：冻结规则

立即冻结两条规则：

1. `Claude Engine` 主线上的 `Provider Adapter` 必须统一走 `pi-ai`
2. CLI coder / workflow script 都属于 `Execution Tool`

### Phase 1：收回 `native-codex` provider 主线

目标：

1. 清掉 `native-codex` 在 provider 层的 special mainline
2. 让 Claude Engine 主线统一按 `pi-ai` 语义处理
3. 把目前的 tool replay 不一致记录成显式 blocker，而不是继续混合实现

结果：

1. 已完成
2. `native-codex` 本地 conversation 也已统一切到 Claude Engine transcript
3. `native-codex` 图像生成分支仍保留，不在本阶段内

### Phase 2：清理 `NativeCodexExecutor`

目标：

1. 从主线设计里移除其主运行时含义
2. 删除直连实现，避免继续误导
3. 避免 capability registry 再把它和主线 Department runtime 混淆

结果：

1. 已完成；`NativeCodexExecutor` 已删除

### Phase 3：抽出 workflow worker

目标：

1. `ai_digest` / `ai_bigevent` 的 preflight/finalize 从通用 hook 中拆出
2. 形成统一的 `workflow worker` contract
3. 为后续平台工程部自进化中的其他业务 worker 预留干净接缝

### Phase 4：接入成熟 coding execution tool

这一阶段已完成最小落地，当前约束变成：

> 成熟 CLI coder 进入 `Execution Tool` 层，不进入 Provider 层。

当前状态：

1. Claude Engine `coding / full` toolset 已挂上统一 `ExecutionTool`
2. `ExecutionTool` 统一暴露 `list / run`
3. `codex / claude-code` 的单轮与多轮差异下沉到底层 executor，不再在主线抽象中并列暴露

## 8. 对自进化主路径的直接影响

这次收口不是抽象美化，而是直接影响自进化主路径是否可控。

如果不做这次收口，后续平台工程部会继续遇到：

1. reasoning provider 和 coding executor 语义不清
2. MCP/tool replay 是否生效无法稳定判断
3. workflow 业务脚本持续挤进通用 runtime
4. 新增 CLI coder 时继续长出新的“provider 变体”

如果按本设计收口，后续主路径就会清晰成：

```text
Scheduler / CEO / Project
-> Claude Engine
   -> reasoning via pi-ai-backed provider
   -> execution via execution tools
-> verification / evidence / proposal / approval
```

## 9. 最终裁决

当前架构不是“机制不够”，而是“执行层边界不干净”。

本轮设计正式确定：

1. `Provider Adapter` 只做模型接入，且必须统一走 `pi-ai`
2. `Claude Engine` 是唯一主线编排层
3. `NativeCodexExecutor` 不是主线，只能算兼容直连路径
4. CLI coder 与 workflow script 一律归到 `Execution Tool`
5. 后续整改先收 `native-codex` 主线，再拆 workflow worker，再接成熟 coding tool

这份设计落地后，当前最乱的地方才有机会真正收干净。
