# Agents Runtime

`src/lib/agents/` 是项目执行层，负责把“用户意图 / workflow / project stage”变成真实 run、真实 session 和真实产物。

## 当前主入口

- `run-registry.ts`
  - 创建、更新、持久化 `AgentRunState`
- `prompt-executor.ts`
  - prompt-only 单入口
- `group-runtime.ts`
  - multi-role / stage runtime
- `supervisor.ts`
  - 周期巡检、恢复、诊断
- `scheduler.ts`
  - 定时触发 run / company loop
- `project-registry.ts`
  - project 生命周期与 pipelineState

## 当前关键约束

- 会话权威源是 `sessionProvenance.handle`
  - 统一 helper 在 `session-handle.ts`
  - `childConversationId / activeConversationId` 只剩兼容镜像
- run 历史真相源是 `run-history.jsonl`
- project control-flow 真相源是 `execution-journal.ts`
  - 只记录 `node:*` 与 `condition:evaluated`
- gate 审计走 `ops-audit.ts`
- `web` 默认不是 SQLite 多写者

## 文件分层建议

- 新增 run lifecycle：优先看 `run-registry.ts`、`run-session-hooks.ts`、`session-handle.ts`
- 新增 stage/runtime 行为：优先看 `group-runtime.ts`、`runtime-helpers.ts`
- 新增 project 恢复/诊断：优先看 `project-reconciler.ts`、`project-diagnostics.ts`
- 新增调度：优先看 `scheduler.ts`

## 不该再扩写的旧路径

- 直接以旧 conversation id 字段做权威读写
- 从 `src/app/api` 静态跨层 import 到 `@/server/*`
- 在 agents 层重新长出 growth 自动化主线
