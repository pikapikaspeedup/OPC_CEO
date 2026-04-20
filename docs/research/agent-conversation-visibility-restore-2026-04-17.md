# 项目详情页 AI 对话可见性恢复（2026-04-17）

## 背景

用户指出：

- 当前项目详情页看不到 AI 的对话内容

这次不是“展示位置不合理”，而是存在两层问题：

1. 上一轮 `executiveMode` 收缩时，把对话入口一起藏掉了
2. `native-codex` / `codex` 本身没有像 `antigravity` 一样暴露 `childConversationId` 给前端

导致结果是：

- 用户只能看到结果摘要
- 看不到 AI 与系统的往返内容

## 根因

### 1. UI 层

`AgentRunDetail` 在 `executiveMode` 下默认隐藏：

- `chat` tab
- `Open Conversation`

### 2. Provider 层

`native-codex` 的会话消息虽然在 executor 进程内有保存，但前端没有读取 API。

`antigravity` 可以依赖：

- `childConversationId`

而 `native-codex` / `codex` 只能依赖：

- provider handle
- executor 内部 conversation history

## 本次修复

### 1. 新增 run conversation API

新增：

- `src/app/api/agent-runs/[id]/conversation/route.ts`

返回三类结果：

1. `kind = conversation`
   - 适用于已有 `childConversationId` 的 provider
2. `kind = transcript`
   - 适用于 `native-codex` / `codex`
3. `kind = unavailable`
   - 当前 provider 没有可展示对话时

### 2. provider transcript 支持

修改：

- `src/lib/providers/native-codex-executor.ts`
- `src/lib/providers/codex-executor.ts`

结果：

- 新增可读取 conversation history 的 helper
- `native-codex` / `codex` 都能向 route 暴露基础 transcript

### 3. 历史 run fallback

修改：

- `src/app/api/agent-runs/[id]/conversation/route.ts`

结果：

- 即使内存中的 conversation history 丢失
- 只要 artifact 目录里还保留 `.md` 草稿
- 仍可回退成：
  - `user prompt`
  - `assistant draft`

的可读 transcript

### 4. 详情页恢复 AI 对话入口

修改：

- `src/components/agent-run-detail.tsx`
- `src/lib/api.ts`
- `src/lib/types.ts`

结果：

- 详情页新增：
  - `查看 AI 对话`
- 对于：
  - `antigravity`：可打开完整对话
  - `native-codex` / `codex`：可直接查看 transcript

## 验证

### 通过

- `npx eslint src/components/agent-run-detail.tsx src/components/project-workbench.tsx src/app/api/agent-runs/[id]/conversation/route.ts` ✅

### 真实接口验证

对 run：

- `e06490c0-15ce-4faa-8bc3-b08eccc180fa`

执行：

- `GET /api/agent-runs/e06490c0-15ce-4faa-8bc3-b08eccc180fa/conversation`

返回：

- `status = 200`
- `kind = transcript`
- `provider = native-codex`
- `messageCount = 2`

说明：

- 项目详情页现在已经能看到这条 `native-codex` run 的 AI 对话内容

## 结论

这次修复后，项目详情页不再只有“结果”，而是重新具备了：

- 看结果
- 看 AI 对话

两条路径。

对 `native-codex` 这类没有 IDE conversation id 的 provider，也已经补上 transcript 可见性。
