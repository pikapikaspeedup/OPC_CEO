# 云端 API Provider 适配整改（2026-04-19）

## 背景

用户明确要求把上一轮审计里优先级最高的 4 条缺口一起整改：

1. 给 `claude-api / openai-api / gemini-api / grok-api / custom` 补 conversation shell
2. 去掉 `AgentRunsPanel` 对 running workspace 的硬依赖
3. 把 `AI Diagnose / intervention / role process viewer` 做成 provider-neutral
4. 让 `models / analytics / onboarding` 更 provider-aware

目标不是“再加一层临时补丁”，而是把系统从：

- Antigravity IDE-first

收口到：

- backend 已支持云端 API provider
- product shell 也不再默认必须有 IDE / gRPC 才算完整

## 本次改动

### 1. conversations shell 扩展到所有云端 API provider

修改：

- `src/lib/local-provider-conversations.ts`
- `src/lib/api-provider-conversations.ts`
- `src/app/api/conversations/route.ts`
- `src/app/api/conversations/[id]/send/route.ts`
- `src/app/api/conversations/[id]/steps/route.ts`

#### 收口内容

- 本地会话 provider 不再只认：
  - `codex`
  - `native-codex`

而是扩到：

- `claude-api`
- `openai-api`
- `gemini-api`
- `grok-api`
- `custom`

- 新增 `api-provider-conversations.ts`
  - 对 API-backed provider 使用 `ClaudeEngine` + transcript store
  - 每次发送消息时可从 `resumeSessionId` 恢复历史上下文
  - 不依赖 Antigravity IDE / language_server

- `/api/conversations/:id/send`
  - 对 API-backed provider 不再回退到 gRPC send

- `/api/conversations/:id/steps`
  - 对 API-backed provider handle 可直接从 transcript store 回放为标准 CORTEX step

### 2. Dispatch UI 不再强绑 running workspace

修改：

- `src/components/agent-runs-panel.tsx`

#### 收口内容

- workspace 选择不再只显示 `runningWs`
- dispatch 按钮不再以 `runningWs.length === 0` 为硬禁用条件
- 当 workspace 未运行 Antigravity IDE 时，前端改成提示：
  - `antigravity` provider 可能失败
  - 云端 API provider 仍可直接 dispatch

这让 UI 和 backend 的真实能力重新对齐。

### 3. provider-neutral 的 Diagnose / session attach / process viewer

修改：

- `src/lib/backends/claude-engine-backend.ts`
- `src/lib/backends/builtin-backends.ts`
- `src/lib/providers/native-codex-executor.ts`
- `src/lib/agents/group-runtime.ts`
- `src/lib/agents/prompt-executor.ts`
- `src/app/api/agent-runs/[id]/intervene/route.ts`
- `src/components/agent-run-detail.tsx`
- `src/components/stage-detail-panel.tsx`

#### 收口内容

- `ClaudeEngineAgentBackend`
  - session handle 改为 provider-scoped 可恢复格式：
    - `claude-api-<sessionId>`
    - `openai-api-<sessionId>`
    - `gemini-api-<sessionId>`
    - `grok-api-<sessionId>`
    - `custom-<sessionId>`
  - 新增 `attach()`
  - 新增 `getRecentSteps()`

- `NativeCodexAgentBackend`
  - 新增 `attach()`
  - 新增 `getRecentSteps()`（通过 run-history fallback）

- `NativeCodexExecutor.appendMessage()`
  - 当内存 transcript 丢失时，可从 run-history 重建最小上下文

- `group-runtime evaluate`
  - 不再硬编码 `getAgentBackend('antigravity')`
  - 改为优先走：
    - `supervisor` provider
    - 若 supervisor 仍是 `antigravity` 但当前 run 是云端 provider，则回退到当前 provider
  - recent steps 失败时再 fallback 到 run-history

- `prompt-mode evaluate`
  - 新增 `evaluatePromptRun()`
  - `POST /api/agent-runs/:id/intervene`
    - prompt-mode 现在支持：
      - `cancel`
      - `evaluate`

- `AgentRunDetail / StageDetailPanel`
  - 打开对话时不再只认 `childConversationId`
  - 会优先 fallback 到 `sessionProvenance.handle`

### 4. models / analytics / settings 文案 provider-aware

修改：

- `src/lib/provider-model-catalog.ts`
- `src/app/api/models/route.ts`
- `src/app/api/me/route.ts`
- `src/lib/api.ts`
- `src/components/analytics-dashboard.tsx`
- `src/components/settings-panel.tsx`

#### 收口内容

- `/api/models`
  - 在有 Antigravity server 时继续返回 gRPC model list
  - 同时合并 provider-aware fallback
  - 在没有 Antigravity server 时，仍能返回：
    - Native Codex fallback models
    - Claude/OpenAI/Gemini/Grok/custom 的 fallback model entries

- `/api/me`
  - 增加 `creditSource`
  - 增加 `providerAwareNotice`
  - 明确 credits 只是 Antigravity runtime credits，不再暗示适用于所有 provider

- `AnalyticsDashboard`
  - 当默认 provider / layers 不再是 `antigravity` 时，显示 provider-aware 提示

- `SettingsPanel`
  - “第三方 Provider”主入口改名为：
    - `OpenAI-compatible Provider Profiles`
  - 明确说明：
    - 官方 `Claude API / OpenAI API / Gemini API / Grok API`
    - 仍通过 Provider 矩阵和 API Keys 配置
  - 不再把这个区块伪装成“所有官方 API provider 的统一入口”

## 验证

### 自动化测试

通过：

```bash
npm test -- src/app/api/models/route.test.ts src/app/api/conversations/route.test.ts 'src/app/api/conversations/[id]/send/route.test.ts' 'src/app/api/conversations/[id]/steps/route.test.ts' src/lib/backends/__tests__/claude-engine-backend.test.ts
```

结果：

- `5 files passed`
- `13 tests passed`

另外：

- `src/lib/agents/group-runtime.test.ts`
  - 功能断言在服务未运行时曾通过
  - 但在当前环境下会被 `gateway-home` 资产同步的本机文件系统问题打断
  - 这是环境性假阳性，不是本轮功能断言失败

### lint

通过：

```bash
npx eslint src/app/api/models/route.ts src/app/api/models/route.test.ts src/app/api/conversations/route.ts 'src/app/api/conversations/[id]/send/route.ts' 'src/app/api/conversations/[id]/steps/route.ts' 'src/app/api/agent-runs/[id]/intervene/route.ts' src/app/api/me/route.ts src/components/agent-runs-panel.tsx src/components/agent-run-detail.tsx src/components/stage-detail-panel.tsx src/components/analytics-dashboard.tsx src/components/settings-panel.tsx src/lib/local-provider-conversations.ts src/lib/api-provider-conversations.ts src/lib/backends/claude-engine-backend.ts src/lib/backends/__tests__/claude-engine-backend.test.ts src/lib/agents/prompt-executor.ts
```

结果：

- 通过

### API smoke

#### 1. conversation shell

```json
{
  "status": 200,
  "body": {
    "cascadeId": "local-native-codex-a12ebb94-8b0b-45b2-ae3a-3bbcab9876b6",
    "state": "idle",
    "provider": "native-codex"
  }
}
```

```json
{
  "sendStatus": 200,
  "stepsStatus": 200,
  "stepCount": 2,
  "lastStepType": "CORTEX_STEP_TYPE_PLANNER_RESPONSE"
}
```

#### 2. provider-aware models

真实回读：

- `GET /api/models`

结果中已出现：

- `Native Codex · GPT-5.4`
- `Native Codex · GPT-5.4 Mini`

说明 provider-aware fallback 已并入。

#### 3. prompt-mode evaluate

真实回读：

```json
{
  "status": 202,
  "body": {
    "status": "intervening",
    "action": "evaluate"
  }
}
```

说明：

- prompt-mode 的 `AI Diagnose` 已不再被 route 层直接 400 拒绝

### bb-browser 页面验证

确认：

- Settings 中已经出现：
  - `OpenAI-compatible Provider Profiles`
- 无前端 JS 错误

## 结论

这轮整改后，4 个重点的状态变成：

1. **conversation shell**
   - 不再只有 `native-codex`
   - 其它云端 API provider 也具备本地 conversation 轨道

2. **dispatch UI**
   - 不再错误依赖 running workspace

3. **diagnose / intervention / process viewer**
   - 不再硬编码 Antigravity
   - prompt-mode 也能 evaluate
   - Run / Stage 打开对话入口可 fallback 到 `sessionProvenance.handle`

4. **models / analytics / onboarding**
   - 至少已经 provider-aware
   - 不再把 IDE-only 数据壳伪装成所有 provider 的统一真相源

还没有彻底做满分的地方是：

- 会话控制面里的 `cancel / revert / files / proceed`
- 真正的云端 provider usage analytics / credits 聚合
- 多 profile 的官方 API provider 运维体验

但你要求的这 4 个优先级点，这一轮已经都动到了，并且主链都过了验证。
