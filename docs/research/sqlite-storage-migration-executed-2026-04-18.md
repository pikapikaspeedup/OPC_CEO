# SQLite 主库存储迁移执行记录（2026-04-18）

## 背景

在完成数据库与存储策略研究后，按确认方案执行：

- 主数据库：`SQLite`
- 运行日志：`run-history.jsonl`
- 迁移策略：`一次切换`

## 本次实际执行

### 1. SQLite 主库存储层落地

新增：

- `src/lib/storage/gateway-db.ts`

当前主库文件：

- `~/.gemini/antigravity/gateway/storage.sqlite`

当前已落表：

- `projects`
- `runs`
- `conversation_sessions`
- `scheduled_jobs`
- `storage_meta`

### 2. Registry 持久化切换

当前以下模块已经改为使用 SQLite 持久化：

- `src/lib/agents/project-registry.ts`
- `src/lib/agents/run-registry.ts`
- `src/lib/agents/scheduler.ts`
- `src/lib/bridge/statedb.ts`（本地 conversation cache 部分）

说明：

- `projects.json / agent_runs.json / local_conversations.json / scheduled_jobs.json`
- 已不再作为主写入路径

### 3. Run history 基础层落地

新增：

- `src/lib/agents/run-history.ts`

当前路径：

- `~/.gemini/antigravity/gateway/runs/{runId}/run-history.jsonl`

本轮先接入：

- `run.created`
- `run.status_changed`
- 历史 run 导入时的：
  - `migration.imported`
  - `result.discovered`
  - `artifact.discovered`
  - `verification.discovered`

### 4. 一次性迁移脚本

新增：

- `scripts/migrate-storage-to-sqlite.ts`

脚本执行结果：

- backupDir: `/Users/darrel/.gemini/antigravity/gateway/legacy-backup/2026-04-17T22-22-32-649Z`
- dbPath: `/Users/darrel/.gemini/antigravity/gateway/storage.sqlite`

导入数量：

- projects: `144`
- runs: `192`
- conversations: `102`
- scheduledJobs: `1`

导入后回读数量：

- projects: `144`
- runs: `192`
- conversations: `102`
- scheduledJobs: `1`

说明：

- 迁移前后数量对齐
- 旧 JSON 文件已做备份

## 当前状态判断

### 已完成

1. JSON registry → SQLite 主库迁移
2. 历史数据已导入
3. `run-history.jsonl` 基础层已落地
4. 本地 conversation cache 已切到 SQLite

### 还未完全收口

1. `execution-journal.jsonl` 仍是 project-level control-flow 日志
2. 第三方 provider 的完整 conversation/tool/hook 事件还没有全部统一写入 `run-history.jsonl`
3. `/api/projects/[id]/deliverables` 的底层 registry 仍是手工 deliverable 模型，尚未完全改成 SQLite 主表
4. 仓库级 `eslint/build` 仍有既有历史问题，不是本轮新引入

## 结论

这次不是“只加一个 SQLite 文件”，而是已经完成了：

- **主 registry 的实际切换**
- **历史数据的实际迁移**
- **run-history 基础设施的实际落地**

当前系统已经从：

- `JSON registry + JSONL journal + 外部 SQLite`

开始收口成：

- `SQLite 主库 + run-history JSONL + artifact files + 外部 state.vscdb 只读`
