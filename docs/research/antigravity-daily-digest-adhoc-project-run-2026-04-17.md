# Antigravity AI 日报生成（Ad-hoc Project，2026-04-17）

## 背景

在完成 CEO 即时部门任务“强制先创建 Ad-hoc Project”后，重新用当前部门默认 provider（`antigravity`）跑一条 AI 日报生成，确认：

1. CEO 命令会先创建 Project
2. run 会挂到这个 Project 上
3. Antigravity 会产生可见会话过程
4. 日报产物能落到项目运行目录

## 执行

时间：

- `2026-04-17 17:15:41 CEST`

当前部门 provider：

- `antigravity`

CEO 命令：

```text
AI情报工作室生成今天的日报
```

返回：

```json
{
  "success": true,
  "action": "create_project",
  "projectId": "4fcc49b9-267a-424e-a802-81c828a50353",
  "runId": "9c2b6c32-421e-4bb4-b5fe-7c4f723901be"
}
```

## 结果

### Project

- `projectId = 4fcc49b9-267a-424e-a802-81c828a50353`
- `name = AI情报工作室 · AI情报工作室生成今天的日报`
- `projectType = adhoc`
- `workspace = file:///Users/darrel/Documents/baogaoai`

### Run

- `runId = 9c2b6c32-421e-4bb4-b5fe-7c4f723901be`
- `status = completed`
- `provider = antigravity`
- `backendId = antigravity`
- `resolvedWorkflowRef = /ai_digest`
- `projectId = 4fcc49b9-267a-424e-a802-81c828a50353`

### 对话 / 过程可见性

- `childConversationId = 5fa0e64c-994f-4d52-9816-d793f72faebd`
- `activeConversationId = 5fa0e64c-994f-4d52-9816-d793f72faebd`
- `liveState.stepCount = 10`

说明：

- 这次因为走的是 `antigravity` backend，过程步骤与对话是可见的
- 与 `native-codex` 不同，这条链路能在会话侧看到执行过程

## 产物

运行目录：

- `/Users/darrel/Documents/baogaoai/demolong/projects/4fcc49b9-267a-424e-a802-81c828a50353/runs/9c2b6c32-421e-4bb4-b5fe-7c4f723901be/`

关键文件：

- `daily-digest-2026-04-17.md`
- `prepared-ai-digest-context.json`
- `result.json`
- `result-envelope.json`

最终日报文件：

- `/Users/darrel/Documents/baogaoai/demolong/projects/4fcc49b9-267a-424e-a802-81c828a50353/runs/9c2b6c32-421e-4bb4-b5fe-7c4f723901be/daily-digest-2026-04-17.md`

## 备注

当前 `Ad-hoc Project + prompt run` 还有一个后续优化点：

- Project 已创建并挂了 run
- 但 `project.runIds` 还没有同步写回
- `project.status` 也不会在 prompt run 完成后自动收成 `completed`

这不影响 OPC 中通过全局 run 列表和 `projectId` 过滤看到结果，但项目生命周期收尾还不够完整。
