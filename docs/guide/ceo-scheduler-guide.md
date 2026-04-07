# CEO Scheduler Guide

## 概述

CEO 现在有三条创建定时任务的路径：

1. CEO Office 仪表盘中的“用一句话创建定时任务”
2. CEO Workspace Workflow：`ceo-playbook.md` + `ceo-scheduler-playbook.md`
3. MCP / REST 直接调用现有 Scheduler 接口

目标不是让用户手填底层 cron / workspace / prompt，而是把业务意图翻译成标准 Scheduler Job。

---

## 一、Web UI 路径

入口位于 CEO Dashboard。

推荐输入：

1. `每天工作日上午 9 点让市场部生成日报`
2. `每周一上午 10 点巡检项目 Alpha 的健康度`
3. `明天上午 9 点让设计部创建一个 ad-hoc 项目，目标是整理 backlog`

Dashboard 会把这句自然语言发送到：

- `POST /api/ceo/command`

后端会自动识别：

1. 调度类型：`cron / interval / once`
2. 动作模板：`create-project / health-check / dispatch-pipeline`
3. 部门 / 项目 / 模板

返回结果里会包含：

1. `jobId`
2. `message`
3. `nextRunAt`

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
  "name": "市场部日报 · 工作日 09:00",
  "type": "cron",
  "cronExpression": "0 9 * * 1-5",
  "actionKind": "create-project",
  "departmentWorkspaceUri": "file:///Users/.../marketing",
  "goal": "生成日报，汇总当前进行中的项目与风险",
  "skillHint": "reporting",
  "intentSummary": "每天工作日上午 9 点让市场部生成日报"
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

### 4. 暂停 / 恢复 / 立即执行

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