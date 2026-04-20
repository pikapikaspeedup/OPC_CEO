# SQLite 主库收口 + Provider Run History 接入

日期：2026-04-18

## 目标

完成三件事：

1. `run-history.jsonl` 接入 provider 级运行事件
2. `deliverables` 切到 SQLite 主路径
3. 去掉运行时对旧 JSON registry 的剩余兼容依赖

## 本次实现

### 1. Provider Run History

新增/补强的统一事件落盘：

- `run.created`
- `run.status_changed`
- `workflow.preflight.started/completed`
- `workflow.finalize.started/completed`
- `session.started/live_state/completed/failed/cancelled`
- `conversation.message.user`
- `conversation.message.assistant`
- `result.discovered`
- `artifact.discovered`
- `verification.discovered`
- `provider.step`
- `provider.text_delta/tool_start/tool_end/completed/failed`

关键接入点：

- `src/lib/backends/run-session-hooks.ts`
- `src/lib/agents/run-events.ts`
- `src/lib/backends/builtin-backends.ts`
- `src/lib/providers/antigravity-executor.ts`
- `src/lib/providers/codex-executor.ts`
- `src/lib/providers/native-codex-executor.ts`
- `src/lib/providers/claude-code-executor.ts`
- `src/lib/backends/claude-engine-backend.ts`

### 2. Provider 差异化落盘方式

#### Antigravity 原生执行器

- 会话来源：IDE 原生 conversation / step stream
- 真实 handle：`cascadeId`
- 过程来源：`watchConversation()` + gRPC step 流
- 本次补齐：将 step 流增量写入 `provider.step`
- 结果来源：`session.completed` + workflow finalize + artifact scan

#### 第三方执行器（Codex / Native Codex / Claude Code / API）

- 会话来源：Gateway 自管 session / transcript
- 真实 handle：provider thread id / synthetic session handle
- 过程来源：executor append / stream event / tool call
- 本次补齐：user / assistant / tool / completed 事件统一进入 `run-history.jsonl`
- 不再依赖 IDE conversation store 才能回放

结论：

- `Antigravity` 的强项是 IDE 原生 step watch
- 第三方 provider 的强项是 Gateway 可完全控制 transcript 与 event schema
- 统一层不再是“conversation store”，而是 `run-history.jsonl`

### 3. Deliverables SQLite 化

数据表：

- `deliverables`

读写路径：

- `src/lib/storage/gateway-db.ts`
- `src/app/api/projects/[id]/deliverables/route.ts`

现在 `GET /api/projects/:id/deliverables` 的行为：

- 先按项目把 runs 的 `outputArtifacts` 同步到 SQLite
- 再从 SQLite 返回 deliverables

这意味着：

- prompt-only 项目
- 第三方 Codex 项目
- 历史迁移项目

都不再依赖前端 fallback 才能看到交付物。

### 4. 旧 JSON registry 兼容收口

当前运行时主路径已经切到：

- `storage.sqlite`
- `run-history.jsonl`

旧文件现在只保留给：

- 一次性迁移脚本
- 迁移后备份归档

`src/lib/agents/gateway-home.ts` 已明确标注：

- `projects.json`
- `agent_runs.json`
- `local_conversations.json`
- `scheduled_jobs.json`

仅作为 legacy import source，不再是运行时真相源。

## 实际验证

### 1. 迁移回跑

执行：

```bash
npx tsx scripts/migrate-storage-to-sqlite.ts
```

结果：

- `projects = 144`
- `runs = 192`
- `conversations = 102`
- `scheduledJobs = 1`
- `deliverables = 8`

最新 backup：

- `~/.gemini/antigravity/gateway/legacy-backup/2026-04-17T22-53-38-544Z`

### 2. 真实 Antigravity smoke

真实 run：

- `runId = 73163290-593d-41e3-9339-226d7783f39d`
- `provider = antigravity`
- `status = completed`

执行结果：

- 产出 `smoke-note.md`
- `artifactCount = 1`
- `historyCount = 44`

关键 event types：

- `provider.dispatch`
- `provider.step`
- `session.started`
- `session.live_state`
- `workflow.finalize.started`
- `workflow.finalize.completed`
- `result.discovered`
- `artifact.discovered`
- `session.completed`
- `conversation.message.assistant`

补充验证：

- `provider.step count = 8`

说明新的 `run-history.jsonl` 已经不只是摘要，而是能回放真实的 provider 运行过程。

### 3. Deliverables API 回读

项目：

- `projectId = 79dc21b7-7916-4651-8638-421ab99c30c0`

验证：

```bash
GET /api/projects/79dc21b7-7916-4651-8638-421ab99c30c0/deliverables
```

结果：

- `status = 200`
- `length = 5`

说明该项目的 run outputs 已经能通过 SQLite-backed deliverables API 直接读取。

## 当前边界

已完成：

- 主 registry 不再依赖旧 JSON
- deliverables API 切到 SQLite
- provider events 进入 `run-history.jsonl`

仍未收的系统级旧债：

- `run-registry.ts` / `builtin-backends.ts` 里还存在历史 `any / require` lint 债
- `npm run build` 仍会被仓库既有 TypeScript 问题拦住

这些不是本轮迁移新增的结构性缺口。
