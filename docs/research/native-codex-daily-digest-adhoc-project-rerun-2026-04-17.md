# Native Codex AI 日报生成重跑（Ad-hoc Project，2026-04-17）

## 背景

用户指出两个问题：

1. 之前看到的日报项目在 OPC 中仍显示为 `active / 待派发`
2. 上一轮测试使用的是 `antigravity`，而不是用户明确要求的 `Native Codex`

本轮先修复问题，再使用 `Native Codex` 重跑 `AI 日报生成`。

## 问题定位

### 1. 旧日报项目为什么看起来没跑完

旧项目：

- `projectId = 4fcc49b9-267a-424e-a802-81c828a50353`
- `runId = 9c2b6c32-421e-4bb4-b5fe-7c4f723901be`

当时的真实问题有两层：

1. `prompt-executor.ts` 在创建带 `projectId` 的 prompt run 时，没有 `addRunToProject()`
2. standalone `adhoc project` 在 prompt run 完成后，没有自动把 `status` 收成 `completed`

结果：

- `project.runIds = []`
- `project.status = active`

同时 `ProjectsPanel` 只要发现项目没有 `pipelineState`，就统一渲染成“待派发”面板，即使该项目实际上已经有 prompt run。

### 2. 为什么上次用了 antigravity

上一轮的目标是验证：

- CEO 即时任务是否先创建 `Ad-hoc Project`
- 以及执行过程是否在 UI 中可见

因此当时刻意保留了部门默认 provider `antigravity`，这和用户明确要求的 `Native Codex` 不一致。

## 本轮修复

### 1. prompt project 关联与收尾同步

修改：

- `src/lib/agents/prompt-executor.ts`

新增行为：

- 创建 prompt run 时，若存在 `projectId`，立即 `addRunToProject(projectId, runId)`
- prompt run 完成后，若项目没有 `pipelineState`，按结果自动更新 standalone adhoc project 状态：
  - `completed -> completed`
  - `failed/timeout -> failed`
  - `cancelled -> cancelled`

### 2. OPC 对 prompt-only 项目的展示修正

修改：

- `src/components/projects-panel.tsx`

结果：

- 对于没有 `pipelineState` 但已有 `prompt run` 的项目，不再一律展示“待派发”
- 直接进入 `ProjectWorkbench`
- `PromptRunsSection` 可以展示该项目下的 prompt run

### 3. 历史项目修正

通过 API 将旧项目：

- `4fcc49b9-267a-424e-a802-81c828a50353`

的状态修回：

- `status = completed`

## Native Codex 重跑

临时将 `AI情报工作室` provider 切到：

- `native-codex`

CEO 命令：

```text
AI情报工作室生成今天的日报
```

返回：

```json
{
  "projectId": "77c6a0f8-14e8-4be3-b1bd-635f16311e11",
  "runId": "2424cb6c-eca0-4618-a2f3-593d86456847"
}
```

## 结果

### Project

- `projectId = 77c6a0f8-14e8-4be3-b1bd-635f16311e11`
- `status = completed`
- `projectType = adhoc`
- `runIds = ['2424cb6c-eca0-4618-a2f3-593d86456847']`

### Run

- `runId = 2424cb6c-eca0-4618-a2f3-593d86456847`
- `status = completed`
- `projectId = 77c6a0f8-14e8-4be3-b1bd-635f16311e11`
- `provider = native-codex`
- `sessionProvenance.backendId = native-codex`
- `resolvedWorkflowRef = /ai_digest`

### 产物

运行目录：

- `/Users/darrel/Documents/baogaoai/demolong/projects/77c6a0f8-14e8-4be3-b1bd-635f16311e11/runs/2424cb6c-eca0-4618-a2f3-593d86456847/`

存在文件：

- `prepared-ai-digest-context.json`
- `task-envelope.json`
- `result.json`
- `result-envelope.json`
- `artifacts.manifest.json`

说明：

- 这次 `Native Codex` 是真正挂在 `Ad-hoc Project` 下面执行完成的
- Project 状态和 `runIds` 已经同步正确

## 测试后恢复

已将 `AI情报工作室` 的 provider 恢复为：

- `antigravity`
