# CEO Office 新建对话链路审计

日期：2026-04-19

## 审计目标

找出为什么用户在 `CEO Office` 点击左栏 `+` 不能新建 / 调度 CEO，并区分：

1. 左栏 `+` 的 CEO 会话创建链路
2. 右侧 `CEO 下令` 的 `/api/ceo/command` 调度链路
3. 切换到 `native-codex` 后的实际失败点

## 结论摘要

### 1. 左栏 `+` 并不走 `/api/ceo/command`

`src/components/sidebar.tsx` 中 CEO 区域的 `+` 直接调用：

- `api.createConversation('file:///Users/darrel/.gemini/antigravity/ceo-workspace')`

因此左栏 `+` 的职责只是“创建 CEO 聊天会话”，不是直接调 CEO 调度器。

### 2. 当前全局 provider 已经切到 `native-codex`

本机当前配置：

- `~/.gemini/antigravity/ai-config.json`
  - `defaultProvider = native-codex`
  - `layers.executive = native-codex`
  - `layers.management = native-codex`
  - `layers.execution = native-codex`
  - `layers.utility = native-codex`

这意味着 CEO workspace 的默认执行 provider 也会解析到 `native-codex`。

### 3. `/api/conversations` 只给 `codex` 做了免 IDE 分支，没有给 `native-codex`

`src/app/api/conversations/route.ts` 的逻辑是：

- 先强制读取 Antigravity API key
- 再 `resolveProvider('execution', workspacePath)`
- 只有 `provider === 'codex'` 时，才走本地 conversation 创建
- `provider === 'native-codex'` 时不会走本地 provider 分支，而会继续要求 Antigravity language server 在线

因此在“全体系切到 `native-codex`”后，CEO Office 左栏 `+` 实际仍依赖 Antigravity IDE / gRPC 会话。

### 4. 就算会话创建成功，CEO 聊天发送链路仍然不是 `native-codex`

`src/app/api/conversations/[id]/send/route.ts` 只对 `cascadeId.startsWith('codex-')` 做了 provider 本地执行。

普通 Antigravity `cascadeId` 会直接走：

- `getOwnerConnection(cascadeId)`
- `grpc.sendMessage(...)`

也就是说：

- 左栏 `+` 创建出的 CEO 会话只要不是 `codex-*`
- 后续聊天就仍是 Antigravity gRPC 会话
- 并不会自动切到 `native-codex`

### 5. 右侧 `CEO 下令` 是另一条链，而且这条链本身是 provider-aware 的

`src/components/ceo-scheduler-command-card.tsx` 调用 `/api/ceo/command`。

`/api/ceo/command` -> `processCEOCommand()` -> `callLLMOneshot(..., 'executive')`

而 `callLLMOneshot()` 会：

- `resolveProvider('executive', ceoWorkspace)`
- 非 `antigravity` provider 直接走 `getExecutor(provider).executeTask(...)`

因此 `/api/ceo/command` 本身更接近“已经适配 native-codex”，问题主要不在这里。

## 关键失败点

### A. 创建 CEO 会话前就被 Antigravity API key 卡住

文件：

- `src/app/api/conversations/route.ts`

问题：

- `POST /api/conversations` 在任何 provider 分流前，先执行 `getApiKey()`
- 没有 Antigravity API key 就直接 `503`

结果：

- 即使目标 provider 是 `codex` / `native-codex`
- 创建会话仍然先依赖 Antigravity 登录态

### B. `native-codex` 没有 conversation create 分支

文件：

- `src/app/api/conversations/route.ts`

问题：

- 仅 `provider === 'codex'` 才创建本地对话
- `native-codex` 会掉进“必须匹配 language server”的 Antigravity 路径

结果：

- 切到 `native-codex` 后
- CEO Office 左栏 `+` 仍然可能返回 `workspace_not_running`

### C. 前端 `+` 点击没有错误处理，失败时用户看到的是“没反应”

文件：

- `src/components/sidebar.tsx`
- `src/lib/api.ts`

问题：

- CEO 左栏 `+` 只写了 `.then(...)`
- 没有 `.catch(...)`
- `fetchJson()` 对 4xx/5xx 会直接 `throw`

结果：

- `/api/conversations` 一旦 503/500
- UI 不弹错误、不展示 loading、不回退
- 视觉上就是“点了 `+` 没反应”

### D. 自动进入 CEO Office 时也会静默失败

文件：

- `src/app/page.tsx`

问题：

- 进入 `ceo` section 时，如果没有 CEO conversation，会自动调用 `api.createConversation(...)`
- 同样没有对失败做 UI 反馈

结果：

- 首次进入 CEO Office 也可能出现空白聊天面板
- 用户不知道是会话创建失败还是数据加载失败

### E. 会话 send/steps 只给 `codex-*` 前缀做本地 provider 处理

文件：

- `src/app/api/conversations/[id]/send/route.ts`
- `src/app/api/conversations/[id]/steps/route.ts`

问题：

- 特判条件是 `cascadeId.startsWith('codex-')`
- 没有 `native-codex-*` 或其他 provider-aware 分流

结果：

- 即便后续补了 `native-codex` 会话创建
- send/steps 也仍会继续走 Antigravity gRPC，形成半截适配

### F. `/api/conversations` 列表 route 仍偏向 `.pb` 文件真相源

文件：

- `src/app/api/conversations/route.ts`
- `src/lib/bridge/statedb.ts`

问题：

- route 侧手写列表逻辑优先扫 `~/.gemini/antigravity/conversations/*.pb`
- 没直接复用 `statedb.getConversations()` 的完整聚合逻辑

结果：

- 一旦未来 `native-codex` / `codex` conversation 主要存在本地缓存 / SQLite 而不是 `.pb`
- 可能出现“会话创建成功但历史列表不显示”的二次问题

## `/api/ceo/command` 的实际后端分流

`src/app/api/ceo/command/route.ts`：

1. 校验 `command`
2. 读取全部 workspace 部门配置
3. `processCEOCommand(command, departments, { model })`

`src/lib/agents/ceo-agent.ts`：

1. 先 `parseCEOCommandWithLLM()`
2. 若 LLM 成功：
   - `isStatusQuery && !isSchedule` -> `info`
   - `isImmediate && !isSchedule` -> 创建 Ad-hoc Project，并：
     - 有 template -> `executeDispatch()`
     - 无 template -> `executePrompt()`
   - `isSchedule` -> `createScheduledJobFromDraft()`
3. 若 LLM 失败：
   - 只有状态查询保留 regex fallback
   - 其它直接 `report_to_human`

这条链的分流是“playbook + LLM 解析驱动”，不是 CEO Office 左栏 `+` 的创建会话逻辑。

## 测试覆盖缺口

已存在：

- `src/lib/agents/ceo-agent.test.ts`
  - 覆盖 `/api/ceo/command` 的主要 action 分流

缺失：

- `src/app/api/conversations/route.ts`
  - 没有针对 `native-codex` provider 的 createConversation route test
- `src/app/api/conversations/[id]/send/route.ts`
  - 没有针对 `native-codex` conversation send path 的 route test
- `src/app/api/conversations/[id]/steps/route.ts`
  - 没有针对非 Antigravity provider 的 steps persistence test
- `src/components/sidebar.tsx`
  - 没有 CEO `+` 点击失败时的前端交互测试
- `src/app/page.tsx`
  - 没有“进入 CEO section 自动建会话失败”时的 UI 测试

## 最终判断

当前 `CEO Office` 存在明显的双轨问题：

1. 右侧 `CEO 下令` 已基本走 provider-aware 的 CEO command 链
2. 左侧 `+` 和 CEO 聊天区仍是 Antigravity conversation/gRPC 模型

所以在“全体系切到 `native-codex`”后，用户点击 CEO Office 的 `+` 不能新建 / 不能顺畅调度，不是偶发，而是当前代码分流天然不一致导致的。
