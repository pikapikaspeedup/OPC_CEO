# 删除 legacy CEO command API 的技术问题

日期：2026-05-09

## 背景

CEO Office 当前主输入已经是 Conversation 对话链路。用户在 CEO Office 输入指令时，前端通过 `CeoOfficeCockpit` 调用 `onSend()`，最终进入通用 conversation send 逻辑，而不是 legacy CEO command client。

legacy CEO command API 是历史遗留的一次性自然语言命令入口。它把一句自然语言直接解析成即时任务、项目创建或 scheduler job 创建。这个入口与当前 CEO Conversation 的长期上下文、记忆、工具调用和多轮澄清机制并行存在，形成第二条 CEO 指令主链。

## 技术问题

需要删除 legacy CEO command API，同时确保当前 CEO Office 的对话、调度展示、项目/run 创建、scheduler 管理和今日关注逻辑不受影响。

核心问题不是前端输入框会失效，而是删除旧 endpoint 后，原来隐藏在 legacy CEO command processor 里的治理副作用不能丢失到不可追踪：

- CEO 行为审计
- CEO active focus 更新
- Ad-hoc Project + run 的组合语义
- scheduler job 的 `createdBy` / `intentSummary` / source 事实
- 文档和 playbook 中对旧 endpoint 的调用指引

## 删除范围

应删除或迁移的运行时代码：

- deleted legacy CEO command route
- `src/server/control-plane/routes/ceo.ts` 中的 legacy command handler
- `src/server/control-plane/server.ts` 中 legacy CEO command route 挂载
- legacy CEO command processor
- legacy CEO command processor tests
- `src/components/ceo-scheduler-command-card.tsx`
- `src/lib/api.ts` 中 legacy CEO command client、legacy command result type 及只服务该接口的类型

不应删除或影响的当前链路：

- CEO Office Conversation 输入与历史线程
- `/api/conversations`、`/api/conversations/:id/send`
- `/api/ceo/events`
- `/api/ceo/profile`
- `/api/ceo/routine`
- `/api/ceo/setup`
- `/api/scheduler/jobs`
- `/api/projects`
- `/api/agent-runs`
- `/api/agent-runs/:id/intervene`
- `antigravity_create_scheduler_job` / update / trigger / delete MCP 工具

## 迁移要求

CEO Conversation 的 playbook 必须成为唯一自然语言入口。

即时任务应走：

1. `POST /api/projects` 创建 Ad-hoc Project
2. `POST /api/agent-runs` 在该 Project 下派发 prompt/template run

定时任务应走：

1. MCP 优先：`antigravity_create_scheduler_job`
2. REST fallback：`POST /api/scheduler/jobs`

干预操作应走：

1. `POST /api/agent-runs/:id/intervene`
2. 需要项目级恢复时走现有 project resume API

状态查询应走：

1. `/api/management/overview`
2. `/api/company/ceo/decisions`
3. `/api/projects`
4. `/api/agent-runs`

## 治理补偿

删除 legacy CEO command processor 前，需要确认旧链路的副作用已有替代位置。

必须保留的事实：

- scheduler job 创建时写入 `createdBy: "ceo-workflow"` 或等价 source
- scheduler job 写入完整 `intentSummary`
- project/run 创建时能识别来源为 CEO Conversation 或 CEO workflow
- CEO 操作能进入 audit / CEO event / decision 事实源之一
- 如果 `activeFocus` 仍被 CEO Office 使用，必须由 Conversation 成功执行动作后显式更新，而不是依赖旧 endpoint 隐式更新

如果当前标准 API 尚未记录这些事实，本次删除不能只做 route 删除，必须补齐 metadata / audit 写入后再删除。

## 文档同步

需要从当前有效文档中移除 legacy CEO command API 作为推荐入口：

- `ARCHITECTURE.md`
- `docs/guide/gateway-api.md`
- `docs/guide/cli-api-reference.md`
- `docs/guide/agent-user-guide.md`
- `docs/guide/ceo-scheduler-guide.md`
- CEO workspace seed playbook：`src/lib/agents/ceo-environment.ts`

历史研究和 progress 文档可以保留旧记录，但不得作为当前操作指南继续引用。

## 验收标准

删除完成后必须满足：

1. CEO Office 输入框仍能创建/继续 CEO Conversation。
2. CEO Conversation 能创建一个 scheduler job，并且 Ops / 今日关注能看到该 job。
3. CEO Conversation 能创建一个 Ad-hoc Project，并在 Project 下派发 run。
4. scheduler job 仍有 `intentSummary` 和明确来源字段。
5. project/run 或 audit/CEO event 中能追踪 CEO 发起原因。
6. legacy CEO command exact-symbol grep 不再命中当前运行时代码、当前指南和 design 快照。
7. `/api/ceo/events`、`/api/ceo/profile`、`/api/ceo/routine`、`/api/ceo/setup` 仍可用。
8. 相关 `eslint`、`tsc`、API route 测试、scheduler 测试、CEO Office 基础页面验收通过。

## 风险判断

可以删除，但不能只删除 route。

真正风险在经营审计层，而不是 UI 层。截图里的 CEO Office 当前输入不会因删除 legacy CEO command API 失效；风险是 CEO Conversation 通过标准 API 完成动作后，系统是否还能完整记录“谁在什么上下文下为什么发起了这个动作”。
