# CEO Scheduler Guide

## 概述

CEO 现在有四条触发任务执行的路径：

1. **即时 Prompt Mode**：CEO 直接说"让 XX 部门执行/分析/整理..."，无需定时，立即发起 Prompt Mode 执行
2. CEO Office 仪表盘中的"用一句话创建定时任务"
3. CEO Workspace Workflow：`ceo-playbook.md` + `ceo-scheduler-playbook.md`
4. MCP / REST 直接调用现有 Scheduler 接口

目标不是让用户手填底层 cron / workspace / prompt，而是把业务意图翻译成标准 Scheduler Job 或即时执行。

---

## 一、Web UI 路径

入口位于 CEO Dashboard。

推荐输入：

1. `每天工作日上午 9 点让市场部创建一个日报任务项目，目标是汇总当前进行中的项目与风险`（定时 create-project）
2. `每周一上午 10 点巡检项目 Alpha 的健康度`（定时 health-check）
3. `让 AI 情报工作室分析最近 AI 行业重大信号`（即时 Prompt Mode，不需要定时关键词）
4. `每天上午 9 点让 AI 资讯部执行一次信号梳理`（定时 dispatch-prompt，无法唯一匹配模板时自动走 Prompt Mode）

Dashboard 会把这句自然语言发送到：

- `POST /api/ceo/command`

后端会自动识别：

1. **即时 vs 定时**：有无定时关键词（"每天""每周""cron""明天"等）
2. **即时路径**：有执行意图 + 匹配到部门 → 直接发起 Prompt Mode 执行（返回 `runId`）
3. **定时路径**：调度类型 `cron / interval / once`，动作模板 `create-project / health-check / dispatch-pipeline / dispatch-prompt`
4. 部门 / 项目 / 模板
5. 对于定时 `create-project`，若能唯一确定模板，会在创建 job 时写入 auto-dispatch template
6. 对于定时场景，若无法唯一确定模板但有执行意图，自动创建 `dispatch-prompt` 类型定时任务

返回结果里会包含：

- 定时任务：`jobId`, `message`, `nextRunAt`
- 即时执行：`runId`, `message`（`action: "dispatch_prompt"`）

其中 `create-project` 类型的 job 在触发时会先创建一个 Ad-hoc Project；如果需要继续自动执行实际任务，应由后续派发链路或部门流程接手。
如果创建时已经写入 `templateId` / `createProjectTemplateId`，那么这条“后续派发链路”会在同一次触发里自动执行。

---

## 二、MCP 路径

新增 Scheduler 相关工具：

1. `antigravity_list_scheduler_jobs`
2. `antigravity_create_scheduler_job`
3. `antigravity_update_scheduler_job`
4. `antigravity_trigger_scheduler_job`
5. `antigravity_delete_scheduler_job`

### 1. 创建部门定时任务

```json
{
  "name": "市场部日报任务 · 工作日 09:00",
  "type": "cron",
  "cronExpression": "0 9 * * 1-5",
  "actionKind": "create-project",
  "departmentWorkspaceUri": "file:///Users/.../marketing",
  "goal": "创建一个日报任务项目，目标是汇总当前进行中的项目与风险",
  "skillHint": "reporting",
  "createProjectTemplateId": "universal-batch-template",
  "intentSummary": "每天工作日上午 9 点让市场部创建一个日报任务项目，目标是汇总当前进行中的项目与风险"
}
```

### 2. 创建项目健康巡检

```json
{
  "name": "Alpha 健康巡检 · 每周一 10:00",
  "type": "cron",
  "cronExpression": "0 10 * * 1",
  "actionKind": "health-check",
  "projectId": "<projectId>",
  "intentSummary": "每周一上午 10 点巡检项目 Alpha 的健康度"
}
```

### 3. 创建定时 Pipeline 派发

```json
{
  "name": "设计部 UX 周检",
  "type": "cron",
  "cronExpression": "0 10 * * 1",
  "actionKind": "dispatch-pipeline",
  "workspace": "file:///Users/.../design",
  "prompt": "执行每周 UX 巡检并生成评审结论",
  "templateId": "ux-driven-dev-template",
  "stageId": "ux-review"
}
```

### 4. 创建定时 Prompt Mode 执行

适合无法唯一确定模板但有明确执行意图的场景。触发时走 Prompt Mode，由 AI 按 prompt 主导完成任务。

```json
{
  "name": "AI 资讯部信号梳理 · 工作日 09:00",
  "type": "cron",
  "cronExpression": "0 9 * * 1-5",
  "actionKind": "dispatch-prompt",
  "workspace": "file:///Users/.../ai-news",
  "prompt": "整理今天 AI 行业的关键信号，输出重点摘要",
  "promptAssetRefs": ["daily-digest-playbook"],
  "skillHints": ["research"],
  "intentSummary": "每天工作日上午 9 点让 AI 资讯部执行信号梳理"
}
```

### 5. 暂停 / 恢复 / 立即执行

暂停：

```json
{
  "jobId": "<jobId>",
  "enabled": false
}
```

恢复：

```json
{
  "jobId": "<jobId>",
  "enabled": true
}
```

立即执行：

```json
{
  "jobId": "<jobId>"
}
```

---

## 三、REST 路径

对 REST 而言，`create-project` 的 auto-run 模板写在 `opcAction.templateId`。如果该字段存在，立即执行时会返回 `projectId=... , runId=...`；否则只会返回新建的 `projectId`。

### 创建任务

`POST /api/scheduler/jobs`

### 更新任务

`PATCH /api/scheduler/jobs/:id`

### 删除任务

`DELETE /api/scheduler/jobs/:id`

### 立即触发

`POST /api/scheduler/jobs/:id/trigger`

### 查询列表

`GET /api/scheduler/jobs`

---

## 四、自然语言到调度对象的默认映射

| 自然语言 | 默认映射 |
|:---|:---|
| 每天 9 点 | `0 9 * * *` |
| 工作日 9 点 | `0 9 * * 1-5` |
| 每周一 10 点 | `0 10 * * 1` |
| 明天上午 9 点 | `type = once` + `scheduledAt` |
| 每隔 2 小时 | `type = interval` + `intervalMs = 7200000` |

只有在部门、项目、模板或频率存在歧义时，CEO 才应该回头向用户提问。