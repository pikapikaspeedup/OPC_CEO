# Antigravity AI 日报生成（Ad-hoc Project，2026-04-17）

## 文档定位

这份文档最初记录的是 `2026-04-17` 一次真实的 AI 日报试运行。
`2026-04-21` 已根据当前代码与一次真实复跑结果，把文档中的机制描述校正为：

1. 保留 `2026-04-17` 的历史运行证据
2. 明确哪些现象只是当时状态
3. 补齐当前机制与当前复核结果

不要再把本文末尾旧版本里“`project.runIds` 不回写、`project.status` 不自动 completed`”那类结论当成现状。

## 历史背景

在完成 CEO 即时部门任务“强制先创建 Ad-hoc Project”后，当时使用部门默认 provider（`antigravity`）跑一条 AI 日报生成，确认：

1. CEO 命令会先创建 Project
2. run 会挂到这个 Project 上
3. Antigravity 会产生可见会话过程
4. 日报产物能落到项目运行目录

说明：

- 这里的 `provider = antigravity` 只代表 `2026-04-17` 当时的部门配置
- 它不代表当前默认 provider 仍然是 `antigravity`

## 历史执行

时间：

- `2026-04-17 17:15:41 CEST`

当时部门 provider：

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

## 历史结果

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

## 历史产物

运行目录：

- `/Users/darrel/Documents/baogaoai/demolong/projects/4fcc49b9-267a-424e-a802-81c828a50353/runs/9c2b6c32-421e-4bb4-b5fe-7c4f723901be/`

关键文件：

- `daily-digest-2026-04-17.md`
- `prepared-ai-digest-context.json`
- `result.json`
- `result-envelope.json`

最终日报文件：

- `/Users/darrel/Documents/baogaoai/demolong/projects/4fcc49b9-267a-424e-a802-81c828a50353/runs/9c2b6c32-421e-4bb4-b5fe-7c4f723901be/daily-digest-2026-04-17.md`

## 当前机制校正（2026-04-21）

基于当前代码与真实复跑结果，日报这条链路现在应这样理解：

1. `CEO 即时命令` 仍然会**先创建 `Ad-hoc Project`**，然后：
   - 有 `templateId` 时走 template dispatch
   - 没有 `templateId` 时走 prompt run
2. 当前 `AI情报工作室` 的部门 provider 已是 `native-codex`，不是本文历史 run 中的 `antigravity`
3. `/ai_digest` 依然是日报 workflow，但它现在是通过“部门 skill/workflow 能力解析 + canonical workflow assets”命中的，不应再理解为 repo-local `.agents/workflows/ai_digest.md`
4. 当前 canonical 日报资产边界是：
   - workflow：`~/.gemini/antigravity/gateway/assets/workflows/ai_digest.md`
   - workflow helper scripts：`~/.gemini/antigravity/gateway/assets/workflow-scripts/ai_digest/*`
   - 可选 skill：`~/.gemini/antigravity/gateway/assets/skills/baogaoai-ai-digest-generator/SKILL.md`
5. 也就是说，日报 workflow 现在可以直接挂全局脚本资产，不再强依赖某个 skill 才能拿到 `fetch_context.py / report_digest.py`
6. prompt run 现在会把 `runId` 写回 `project.runIds`
7. standalone 的 `Ad-hoc Project + prompt run` 在 run 完成后会自动把 `project.status` 收敛到 `completed`
8. 只有走 `antigravity` backend 时，才应期待 `childConversationId / activeConversationId / liveState` 这类对话与步骤可见性；当前 `native-codex` 路径的主观测面应是 `run.status / project.status / artifacts`
9. `daily-digest` 的目标日期按 `Asia/Shanghai` 计算，不跟随当前机器时区；因此在 `2026-04-21` 的欧洲时区环境里执行“今天的日报”，产物文件名会落成 `2026-04-22`

## 当前复核（2026-04-21，真实复跑）

本次按**当前真实部门配置**复跑，而不是沿用历史前提。

时间：

- `2026-04-21`

当前部门 provider：

- `native-codex`

CEO 命令：

```text
AI情报工作室生成今天的日报
```

返回：

```json
{
  "success": true,
  "action": "create_project",
  "projectId": "60057712-09e3-4fd1-9344-2c995a452ecc",
  "runId": "d711d04b-2d86-4d2f-b5fe-7191230c50fd"
}
```

执行观测：

- 总耗时约 `75s`
- `run.status = completed`
- `project.status = completed`
- `provider = native-codex`
- `resolvedWorkflowRef = /ai_digest`
- `project.runIds = ["d711d04b-2d86-4d2f-b5fe-7191230c50fd"]`
- `promptResolution.mode = workflow`
- `promptResolution.matchedWorkflowRefs = ["/ai_digest"]`

项目镜像：

- `projectId = 60057712-09e3-4fd1-9344-2c995a452ecc`
- `name = AI情报工作室 · 生成今天的日报`
- `projectType = adhoc`
- `workspace = file:///Users/darrel/Documents/baogaoai`

本次产物目录：

- `/Users/darrel/Documents/baogaoai/demolong/projects/60057712-09e3-4fd1-9344-2c995a452ecc/runs/d711d04b-2d86-4d2f-b5fe-7191230c50fd/`

本次关键产物：

- `daily_digest_2026-04-22.md`
- `prepared-ai-digest-context.json`
- `result.json`
- `result-envelope.json`
- `artifacts.manifest.json`
- `task-envelope.json`

说明：

- 本次真实复跑已经证明：`Ad-hoc Project -> prompt run -> artifact 落盘 -> project 收尾` 这条链路当前是闭环的
- 历史文档里关于 `project.runIds` 和 `project.status` 的不足，现已不再代表当前行为
- 当前 provider 已改成 `native-codex`，因此不应再用 `2026-04-17` 那次 `antigravity` run 的“对话过程可见性”来判断现在是否正常

## 结论

这条 AI 日报链路在今天依然可用，但“可用”的含义已经和 `2026-04-17` 不完全一样：

1. 主流程仍然是 `CEO 即时命令 -> Ad-hoc Project -> /ai_digest prompt run`
2. 当前默认 provider、workflow 资产来源、project 收尾行为都已经与历史记录不同
3. 本文应被视为“历史 run 记录 + 当前机制校正”，而不是只读前半段就当作现状说明书
