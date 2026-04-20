# Codex Native 前端入口 / API 依赖审计

日期：2026-04-19

## 结论摘要

- 按“前端直接依赖的 route”口径，至少有 **12 条接口对 `native-codex` 明显不兼容或仍是旧 `codex` 路径**：
  - `/api/conversations`
  - `/api/conversations/[id]/send`
  - `/api/conversations/[id]/steps`
  - `/api/conversations/[id]/cancel`
  - `/api/conversations/[id]/proceed`
  - `/api/conversations/[id]/revert`
  - `/api/conversations/[id]/revert-preview`
  - `/api/conversations/[id]/files`
  - `/api/codex`
  - `/api/codex/sessions`
  - `/api/codex/sessions/[threadId]`
  - `/api/models`（不是 Codex route，但聊天前端仍依赖它）
- 按“前端功能入口”口径，**最明显受影响的是 8 组入口**：
  - Conversations 主聊天入口
  - CEO Office 自动打开对话
  - CEO Office `+` 新建对话
  - Chat 内发送 / 步骤回放 / 撤回 / 继续 / 取消 / 文件补全
  - Run Detail 的“打开 Conversation”
  - Role / Stage Detail 的过程步骤与 Conversation 打开
  - Ops 里的 Codex Widget
  - AI Diagnose / shared conversation 等高级交互
- 相对健康的链路是：**项目派发、prompt run、scheduler job、job -> run 列表、run transcript 回放**。这些走 `/api/agent-runs*`，后端已经有 `native-codex` backend / executor。

## 关键根因

### 1. “对话”前端仍以 Antigravity / 旧 Codex 会话模型为中心

- `src/app/page.tsx`、`src/components/sidebar.tsx`、`src/components/chat-input.tsx` 这套 UI 仍围绕：
  - `createConversation()`
  - `conversationSteps()`
  - `sendMessage()`
  - `cancel()/proceed()/revert()`
- 而 `src/app/api/conversations/*` 只对两种会话做了明确支持：
  - `cascadeId` -> Antigravity gRPC
  - `codex-*` -> 旧 `codex` CLI / MCP 本地会话
- **没有 `native-codex` 的 conversation create / send / steps / controls 分支。**

### 2. Native Codex 在运行链路里是“run/session”，不是“conversation/cascade”

- `src/lib/providers/native-codex-executor.ts`、`src/lib/backends/builtin-backends.ts` 已实现 `native-codex` 的执行和 transcript 记忆。
- 但 `src/lib/backends/run-session-hooks.ts`、`src/lib/agents/prompt-executor.ts`、`src/lib/agents/group-runtime.ts` 只会给 `antigravity` 绑定 `childConversationId`。
- 结果是：
  - `native-codex` run 能跑
  - `run transcript` 能看
  - 但主聊天 UI / CEO 聊天 UI 看不到对应 conversation

### 3. 仓库里还保留一整套旧 Codex MCP 路径

- `src/components/codex-widget.tsx`
- `src/app/api/codex/route.ts`
- `src/app/api/codex/sessions/route.ts`
- `src/app/api/codex/sessions/[threadId]/route.ts`
- `src/lib/providers/codex-executor.ts`

这套仍然是：

- `codex exec`
- `codex mcp-server`
- `codex-reply`

不是 `native-codex`。

## 分入口审计

### A. 设置 / Provider 配置

#### 1. Settings Panel

- 前端：
  - `src/components/settings-panel.tsx:552-623`
  - `src/components/settings-panel.tsx:1366-1421`
  - `src/components/settings-panel.tsx:2047-2070`
- API：
  - `GET/PUT /api/ai-config` -> `src/app/api/ai-config/route.ts:7-37`
  - `GET /api/api-keys` -> `src/app/api/api-keys/route.ts:7-9`
- Provider 层：
  - `src/lib/providers/provider-availability.ts:24-66`
  - `src/lib/providers/provider-inventory.ts:55-87`
  - `src/lib/providers/ai-config.ts:34-45`

结论：

- **基本兼容。**
- 前端已经能选择 `native-codex`，后端也会校验 availability。
- 但默认配置仍是 `antigravity` 基线：`src/lib/providers/ai-config.ts:34-42`。

#### 2. Department Setup Dialog

- 前端：
  - `src/components/department-setup-dialog.tsx:520-544`
- 数据模型：
  - `src/lib/types.ts:96-110`

结论：

- **基本兼容。**
- 部门级 provider 已支持 `native-codex`。

### B. 主聊天 / Conversations

#### 3. Conversations 列表

- 前端：
  - `src/components/sidebar.tsx:183-205`
  - `src/app/page.tsx:320-337`
- API：
  - `GET /api/conversations` -> `src/app/api/conversations/route.ts:26-117`
- 相关状态源：
  - `src/lib/bridge/statedb.ts:102-215`

结论：

- **明显不兼容。**
- `route.ts` 自己只扫描 `~/.gemini/antigravity/conversations/*.pb`：`src/app/api/conversations/route.ts:33-40`
- 虽然它读了 `getConversations()` 的 SQLite / local cache 结果，但只拿来补充 `.pb` 文件元数据：`src/app/api/conversations/route.ts:44-46, 66-100`
- `getConversations()` 本身其实会合并 local cache：`src/lib/bridge/statedb.ts:148-157`
- 也就是说：
  - **旧 codex 本地会话都可能不稳定出现在列表里**
  - `native-codex` 本来就不会产生 `.pb`，因此这条列表链天然看不到它

#### 4. 新建对话

- 前端：
  - `src/app/page.tsx:305-317`
  - `src/components/sidebar.tsx:325-338, 480-487`
- API：
  - `POST /api/conversations` -> `src/app/api/conversations/route.ts:120-274`
- Provider 解析：
  - `src/app/api/conversations/route.ts:198-208`
  - `src/lib/providers/ai-config.ts:196-220`

结论：

- **明显不兼容。**
- route 一进来先强依赖 Antigravity API key：`src/app/api/conversations/route.ts:122-123`
- 之后只对 `provider === 'codex'` 做特殊分支：`src/app/api/conversations/route.ts:201-208`
- **没有 `provider === 'native-codex'` 分支**
- 如果整个部门/系统已经切到 `native-codex`，这里仍会继续走 Antigravity language server 分支：`src/app/api/conversations/route.ts:210-269`
- 结果只会出现两种情况：
  - 没有 Antigravity server -> `workspace_not_running`
  - 有 Antigravity server -> 创建的是 Antigravity conversation，而不是 Native Codex conversation

#### 5. 发送消息

- 前端：
  - `src/app/page.tsx:341-371`
- API：
  - `POST /api/conversations/[id]/send` -> `src/app/api/conversations/[id]/send/route.ts:13-156`

结论：

- **明显不兼容。**
- 仅支持：
  - `cascadeId.startsWith('codex-')` -> 旧 Codex executor：`src/app/api/conversations/[id]/send/route.ts:30-80`
  - 其他 -> Antigravity gRPC：`src/app/api/conversations/[id]/send/route.ts:84-156`
- **没有 `native-codex` 会话 send 分支。**

#### 6. 步骤回放

- 前端：
  - `src/app/page.tsx:227-243`
- API：
  - `GET /api/conversations/[id]/steps` -> `src/app/api/conversations/[id]/steps/route.ts:12-58`

结论：

- **明显不兼容。**
- 仅支持：
  - `codex-*` 本地 `.codex.json`
  - Antigravity gRPC `getTrajectorySteps`
- **没有 `native-codex` steps 真相源。**

#### 7. Conversation 控制类接口

- 前端：
  - `src/app/page.tsx:374-451`
  - `src/components/chat-input.tsx:153-176`
- API：
  - `POST /api/conversations/[id]/cancel` -> `src/app/api/conversations/[id]/cancel/route.ts:6-15`
  - `POST /api/conversations/[id]/proceed` -> `src/app/api/conversations/[id]/proceed/route.ts:6-16`
  - `POST /api/conversations/[id]/revert` -> `src/app/api/conversations/[id]/revert/route.ts:6-16`
  - `GET /api/conversations/[id]/revert-preview` -> `src/app/api/conversations/[id]/revert-preview/route.ts:6-18`
  - `GET /api/conversations/[id]/files` -> `src/app/api/conversations/[id]/files/route.ts:11-59`

结论：

- **明显不兼容。**
- 上面 5 条 route 全部依赖 `getOwnerConnection()` / gRPC。
- 也就是：
  - cancel / proceed / revert / revert-preview 全是 Antigravity conversation 控制面
  - 文件补全也要求 conversation owner，可见 `src/app/api/conversations/[id]/files/route.ts:16-20`
- 对 `native-codex` 会话并不存在对应实现。

### C. CEO Office

#### 8. CEO Office 自动打开历史对话

- 前端：
  - `src/app/page.tsx:320-337`
  - `src/components/sidebar.tsx:396-398, 512-529`
- API：
  - `GET /api/conversations`
  - `POST /api/conversations`

结论：

- **明显不兼容。**
- CEO Office 当前完全依赖 `conversations` 体系。
- 因为 `native-codex` 不会产生可列举 conversation，而 `POST /api/conversations` 也没有 native 分支，所以：
  - 你看不到 CEO 历史线程
  - 自动进入 CEO 会话会失败或退回 Antigravity

#### 9. CEO Office 右上 `+` 新建对话

- 前端：
  - `src/components/sidebar.tsx:443-459`
- API：
  - `POST /api/conversations` -> `src/app/api/conversations/route.ts:120-274`

结论：

- **这就是你说的第二个问题的直接根因。**
- 按钮点击后只会调 `api.createConversation('.../ceo-workspace')`
- 后端没有 native-codex createConversation 分支，所以 CEO `+` 并不能创建 Native Codex CEO 对话。

#### 10. CEO Scheduler Command Card

- 前端：
  - `src/components/ceo-scheduler-command-card.tsx:61-83`
  - `src/components/ceo-dashboard.tsx:217-226`
- API：
  - `POST /api/ceo/command` -> `src/app/api/ceo/command/route.ts:40-56`
- 执行层：
  - `src/lib/agents/llm-oneshot.ts:38-59`

结论：

- **相对兼容。**
- 这条不是 conversation UI，而是 CEO 命令直达后端。
- `callLLMOneshot()` 对 `provider !== 'antigravity'` 会直接走 provider executor：`src/lib/agents/llm-oneshot.ts:49-59`
- 所以 CEO 指令卡比 CEO 聊天窗更接近真正的多 provider / native-codex 路径。

### D. 项目 / Prompt Run / Scheduler

#### 11. 项目派发、Prompt Run、Scheduler 触发

- 前端：
  - `src/components/projects-panel.tsx:431-440`
  - `src/components/projects-panel.tsx:850-857`
  - `src/components/projects-panel.tsx:892-898`
  - `src/components/projects-panel.tsx:1051-1102`
  - `src/components/agent-runs-panel.tsx:480-521`
  - `src/components/scheduler-panel.tsx:168-189, 205-241, 281-340`
  - `src/components/ceo-dashboard.tsx:55-71`
  - `src/components/projects-panel.tsx:200-209`
- API：
  - `POST /api/agent-runs` -> `src/app/api/agent-runs/route.ts:12-77`
  - `GET /api/agent-runs` -> `src/app/api/agent-runs/route.ts:80-103`

执行层证据：

- `src/lib/agents/prompt-executor.ts:294-405`
- `src/lib/agents/group-runtime.ts:900-1085`
- `src/lib/backends/builtin-backends.ts:923-934, 1157-1166`
- `src/lib/providers/native-codex-executor.ts:102-214`

结论：

- **这一组整体是兼容的。**
- `agent-runs` 路由不是 conversation 模型，而是真正的 run/backend 模型。
- `native-codex` backend 已注册，并能被 `resolveProvider()` 命中。
- Scheduler / Projects / Prompt Run 当前最靠谱的 Native Codex 入口就是这一组。

#### 12. Run Detail 的“查看 AI 对话”

- 前端：
  - `src/components/agent-run-detail.tsx:213-238`
  - `src/components/agent-run-detail.tsx:388-439`
- API：
  - `GET /api/agent-runs/[id]/conversation` -> `src/app/api/agent-runs/[id]/conversation/route.ts:68-137`

结论：

- **兼容。**
- 这个面板已经支持：
  - Antigravity conversation 引用
  - `native-codex` transcript
  - 旧 `codex` transcript
  - run-history fallback

#### 13. Run Detail / Role Detail / Stage Detail 的“打开 Conversation / View Process Steps”

- 前端：
  - `src/components/agent-run-detail.tsx:355-363, 447-457`
  - `src/components/role-detail-panel.tsx:232-245, 409-429`
  - `src/components/stage-detail-panel.tsx:429-435`
- 后端约束：
  - `src/lib/backends/run-session-hooks.ts:50-82`
  - `src/lib/agents/prompt-executor.ts:395-403`
  - `src/lib/agents/group-runtime.ts:1055-1060`

结论：

- **降级 / 部分不兼容。**
- `childConversationId` 只会绑定给 `antigravity`：
  - 默认绑定集合只有 `['antigravity']`
  - prompt/template run 也明确只传 `bindConversationHandleForProviders: ['antigravity']`
- 所以：
  - Native Codex run 可以在 transcript 面板里看内容
  - 但很多“打开 conversation”“过程步骤抽屉”类入口不会有数据源

### E. 旧 Codex / Native Codex 混用残留

#### 14. Ops 里的 Codex Widget

- 前端：
  - `src/components/codex-widget.tsx:25-64`
- API：
  - `POST /api/codex` -> `src/app/api/codex/route.ts:33-81`
  - `POST /api/codex/sessions` -> `src/app/api/codex/sessions/route.ts:35-97`
  - `POST /api/codex/sessions/[threadId]` -> `src/app/api/codex/sessions/[threadId]/route.ts:25-75`
- 实现：
  - `src/lib/providers/codex-executor.ts:87-210`

结论：

- **旧路径，不是 Native Codex。**
- 这整个 widget 仍然是 `codex exec` / `codex mcp-server`。
- 如果你的目标是“整个体系全部切到 Codex Native”，这里属于**明显残留的 codex-old 前端入口**。

#### 15. 聊天页模型选择

- 前端：
  - `src/app/page.tsx:71, 105-118, 345-361`
- API：
  - `GET /api/models` -> `src/app/api/models/route.ts:6-12`
- 兼容映射：
  - `src/lib/bridge/native-codex-adapter.ts:40-54`

结论：

- **半兼容。**
- 聊天页模型列表完全来自 Antigravity gRPC 的 `/api/models`。
- 但 `native-codex` executor 内部确实会把 `MODEL_PLACEHOLDER_M26` 等映射成 `gpt-5.4`：`src/lib/bridge/native-codex-adapter.ts:47-54`
- 所以：
  - 在 `agent-runs` 链路里，这些占位模型还能被兜底映射
  - 在 conversation/chat UI 里，这套模型选择仍然是 Antigravity 视角，不是 Native Codex 原生模型 UX

#### 16. Shared Conversation / AI Diagnose / Cancel

- 前端：
  - shared toggle: `src/components/agent-runs-panel.tsx:373, 877-890`
  - AI Diagnose: `src/components/agent-run-detail.tsx:333-353`
- 后端：
  - shared conversation 仅 Antigravity 重用：`src/lib/agents/group-runtime.ts:2018-2023, 2085-2090`
  - diagnose 强绑 Antigravity：`src/lib/agents/group-runtime.ts:1302-1341`
  - native-codex cancel 是 no-op：`src/lib/providers/native-codex-executor.ts:285-289`
  - codex cancel 也是 no-op：`src/lib/providers/codex-executor.ts:190-194`

结论：

- **高级交互仍然有明显 Antigravity 偏置。**
- `shared conversation` 这个前端开关，对非 Antigravity provider 基本没有真正复用语义。
- `AI Diagnose` 仍是 Antigravity supervisor 会话，不是 Native Codex 自诊断。
- `Cancel` 在 native-codex/codex 上会改 run 状态，但不能真正中止底层请求。

## 直接回答用户的两个现象

### 1. “看不到 Antigravity 作为 IDE 与 AI 中心的对话”

根因不是单点，而是三层叠加：

1. `native-codex` 没有 conversation/cascade create route
2. `/api/conversations` 列表以 `.pb` 为中心，不会正常枚举 native/local-only conversation
3. 前端 Sidebar / CEO Office 又完全依赖这套 `conversations` 列表

### 2. “CEO Office 点 + 不能新建对话调度 CEO”

根因很明确：

1. `+` 按钮只会调 `POST /api/conversations`
2. `POST /api/conversations` 只特判旧 `codex`
3. `native-codex` 没有对应分支，最终落回 Antigravity language server 逻辑

## 建议优先级

### P0

- 给 `/api/conversations` 增加 `native-codex` 的 create / list / send / steps / controls 设计，或者明确关闭这套聊天入口，仅保留 `agent-runs` / CEO command card
- 统一决定“Native Codex 的真相源是 conversation 还是 run transcript”

### P1

- 清理 `/api/codex*` 与 `CodexWidget`，避免继续把旧 Codex MCP 当成 Native Codex
- 让 Sidebar / CEO Office 历史不再只依赖 `.pb`

### P2

- 将 shared conversation / evaluate / cancel 这些高级交互从 Antigravity 特性中拆出来，做 provider-aware 能力降级
