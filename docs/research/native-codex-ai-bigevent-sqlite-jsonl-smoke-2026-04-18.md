# Native Codex AI 大事件 SQLite + JSONL 升级后实跑验证

日期：2026-04-18

## 目标

按 `docs/research/native-codex-daily-digest-cli-runbook-2026-04-17.md` 的执行方式，实际触发一次 `AI情报工作室` 的“今日 AI 大事件”，并核对 SQLite + `run-history.jsonl` 升级后以下链路是否都正常：

1. CEO 命令创建 `Ad-hoc Project`
2. run 命中 `native-codex`
3. workflow 命中 `/ai_bigevent`
4. 真实上报 `daily-events`
5. SQLite、`run-history.jsonl`、conversation、deliverables、artifact 都可回读

## 执行前基线

当前时间：

- `Europe/Rome = 2026-04-18T08:51:45+02:00`
- `Asia/Shanghai = 2026-04-18T14:51:45+08:00`

结论：

- 本次“今天”按 `Asia/Shanghai` 计算，目标日期是 `2026-04-18`

执行前状态：

- 部门 provider：`antigravity`
- 部门 skills：
  - `/ai_digest`
  - `/ai_bigevent`
- 外部 `GET https://api.aitrend.us/daily-events?from=2026-04-18&to=2026-04-18`
  - `total = 5`
- SQLite 主库：
  - `projects = 144`
  - `runs = 194`

## 本次执行

临时将：

- `/Users/darrel/Documents/baogaoai/.department/config.json`
  - `provider = native-codex`

发送 CEO 命令：

```text
AI情报工作室提炼今天的 AI 大事件并上报
```

返回：

- `action = create_project`
- `projectId = 37b8ba3e-1c4a-442f-8c5a-2db1bc0999c6`
- `runId = ae6e53b5-0651-4eb6-b620-2d4b573cc5df`

## 运行结果

### 1. Run / Project

run 终态：

- `run.status = completed`
- `project.status = completed`
- `provider = native-codex`
- `backendId = native-codex`
- `resolvedWorkflowRef = /ai_bigevent`
- `reportedEventDate = 2026-04-18`
- `reportedEventCount = 4`
- `verificationPassed = true`

project：

- `projectType = adhoc`
- `runIds = ['ae6e53b5-0651-4eb6-b620-2d4b573cc5df']`

### 2. 外部 daily-events 回读

执行后：

- `GET https://api.aitrend.us/daily-events?from=2026-04-18&to=2026-04-18`
  - `total = 9`

说明：

- 相比执行前 `5`
- 本次真实新增并验证通过的事件数为 `4`
- 总数增长符合 `reportedEventCount = 4`

### 3. SQLite 主库回读

执行后：

- `projects = 145`
- `runs = 195`

并且：

- `runs` 表中存在：
  - `run_id = ae6e53b5-0651-4eb6-b620-2d4b573cc5df`
  - `status = completed`
  - `provider = native-codex`

说明：

- 本次新 `project + run` 已真实写入 SQLite 主库

### 4. run-history.jsonl

路径：

- `/Users/darrel/.gemini/antigravity/gateway/runs/ae6e53b5-0651-4eb6-b620-2d4b573cc5df/run-history.jsonl`

结果：

- 文件存在
- `line_count = 15`

事件类型包含：

- `run.created`
- `run.status_changed`
- `workflow.preflight.started`
- `workflow.preflight.completed`
- `session.started`
- `conversation.message.user`
- `conversation.message.assistant`
- `workflow.finalize.started`
- `workflow.finalize.completed`
- `result.discovered`
- `artifact.discovered`
- `verification.discovered`
- `session.completed`

说明：

- SQLite 升级后，本次 `native-codex` run 的过程日志已经走 `run-history.jsonl`
- 不再只是零散 artifact 或摘要结果

### 5. Conversation API

接口：

- `GET /api/agent-runs/ae6e53b5-0651-4eb6-b620-2d4b573cc5df/conversation`

结果：

- `kind = transcript`
- `provider = native-codex`
- `messageCount = 2`
- 角色顺序：
  - `user`
  - `assistant`

说明：

- 新 run 的对话回读正常

### 6. Deliverables API

接口：

- `GET /api/projects/37b8ba3e-1c4a-442f-8c5a-2db1bc0999c6/deliverables`

结果：

- `length = 5`

标题：

- `Daily Events Build`
- `Daily Events Report`
- `Daily Events Verification`
- `Native Codex Ai Bigevent Draft`
- `Prepared Ai Bigevent Context`

说明：

- 新 run 的产物已通过项目 deliverables 路径回读
- Deliverables SQLite 化链路正常

### 7. Artifact 目录

路径：

- `/Users/darrel/Documents/baogaoai/demolong/projects/37b8ba3e-1c4a-442f-8c5a-2db1bc0999c6/runs/ae6e53b5-0651-4eb6-b620-2d4b573cc5df`

实际文件：

- `prepared-ai-bigevent-context.json`
- `daily-events-build.json`
- `daily-events-report.json`
- `daily-events-verification.json`
- `native-codex-ai-bigevent-draft.md`
- `artifacts.manifest.json`
- `result.json`
- `result-envelope.json`
- `task-envelope.json`

说明：

- preflight、draft、构建、上报、验证、result envelope 全部落盘

### 8. 验证文件

`daily-events-verification.json` 关键字段：

- `status = success`
- `targetDate = 2026-04-18`
- `runMode = first`
- `saved = 4`
- `skipped = 0`
- `verificationPassed = true`
- `verifyTotal = 9`

## 恢复

测试后已将：

- `/Users/darrel/Documents/baogaoai/.department/config.json`
  - `provider = antigravity`

恢复完成。

## 最终判断

这次 SQLite + JSONL 升级后的“今日 AI 大事件”链路是通的，而且不是只通一半：

1. CEO 命令能创建项目并发起执行
2. `native-codex` 能稳定命中 `/ai_bigevent`
3. 事件会真实上报到外部 `daily-events`
4. SQLite 主库能回读新 `project/run`
5. `run-history.jsonl` 能回读本次过程事件
6. conversation API 正常
7. deliverables API 正常
8. artifact 落盘完整

也就是说，数据库从“普通零散日志”切到 `SQLite + Jsonl` 后，这条最关键的 Native Codex AI 大事件链路当前是**端到端可用**的。
