# 云端 API Provider 支持缺口审计（2026-04-19）

## 审计口径

本次按统一“云端 API Provider”口径审计以下 provider：

- `native-codex`
- `claude-api`
- `openai-api`
- `gemini-api`
- `grok-api`
- `custom`

不再把 `native-codex` 单独拆成一类。

目标不是审“backend 能不能跑一次 run”，而是审：

- 整个系统功能层面
- 还有哪些地方默认建立在 `Antigravity IDE / language_server / gRPC / Cascade conversation`
- 导致云端 API provider 支持不完整

## 总结

当前系统的真实状态可以概括成一句话：

> **云端 API Provider 的 run backend 已基本打通，但产品壳层、会话壳层、诊断层和 IDE 辅助层仍明显偏 Antigravity。**

按功能域看，至少还有 **9 组主要缺口**。

其中最关键的 4 组是：

1. `Conversations / CEO Office chat` 仍只有 `native-codex` 补了本地会话壳，其它云端 API provider 还没有
2. `Prompt Run / Dispatch` 前端仍把“有运行中的 workspace”当成硬前置条件
3. `AI Diagnose / Evaluate` 仍硬编码走 `antigravity`
4. 高级控制面（cancel / revert / files / process steps / shared conversation / supervisor）大多仍是 gRPC / Antigravity 语义

## 已经相对健康的部分

先说好的，避免误判成“全都不行”。

### 1. Run backend 基本可用

- `POST /api/agent-runs`
- `POST /api/projects`
- `POST /api/scheduler/jobs`
- `POST /api/ceo/command`

这些主调度入口已经能把云端 API provider 送进统一 backend 执行层：

- `src/lib/backends/builtin-backends.ts`
- `src/lib/backends/claude-engine-backend.ts`
- `src/lib/providers/native-codex-executor.ts`

也就是说：

- dispatch / prompt run / scheduler / ceo-command

本身不是当前最大问题。

### 2. Run 级 transcript 回放相对健康

`GET /api/agent-runs/:id/conversation`

现在已经优先读：

- provider transcript
- run-history fallback

所以即使不是 Antigravity conversation，只要 run-history 有 `conversation.message.user/assistant`，Run Detail 里的“查看 AI 对话”通常还能看。

证据：

- `src/app/api/agent-runs/[id]/conversation/route.ts:34-117`
- `src/lib/agents/run-history.ts:1-37`

### 3. Canonical 资产不再依赖 IDE

以下 canonical 入口已经不是 gRPC-only：

- `/api/skills`
- `/api/workflows`
- `/api/rules`

它们现在走：

- `src/lib/agents/canonical-assets.ts`

这对云端 API provider 是加分项。

## 主要缺口

## 1. 会话壳只给 `codex/native-codex` 做了本地分流，其它云端 API provider 仍然没有

### 现状

`POST /api/conversations` 只有两类路径：

1. `antigravity` → Cascade + language_server
2. `codex / native-codex` → 本地 conversation

证据：

- `src/lib/local-provider-conversations.ts:66-87`
  - `isSupportedLocalProvider()` 只认 `codex | native-codex`
- `src/app/api/conversations/route.ts:227-241`
  - 只有 `isSupportedLocalProvider(providerInfo.provider)` 才走本地 conversation
- `src/app/api/conversations/route.ts:246-257`
  - 其它 provider 回退到 `workspace_not_running`

### 影响

这意味着当 provider 是：

- `claude-api`
- `openai-api`
- `gemini-api`
- `grok-api`
- `custom`

时，`Conversations / CEO Office` 左侧聊天壳依然会掉回：

- “必须存在 Antigravity language_server”

也就是说：

- backend 能跑云端 API run
- 但前端 conversation shell 还不能把它们当一等公民

### 判断

这是当前最大的第三方 API 支持缺口之一。

## 2. 会话控制面几乎都还是 gRPC-only

以下 route 仍然直接依赖：

- `getOwnerConnection()`
- gRPC

证据：

- `src/app/api/conversations/[id]/cancel/route.ts`
- `src/app/api/conversations/[id]/proceed/route.ts`
- `src/app/api/conversations/[id]/revert/route.ts`
- `src/app/api/conversations/[id]/revert-preview/route.ts`
- `src/app/api/conversations/[id]/files/route.ts`

这些 route 当前都还是：

- Antigravity conversation 专用控制面

尤其是：

- `cancel`
- `revert`
- `revert-preview`
- `files`

对云端 API provider 没有对应的本地 conversation / transcript / tool-context 实现。

### 影响

即使后续把 `claude-api / openai-api / gemini-api / grok-api / custom` 接进 conversation shell，它们也仍会缺失：

- cancel
- revert
- 文件补全 / `@file`
- artifact proceed

等会话级高级控制。

## 3. `Prompt Run / Dispatch` 前端仍错误要求“workspace 正在运行”

`AgentRunsPanel` 当前仍把 dispatch 可用性绑定到：

- `runningWs.length > 0`

证据：

- `src/components/agent-runs-panel.tsx:414-416`
- `src/components/agent-runs-panel.tsx:600-606`
- `src/components/agent-runs-panel.tsx:619-620`
- `src/components/agent-runs-panel.tsx:778`
- `src/components/agent-runs-panel.tsx:796`
- `src/components/agent-runs-panel.tsx:905`

### 问题

这和 backend 的真实能力已经不一致。

对于云端 API provider，dispatch 一般只需要：

- 一个 workspace path
- 不需要 language_server 正在运行

但 UI 仍然把“运行中的 workspace”作为发起条件。

### 影响

这会让用户产生错误认知：

- “云端 API provider 不能发任务”

实际上很多时候是：

- backend 能跑
- 前端入口把按钮禁了

### 判断

这是当前最典型的“前端壳仍偏 IDE”问题。

## 4. `AI Diagnose / Evaluate` 仍硬编码走 `antigravity`

这是一个非常关键但容易被忽略的问题。

`interveneRun(..., 'evaluate')` 在组运行时里最终会：

- `const evalBackend = getAgentBackend('antigravity')`

证据：

- `src/lib/agents/group-runtime.ts:1302-1305`

同时它还会尝试：

- `annotateSession()` 写 `antigravity.task.*`

证据：

- `src/lib/agents/group-runtime.ts:1332-1341`

### 影响

即使 run 本身来自：

- `claude-api`
- `openai-api`
- `gemini-api`
- `grok-api`
- `custom`
- `native-codex`

`AI Diagnose` 仍然不是“对当前 provider 原生诊断”，而是：

- 拿 Antigravity backend 开一个 supervisor-evaluate session 去做诊断

### 判断

这会导致：

- 产品表达不一致
- 诊断依赖 Antigravity 环境
- “第三方 API provider 全链支持”在高级诊断上并不成立

## 5. Prompt-mode run 仍然不支持 intervention

`POST /api/agent-runs/:id/intervene`

当前明确拒绝：

- `prompt` executor 的 intervention

证据：

- `src/app/api/agent-runs/[id]/intervene/route.ts:30-34`

错误文案直接写着：

- `Prompt-mode runs do not support interventions yet. Use cancel only.`

### 影响

而云端 API provider 很多实际运行路径恰恰更容易落在：

- `prompt` executor

这会导致它们的高级运维能力比 Antigravity 模板/会话路径弱很多。

## 6. Review-loop 的 shared conversation 与 supervisor 仍只对 Antigravity 生效

证据：

- `src/lib/agents/group-runtime.ts:2021`
  - `shared conversation` 只在 `provider === 'antigravity'` 时复用
- `src/lib/agents/group-runtime.ts:2074-2076`
  - `startSupervisorLoop(...)` 只在 `provider === 'antigravity'`
- `src/lib/agents/group-runtime.ts:2085-2089`
  - sharedState 只在 `provider === 'antigravity'` 时保存 author cascade

### 影响

这意味着对于云端 API provider：

- review-loop 可以执行
- 但拿不到：
  - shared conversation token 节省
  - antigravity 风格的 supervisor loop

### 判断

这不是 blocker，但它说明第三方 API provider 的高级 orchestration 还不是“同档次支持”。

## 7. Role / Stage / Process 级查看能力仍明显偏 Antigravity

### Role Detail

`RoleDetailPanel` 打开过程步骤时直接调：

- `api.conversationSteps(role.childConversationId)`

证据：

- `src/components/role-detail-panel.tsx:232-239`
- `src/components/role-detail-panel.tsx:408-429`

但 `/api/conversations/:id/steps` 现在只支持：

- 本地 provider conversation（仅 `codex/native-codex`）
- Antigravity gRPC conversation

证据：

- `src/app/api/conversations/[id]/steps/route.ts:21-27`
- `src/lib/local-provider-conversations.ts:66-87`

因此对：

- `claude-api`
- `openai-api`
- `gemini-api`
- `grok-api`
- `custom`

来说，即使 role 有 session handle，UI 也无法像 Antigravity 一样打开“过程步骤”。

### Agent Run Detail

`agent-run-detail.tsx` 里的 “Open Conversation” 仍依赖：

- `run.childConversationId`

证据：

- `src/components/agent-run-detail.tsx:355-363`

而运行时只有 `antigravity` 才会把：

- `childConversationId`
- `activeConversationId`

写到 run 顶层。

证据：

- `src/lib/agents/group-runtime.ts:331-337`
- `src/lib/agents/group-runtime.ts:366-372`

### 但 Run Transcript 是相对好的

好的一面是：

- `查看 AI 对话`

这条现在读的是 run transcript / run-history fallback，所以对云端 API provider 相对健康。

证据：

- `src/components/agent-run-detail.tsx:388-420`
- `src/app/api/agent-runs/[id]/conversation/route.ts:74-117`

## 8. 模型、额度、分析面板仍然是 Antigravity / gRPC 视角

### `/api/models`

证据：

- `src/app/api/models/route.ts:6-11`

直接：

- `tryAllServers(... grpc.getModelConfigs ...)`

### `/api/analytics`

证据：

- `src/app/api/analytics/route.ts:6-11`

直接：

- `tryAllServers(... grpc.getUserAnalyticsSummary ...)`

### `/api/me`

证据：

- `src/app/api/me/route.ts:6-15`

返回用户 credits 时也还是：

- 先找默认 Antigravity connection
- 再 `grpc.getModelConfigs(...)`

### 影响

这会导致以下 UI 都还是 IDE-first：

- 顶栏 credits / 用户态
- 主聊天 model picker
- Analytics dashboard

也就是说：

- 云端 API provider 可以执行
- 但“模型可见性 / 配额可见性 / 使用统计”没有 provider-aware

## 9. 第三方 Provider onboarding 仍然过度压缩到 `custom`

设置页里的“第三方 Provider”主入口现在写得很明确：

- `统一映射到 custom provider`

证据：

- `src/components/settings-panel.tsx:663-670`

应用动作也同样强制：

- `defaultProvider: 'custom'`
- `layer.provider: 'custom'`

证据：

- `src/components/settings-panel.tsx:489-496`
- `src/components/settings-panel.tsx:499-510`
- `src/components/settings-panel.tsx:845-865`

### 问题

这会带来几个后果：

1. “第三方 Provider”主入口并不真正区分：
   - OpenAI API
   - Gemini API
   - Grok API
   - OpenAI-compatible
2. 只允许：
   - 单个活动 profile
3. 用户虽然在系统里能看到：
   - `openai-api`
   - `gemini-api`
   - `grok-api`

但主 onboarding 流程本身并不把它们当一等入口来配置。

### 判断

这不是执行 blocker，但会让“第三方 API provider 已全面支持”的产品感知打折扣。

## 10. 发现态资产（discovered）仍依赖 IDE

Canonical 资产已经不依赖 IDE，但 discovered 资产仍然依赖：

- `getAllConnections()`
- `grpc.getAllSkills / getAllWorkflows / getAllRules`

证据：

- `src/app/api/skills/discovered/route.ts:8-41`
- `src/app/api/workflows/discovered/route.ts:8-41`
- `src/app/api/rules/discovered/route.ts:8-45`

### 影响

对于纯云端 API provider 模式：

- canonical assets 还能用
- 但 discovered 视图会天然偏空 / 偏弱

这会让：

- 资产浏览
- 自动发现
- IDE 侧扩展能力可见性

仍显著偏 Antigravity。

## 判断：哪些是“应该补”的，哪些是“IDE-only 本来就合理”

### 应该补的

1. `Conversations / CEO Office chat` 对 `claude-api/openai-api/gemini-api/grok-api/custom` 的本地 conversation shell
2. `AgentRunsPanel` 发起 dispatch 不应强绑 running workspace
3. `AI Diagnose / evaluate` 不应硬编码 `antigravity`
4. 会话控制面应给云端 API provider 提供最小可用版本
5. Role / Stage process viewer 需要 provider-neutral 的 transcript / event viewer
6. 模型与 credits 展示需要 provider-aware

### 可以接受为 IDE-only，但现在需要明确隔离表达的

1. `servers / workspaces / launch / kill`
2. discovered 资产
3. gRPC analytics
4. Cascade 级 step 流式观察

问题不在于它们 IDE-only，而在于当前产品壳经常把这些 IDE-only 能力和“系统是否支持第三方 API provider”混在一起。

## 最终结论

当前系统如果用一句话概括：

> **云端 API Provider 在“任务执行 backend”上已经能跑，但在“会话壳、控制壳、诊断壳、模型壳”上还没有完成从 Antigravity IDE 语义向 provider-neutral 语义的切换。**

所以用户会感知成：

- 调度能跑
- 但很多功能“看起来还是 Antigravity 才是完整体验”

这是合理感知，不是错觉。
