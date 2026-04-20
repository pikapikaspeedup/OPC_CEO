# 云端 API Provider 全面补齐改造计划（2026-04-19）

## 背景

当前系统已经能让以下云端 API Provider 执行核心 run backend：

- `native-codex`
- `claude-api`
- `openai-api`
- `gemini-api`
- `grok-api`
- `custom`

但产品层仍残留大量 `Antigravity IDE / language_server / gRPC / Cascade conversation` 假设，导致：

- backend 能跑
- 前端会话壳、控制壳、诊断壳、模型壳、配置壳不完整

本计划的目标，是按四个改造方向，把“云端 API Provider”从“能执行”提升为“系统级一等公民”。

## 目标

改造完成后，以下能力应成立：

1. 云端 API Provider 都能拥有完整 conversation shell，不再只有 `native-codex` 例外支持。
2. Prompt dispatch / task dispatch 前端不再强依赖运行中的 IDE workspace。
3. Intervention / Diagnose / Resume 等高级能力对云端 API Provider 具备 provider-neutral 路径。
4. 模型、额度、分析、设置页 onboarding 不再默认站在 Antigravity IDE 视角。

## 范围

本轮计划只覆盖以下 4 组改造：

1. `Conversations / CEO Office / conversation shell`
2. `AgentRunsPanel / dispatch UI / workspace gating`
3. `AI Diagnose / intervention / process viewer / provider-neutral control plane`
4. `models / credits / analytics / provider onboarding`

不在本轮范围内：

- IDE-only 能力彻底去除
- Antigravity gRPC 协议层重写
- `codex-old` legacy MCP session 完整迁移
- 账单系统 / 配额系统重做

## 改造总顺序

### 阶段 1：先打通 conversation shell

优先级最高，因为这是当前用户感知最强的缺口。

### 阶段 2：放开 dispatch UI 的 IDE 运行态依赖

否则即使 backend 支持，用户仍然会在前端被错误拦住。

### 阶段 3：补齐 intervention / diagnose / process viewer

这是从“能跑”到“可运营”的关键差异。

### 阶段 4：统一模型 / credits / analytics / onboarding 壳层

这是产品表达与观测统一阶段。

## 工作包 1：云端 API Provider conversation shell 全量补齐

## 目标状态

以下 provider 在 `Conversations / CEO Office` 中都可：

- 新建本地 conversation
- 发送消息
- 查看 transcript
- 出现在 conversation 列表

至少覆盖：

- `native-codex`
- `claude-api`
- `openai-api`
- `gemini-api`
- `grok-api`
- `custom`

## 当前问题

当前本地会话壳只支持：

- `codex`
- `native-codex`

证据：

- `src/lib/local-provider-conversations.ts`
- `src/app/api/conversations/route.ts`

## 计划改造

1. 将“本地 provider conversation”从 `codex/native-codex` 扩展为“所有云端 API Provider”。
2. 把 `local-provider-conversations.ts` 升级为 provider-neutral 的本地 transcript/session 工具层。
3. `POST /api/conversations` 改成：
   - `antigravity` 继续走 Cascade
   - 其余云端 API provider 均创建本地 conversation
4. `POST /api/conversations/:id/send` 改成：
   - 根据 conversation record 的 `provider` 选择对应 backend / executor
5. `GET /api/conversations/:id/steps` 改成：
   - provider-neutral transcript 回放
6. conversation 列表统一合并：
   - `.pb`
   - SQLite conversation sessions
   - 本地 provider transcript 记录

## 关键文件

- `src/lib/local-provider-conversations.ts`
- `src/app/api/conversations/route.ts`
- `src/app/api/conversations/[id]/send/route.ts`
- `src/app/api/conversations/[id]/steps/route.ts`
- `src/lib/bridge/statedb.ts`
- `src/lib/storage/gateway-db.ts`
- `src/app/page.tsx`
- `src/components/sidebar.tsx`

## 验证标准

1. `claude-api/openai-api/gemini-api/grok-api/custom` 均可 `POST /api/conversations -> 200`
2. 发送消息后 `/steps` 返回标准 CORTEX transcript step
3. 左栏能看到本地会话
4. `CEO Office` 不再只对 `native-codex` 有完整会话壳

## 工作包 2：移除 dispatch UI 对运行中 IDE workspace 的硬依赖

## 目标状态

当当前 provider 是云端 API Provider 时，用户应当可以：

- 选择存在的 workspace path
- 不要求其在 Antigravity IDE 中“running”
- 正常发起 dispatch

## 当前问题

`AgentRunsPanel` 当前把：

- `runningWs.length === 0`

当成 dispatch 禁用条件。

这与云端 API provider 的 backend 能力不一致。

## 计划改造

1. 将 workspace 选择逻辑拆成两种能力：
   - IDE runtime required
   - workspace path only
2. 在 dispatch 面板里：
   - 对 `antigravity` 仍要求 running workspace
   - 对云端 API provider 允许选择非 running workspace
3. 更新 warning 文案：
   - 不再笼统显示 `workspaceNotRunning`
   - 改成 provider-aware 提示
4. 检查是否还有其它派发入口复用了同样限制：
   - `quick-task-input`
   - `projects-panel`
   - `ceo command related prompt dispatch forms`

## 关键文件

- `src/components/agent-runs-panel.tsx`
- `src/components/quick-task-input.tsx`
- `src/components/projects-panel.tsx`
- `src/components/ceo-scheduler-command-card.tsx`
- `src/lib/api.ts`
- 如有需要：`src/lib/providers/ai-config.ts`

## 验证标准

1. 当默认 provider 为云端 API provider 且无 running workspace 时，dispatch 按钮不再被错误禁用
2. `antigravity` 路径仍保持原有保护逻辑
3. 用户能清楚知道当前是“云端 API 路径”还是“IDE 路径”

## 工作包 3：把 Diagnose / Intervention / Process Viewer 做成 provider-neutral

## 目标状态

以下高级能力不能再默认要求 Antigravity：

- `AI Diagnose`
- `nudge / retry / restart_role`
- role process viewer
- stage process viewer

## 当前问题

1. `evaluate` 当前硬编码走 `antigravity`
2. `prompt` executor run 不支持 intervention
3. `RoleDetailPanel / StageDetailPanel` 仍偏 `childConversationId + gRPC steps`
4. `shared conversation / supervisor loop` 仍只对 Antigravity 生效

## 计划改造

### 3.1 Evaluate / Diagnose

1. 将 `evaluate` 从硬编码 `getAgentBackend('antigravity')` 改成：
   - 优先使用 run 的 provider/backend
   - 无法 provider-native 评估时，回退到 provider-neutral evaluator backend
2. evaluator prompt 不再写入 Antigravity 专属 annotation 作为必需步骤

### 3.2 Prompt-mode interventions

1. 重新定义 prompt-mode 运行的 intervention 能力矩阵：
   - `cancel`
   - `retry`
   - `restart_role`
   - 对支持 append 的 provider 提供 `nudge`
2. 用 backend capability 来决定是否允许，而不是只按 `executorKind === prompt` 全局拒绝

### 3.3 Process viewer

1. 为 role/stage 级 viewer 增加 provider-neutral transcript/event source
2. 优先来源：
   - run-history
   - backend final events
   - local provider transcript
3. 把“过程查看”从 `childConversationId` 单一来源解耦

### 3.4 Shared conversation / supervisor

1. 明确区分：
   - 当前只 Antigravity 支持
   - 可否对支持 append 的云端 API provider 扩展
2. 至少补：
   - UI 不要误导为全 provider 通用
3. 若实现成本可控：
   - 给 `ClaudeEngineAgentBackend` 类 provider 增加 attach/resume 语义抽象

## 关键文件

- `src/lib/agents/group-runtime.ts`
- `src/app/api/agent-runs/[id]/intervene/route.ts`
- `src/lib/backends/claude-engine-backend.ts`
- `src/lib/backends/builtin-backends.ts`
- `src/components/agent-run-detail.tsx`
- `src/components/role-detail-panel.tsx`
- `src/components/stage-detail-panel.tsx`
- `src/lib/agents/run-history.ts`
- `src/lib/backends/types.ts`

## 验证标准

1. `evaluate` 不再强依赖 Antigravity backend
2. 至少一类云端 API provider run 能执行 `nudge/retry/restart_role` 中的可支持动作
3. role/stage 过程查看对云端 API provider 不再只显示空白或不可用
4. UI 能正确表达哪些高级能力是 provider-limited，哪些是通用能力

## 工作包 4：统一模型 / credits / analytics / onboarding 壳层

## 目标状态

系统中的以下能力要从“Antigravity 视角”转成“provider-aware 视角”：

- 模型选择
- credits / 登录态展示
- analytics
- 第三方 Provider onboarding

## 当前问题

1. `/api/models` 仍完全来自 Antigravity gRPC
2. `/api/analytics` 仍完全来自 Antigravity
3. `/api/me` 里的 credits 仍以 Antigravity connection 为中心
4. 设置页的“第三方 Provider”主入口仍统一压到 `custom`

## 计划改造

### 4.1 models

1. 把 `/api/models` 拆成 provider-aware 结果：
   - Antigravity models
   - Native Codex supported models
   - Claude/OpenAI/Gemini/Grok/custom 的推荐模型目录
2. UI 按当前 provider 展示可用模型，而不是一律显示 Antigravity 列表

### 4.2 me / credits

1. `/api/me` 增加 provider-aware 健康摘要：
   - Antigravity 登录态
   - native-codex OAuth 状态
   - API key set 状态
2. 不再默认把 Antigravity credits 当成系统 credits

### 4.3 analytics

1. 定义 analytics 分层：
   - Antigravity IDE analytics
   - Gateway run analytics
   - provider usage analytics（可逐步补）
2. 避免在 UI 上把 Antigravity analytics 误表示成“系统总体 analytics”

### 4.4 onboarding

1. 设置页不要再把“第三方 Provider”默认收敛成单一 `custom`
2. 给：
   - `openai-api`
   - `gemini-api`
   - `grok-api`
   - `custom`
   - `claude-api`
   - `native-codex`

各自独立的配置与健康展示
3. `custom` 只代表 OpenAI-compatible，而不是所有第三方 provider 的总入口

## 关键文件

- `src/app/api/models/route.ts`
- `src/app/api/me/route.ts`
- `src/app/api/analytics/route.ts`
- `src/components/settings-panel.tsx`
- `src/components/chat-input.tsx`
- `src/app/page.tsx`
- `src/lib/providers/provider-availability.ts`
- `src/lib/providers/provider-inventory.ts`
- 必要时新增 provider catalog helper

## 验证标准

1. 模型列表对当前 provider-aware
2. `/api/me` 不再把 Antigravity credits 当全局唯一视角
3. Analytics 页面至少能区分“IDE analytics”与“Gateway / provider analytics”
4. 设置页能独立配置和表达多个云端 API provider，而不是统一压成 `custom`

## 文档与测试要求

本轮实施时必须同步更新：

- `ARCHITECTURE.md`
- `docs/guide/gateway-api.md`
- `docs/guide/cli-api-reference.md`
- `docs/guide/agent-user-guide.md`
- `docs/PROJECT_PROGRESS.md`

测试至少应补：

- conversations route / send / steps 对非 `native-codex` 云端 API provider 的本地会话测试
- dispatch UI 在非 running workspace 下的 provider-aware 行为测试
- intervention / evaluate 对 provider-neutral 路径的测试
- provider-aware models / me / analytics 接口测试

## 推荐执行方式

建议按 4 个连续 work package 实施，而不是一次性大爆炸：

1. Conversation shell
2. Dispatch UI gating
3. Diagnose + intervention + process viewer
4. Models + credits + analytics + onboarding

每个 work package 都应满足：

1. 代码改完
2. 单测通过
3. 页面验证通过
4. 文档同步完成

## 最终成功标准

当这 4 个工作包全部完成后，系统对“云端 API Provider”的用户感知应变成：

- 不只是 backend 能跑
- 而是从 conversation、dispatch、diagnose、observe、configure 这五个层面都能作为一等公民使用
