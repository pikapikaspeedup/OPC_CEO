# Scheduler Panel 结果链补齐与 OPC 顶部循环区降级（2026-04-18）

## 背景

用户直接指出两件事：

1. 循环任务不应该在 OPC 顶部占用固定大块空间
2. 在 `SchedulerPanel` 里看不到这条任务对应的具体 run 和结果

这不是样式问题，而是两个结构问题：

- 信息层级错了
- `scheduler job -> run` 关联没打透

## 本次收口

### 1. 移除 OPC 顶部固定大块循环任务区

修改：

- `src/components/projects-panel.tsx`

调整：

- 删除顶部大块 `循环任务` Spotlight 区
- 改为 header 级别的紧凑入口
  - 只显示 loop 数量 / 启用数
  - 点击后进入 Scheduler

结果：

- 循环任务仍然可见
- 但不再抢占 OPC 主内容区高度

### 2. 打通 scheduler job -> run 关联

修改：

- `src/lib/agents/scheduler.ts`
- `src/lib/agents/dispatch-service.ts`
- `src/lib/agents/group-runtime.ts`
- `src/lib/agents/run-registry.ts`
- `src/app/api/agent-runs/route.ts`
- `src/lib/api.ts`

本次新增：

- scheduler 触发 `dispatch-prompt / dispatch-pipeline / create-project+template` 时
  - 都会把：
    - `triggerContext.source = 'scheduler'`
    - `triggerContext.schedulerJobId = <jobId>`
  写进 run

- `/api/agent-runs` 新增：
  - `schedulerJobId` 过滤能力

这样前端就能稳定按 job 拉到最近 runs，而不是再靠审计日志反推。

### 3. SchedulerPanel 显示最近 runs 与结果

修改：

- `src/components/scheduler-panel.tsx`

新增：

- 每条 job 增加 `Runs` 展开按钮
- 展开后会按 `schedulerJobId` 拉最近 runs
- 每条 run 显示：
  - status
  - runId 短码
  - createdAt
  - provider
  - `resolvedWorkflowRef`
  - `reportedEventCount`
  - `verificationPassed`
  - 结果摘要 / 错误摘要

对于 `health-check`：

- 明确提示“这类任务不会创建 run”

## 验证

### 单测

```bash
npm test -- src/lib/agents/scheduler.test.ts src/app/api/agent-runs/route.test.ts
```

结果：

- `17 passed`

覆盖：

- scheduler 触发 prompt run 时透传 `triggerContext.schedulerJobId`
- scheduler 触发 template run 时透传 `triggerContext.schedulerJobId`
- `/api/agent-runs?schedulerJobId=...` 过滤生效

### 前端 lint

```bash
npx eslint src/components/projects-panel.tsx src/components/scheduler-panel.tsx
```

结果：

- 通过

### 页面验收

`bb-browser` 实测确认：

- OPC 页不再出现之前那块固定大循环区
- Ops 页的 SchedulerPanel 可以展开 `Runs`
- 展开后能看到：
  - workflow（例如 `/ai_bigevent`）
  - 错误摘要或结果摘要
  - run 关联信息

## 结论

本轮后：

1. **循环任务不再霸占 OPC 顶部固定空间**
2. **SchedulerPanel 能直接看到这条任务对应的具体 runs**
3. **loop task 终于真正进入 run 视角，而不是只停留在 scheduler job 视角**
