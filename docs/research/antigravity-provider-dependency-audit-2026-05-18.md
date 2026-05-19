# Antigravity Provider Dependency Audit

日期：2026-05-18

## 结论

Antigravity 已经从默认 AI 配置中退出：当前 `~/.gemini/antigravity/ai-config.json` 的 `defaultProvider` 和四层 `layers.*.provider` 都是 `native-codex`。CEO 对话看起来仍默认 Antigravity 的直接原因不是配置读取错误，而是 CEO 入口按 workspace 最新会话自动复用旧的 `antigravity-live` 投影线程。

## CEO 对话根因

- `POST /api/conversations` 新建 CEO 会话时会执行 `resolveProvider('execution', workspacePath)`；当前真实配置解析为 `native-codex`，会创建 `local-native-codex-*`，不要求 Antigravity IDE。
- `GET /api/conversations?workspace=...ceo-workspace` 按 `last_activity_at / updated_at / created_at` 倒序返回会话。
- `refreshOwnerMap()` 会持续把 Antigravity IDE 的 live 会话写入 SQLite projection，`sourceKind='antigravity-live'`，且这类记录通常没有 `provider` 字段。
- CEO 页面原先只拿第一条 CEO workspace 会话作为默认线程；当最新记录是 Antigravity IDE 线程时，后续 send 会因为 `provider` 为空且 ID 不是 `local-*`，回到 Antigravity owner map / language server 路径。

## 当前仍强依赖 Antigravity 的区域

- Runtime / gRPC：`src/lib/bridge/*`、`src/lib/providers/antigravity-executor.ts`、`src/lib/backends/builtin-backends.ts` 仍负责 Language Server、owner map、StartCascade、sendMessage、cancelCascade。
- Conversation 兼容：`src/app/api/conversations/*` 对 Antigravity 会话保留 gRPC 路径，本地 provider 走 `local-*` / transcript 路径。
- 模型与 credits：`src/lib/provider-model-catalog.ts` 和 `src/server/runtime/routes/user.ts` 仍会优先合并 Antigravity runtime 模型/credits，并提示这些指标来自 Antigravity IDE。
- Workspace 启动：`src/server/runtime/routes/workspaces.ts` 和 `src/lib/agents/ceo-environment.ts` 硬编码 Antigravity CLI 与 `~/.gemini/antigravity/*` 工作区。
- 部门 IDE 同步：`src/lib/agents/department-sync.ts` 对 Antigravity 保留 `.agents/rules`、`.agents/workflows` 多文件镜像。
- MCP 对外契约：`src/mcp/server.ts` 的工具命名空间仍以 `antigravity_*` 为主，这是历史外部接口，不等于当前默认 Provider。

## 本轮落地修复

- 新增 `src/lib/ceo-conversation-selection.ts`：根据当前 execution provider 只自动进入同 provider 的 CEO 线程。
- 更新 `src/app/page.tsx`：CEO 自动选线程时读取 `/api/ai-config`，在 `native-codex` 等非 Antigravity 配置下跳过旧 `antigravity-live` 默认线程；如果没有同 provider 的 CEO 线程，则停在欢迎态，由下一条消息创建当前配置对应的新线程。

## 验证

- `npx tsc --noEmit --pretty false`
- `npx vitest run src/lib/ceo-conversation-selection.test.ts src/app/api/conversations/route.test.ts 'src/app/api/conversations/[id]/send/route.test.ts'`
- `npx eslint src/app/page.tsx src/lib/ceo-conversation-selection.ts src/lib/ceo-conversation-selection.test.ts`
- 真实 SQLite 状态验证：当前 `executionProvider=native-codex`，选择函数返回 `local-native-codex-*` CEO Office 线程。
