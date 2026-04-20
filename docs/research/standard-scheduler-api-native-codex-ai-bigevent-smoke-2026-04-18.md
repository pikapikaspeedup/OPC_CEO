# 标准 Scheduler API 入口实跑：Native Codex AI 大事件（2026-04-18）

## 背景

在确认 CEO 路由应回到 playbook 主导后，本轮不再通过 `/api/ceo/command` 验证调度，而是直接使用标准定时任务入口：

- `POST /api/scheduler/jobs`

目标是单独回答一个问题：

> **标准 schedule 入口本身，是否已经具备业务有效性？**

验证场景仍然保持为：

- 部门：`AI情报工作室`
- provider：`native-codex`
- workflow：`/ai_bigevent`
- skill：`baogaoai-ai-bigevent-generator`
- 触发方式：秒级 interval

## 执行前基线

时间：

- Shanghai：`2026-04-18 16:05:10 +0800`

部门配置：

- `AI情报工作室.provider = native-codex`

运行时基线：

- SQLite `runs` 总数：`203`
- 外部 `GET https://api.aitrend.us/daily-events?from=2026-04-18&to=2026-04-18`
  - `eventCount = 18`

## 创建方式

直接调用标准入口：

```bash
curl -X POST http://127.0.0.1:3000/api/scheduler/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "AI情报工作室 标准调度测试 · 每隔5秒",
    "type": "interval",
    "intervalMs": 5000,
    "createdBy": "api",
    "intentSummary": "标准 schedule 入口测试：每隔5秒让AI情报工作室提炼今天的AI大事件并上报",
    "enabled": true,
    "action": {
      "kind": "dispatch-prompt",
      "workspace": "file:///Users/darrel/Documents/baogaoai",
      "prompt": "AI情报工作室提炼今天的 AI 大事件并上报",
      "promptAssetRefs": ["/ai_bigevent"],
      "skillHints": ["ai-big-event", "baogaoai-ai-bigevent-generator", "ai_bigevent"]
    }
  }'
```

返回：

- `jobId = f68ced56-421a-4d62-8fe0-2cf549cc08bd`

## 自动触发结果

该 job 不是手工 trigger，而是由 scheduler 自动反复触发。

实际回读到的相关 run：

1. `a5a88679-af54-4fac-8f95-162c4756cfd7`
   - `createdAt = 2026-04-18T08:05:11.203Z`
   - `status = blocked`
   - `resolvedWorkflowRef = /ai_bigevent`
   - `reportedEventCount = 0`
   - `verificationPassed = false`

2. `3331a19e-c570-43cf-a5a4-84a40b0873ff`
   - `createdAt = 2026-04-18T08:05:33.457Z`
   - `status = blocked`
   - `resolvedWorkflowRef = /ai_bigevent`
   - `reportedEventCount = 0`

3. `b2c6d082-7892-4bc2-9fc2-9be70e8c4af9`
   - `createdAt = 2026-04-18T08:05:54.741Z`
   - `status = completed`
   - `provider = native-codex`
   - `backendId = native-codex`
   - `resolvedWorkflowRef = /ai_bigevent`
   - `reportedEventDate = 2026-04-18`
   - `reportedEventCount = 2`
   - `verificationPassed = true`

4. `a43bf2c2-8ead-4635-9b11-c531799165a8`
   - `createdAt = 2026-04-18T08:06:16.354Z`
   - `status = blocked`
   - `resolvedWorkflowRef = /ai_bigevent`
   - `reportedEventCount = 0`

5. `139271f6-37d7-4076-8e8f-c7d4bc2f61ed`
   - `createdAt = 2026-04-18T08:06:38.061Z`
   - `status = blocked`
   - `resolvedWorkflowRef = /ai_bigevent`
   - `reportedEventCount = 0`

## 外部结果回读

执行后回读：

- `GET https://api.aitrend.us/daily-events?from=2026-04-18&to=2026-04-18`
  - `eventCount = 20`

说明：

- 从 `18` 增长到 `20`
- 本轮标准 schedule 入口至少成功新增了 `2` 条 AI 大事件
- 这与成功 run `b2c6d082-7892-4bc2-9fc2-9be70e8c4af9` 的 `reportedEventCount = 2` 一致

## 删除与清理

删除接口：

```bash
curl -X DELETE http://127.0.0.1:3000/api/scheduler/jobs/f68ced56-421a-4d62-8fe0-2cf549cc08bd
```

验证：

- 删除后立即不存在
- 7 秒后仍不存在
- 当前 scheduler job 数已恢复到测试前水平

额外恢复：

- `AI情报工作室.provider` 已恢复为 `antigravity`

## 结论

这次已经把“标准 schedule 入口”的业务有效性和“CEO 路由”的问题分开了。

结论是：

1. **标准 `POST /api/scheduler/jobs` 入口本身是可用的**
2. **`dispatch-prompt + /ai_bigevent + native-codex` 可以由 scheduler 自动触发**
3. **触发出来的 run 会真实命中 `/ai_bigevent` 并执行大事件上报**
4. **有新事件时会成功上报；没有新事件时会合理进入 `blocked`，不是静默失败**
5. **删除 job 现在也已经能持久化生效，不会重启复活**
