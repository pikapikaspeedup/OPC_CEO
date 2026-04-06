# Antigravity MCP Server Documentation

## 简介 (Overview)

Antigravity MCP (Model Context Protocol) Server 是一个通过标准 `stdio` 协议暴露系统底层调度能力的组件。它可以让外部的 AI 助手（如 Cursor、Claude Desktop、独立运行的 Gemini Agent）直接拥有读取项目状态、查询 Agent 运行情况、干预流水线进度的原生能力。

通过该 MCP Server，外部 AI 可以无缝接入 Antigravity 的自动化流水线中，而不需要使用者手敲查询脚本或手动调用 Next.js 的内部 REST API。

需要注意的是：MCP 本身负责工具暴露和参数编排；真正的 pipeline dispatch / recovery 已转发到本地 Next.js 常驻进程执行。因此，MCP 会话中断不会让已经派发出去的 pipeline 自动中断。

> V6.1 更新：MCP 派发工具已统一改为 `templateId + stageId`，不再接受 `groupId`。

---

## 如何启用配置

要让支持 MCP 的客户端（例如 Cursor）挂载全套 Antigravity 工具，只需在其 MCP 设置中添加以下节点：

```json
"antigravity-mcp": {
  "command": "npx",
  "args": [
    "tsx",
    "/完整绝对路径走到项目下/Antigravity-Mobility-CLI/src/mcp/server.ts"
  ]
}
```

由于运行环境依赖 Node.js 和相应的配置，确保 `pwd` 指向 Antigravity 根目录，且已经执行过 `npm install`。

---

## 工具列表 (Tools API)

MCP Server 目前共提供 **20** 个工具。这些能力经过封装，天然满足大语言模型的 Schema 调用。

### 1. antigravity_list_projects
用于查询系统内现存的项目列表。适合 AI 需要了解"目前手头上有哪些活儿"时使用。

- **入参 (Input)**:
  - `limit` (number, 可选): 每页返回的数量，默认 20，最高 100。
  - `offset` (number, 可选): 分页游标，默认 0。
- **返回值 (Output)**:
  - `projects` 数组：包含每个项目的 `projectId`、`name`、`status`、以及 `pipelineState` 的基础信息。
- **Hint**: `readOnly`

### 2. antigravity_get_project
当 AI 获得了 `projectId` 想要知道这件事情"推进到什么地步了"时，调用此工具。它会返回整个流水线的拓扑和当前激活的环节（包括过去的错误信息）。

- **入参 (Input)**:
  - `projectId` (string, 必填): 项目 ID。
- **返回值 (Output)**:
  - 完整 `ProjectDefinition` 的 JSON 结构，包含 `pipelineState` 和所有的 `stages` 的 `attempts` 与所绑定的 `runId`。
- **Hint**: `readOnly`

### 3. antigravity_get_run
这是 **最频繁调用** 的状态探针。由于每一个业务流可能会执行复杂的 Review Loop 或者串联调用，外部 AI 需要知道 "当前正在跑的是什么状态"。

- **入参 (Input)**:
  - `runId` (string, 必填): 运行时的实例 ID（例如 `ff318228-f598-4e42-98c7-6a3f1f46890a`）。
- **返回值 (Output)**:
  - 自动将海量内部数据扁平化，不仅返回完整的 `JSON`，还会优先返回易读的自然语言 Text Content，包括：
    - 当前所处的 `Round`
    - 所有经历过的 Role 角色历史阵列及对应 Review 决策 (`approved`/`revise`/`rejected`)
    - 最新的 Supervisor 评审巡检记录日志
- **Hint**: `readOnly`

### 4. antigravity_intervene_run
允许外部 AI 根据当前 run 的状态，**自主执行恢复或终止操作**（Intervention）。它既适用于超时/报错后的 same-run 接管，也适用于 stale-active run 的 `nudge`，以及操作员发起的 `cancel`。

- **入参 (Input)**:
  - `runId` (string, 必填): 目标运行的 ID。
  - `action` (Enum, 必填): 支持 `"retry" | "restart_role" | "nudge" | "cancel"`。
  - `prompt` (string, 可选): 在触发 `retry` / `restart_role` / `nudge` 时想要额外传给执行 Agent 的建议或批评。
  - `roleId` (string, 可选): 在进行精确重试时指定目标处理角色。
- **返回值 (Output)**:
  - 干预命令下发成功后的结果对象。
- **Hint**: **`destructive`**

使用约束：

- `retry` 是兼容别名，建议优先使用 `restart_role`
- `nudge` 只适用于 stale-active 的 run（`starting/running` 且已出现 `liveState.staleSince`）
- `restart_role` 会在同一个 run 内创建新 Conversation 接管，不会创建新 run
- `cancel` 会终止 canonical run，并保留其 pipeline 关联

### 5. antigravity_dispatch_pipeline
核心的触发开关。外部 AI 如果分析认为需要开展一项新工作，可以直接发起一个新的全自动流水线。

实现说明：

- 该工具会把请求转发到本地 `POST /api/agent-runs`
- pipeline 的后续推进运行在 Next.js 常驻进程中，而不是绑定在 MCP stdio 会话里

- **入参 (Input)**:
  - `workspace` (string, 必填): 作用的代码根目录（带 `file://` 前缀）。
  - `prompt` (string, 必填): 给流水线设定的核心大目标。
  - `projectId` (string, 可选): 可以将其挂载进某个已存在的项目中。
  - `templateId` (string, 可选): 使用模板名称（例如 `development-template-1`）触发完整产研链。
  - `stageId` (string, 可选): 指定模板中的某个 stage。省略时派发入口 stage。
- **返回值 (Output)**:
  - 创建并成功发起的 `runId`。
- **Hint**: **`destructive`**

---

## 基础设施工具

### 6. antigravity_get_project_diagnostics
查看项目的健康摘要、处于活跃/等待/阻塞状态的 stage，以及分支异常诊断。

- **入参 (Input)**:
  - `projectId` (string, 必填): 待诊断的项目 ID。
- **返回值 (Output)**:
  - 项目健康摘要 JSON，包括活跃 stage、阻塞原因、分支异常等。
- **Hint**: `readOnly`

### 7. antigravity_list_scheduler_jobs
返回系统内所有定时任务的列表及其运行状态。

- **入参 (Input)**: 无。
- **返回值 (Output)**:
  - 任务数组，每项包含 `enabled`、`nextRunAt`、`lastRunResult` 等。
- **Hint**: `readOnly`

### 8. antigravity_reconcile_project
对项目执行幂等的状态修复，解决不一致的 pipeline 状态。默认 `dryRun: true`，仅报告不修改。

- **入参 (Input)**:
  - `projectId` (string, 必填): 项目 ID。
  - `dryRun` (boolean, 可选, 默认 true): 是否仅模拟。
- **返回值 (Output)**:
  - 修复操作列表和结果。
- **Hint**: **`destructive`**（当 `dryRun: false`）

---

## V4.4 — 数据契约工具

### 9. antigravity_lint_template
校验 template 的 DAG 结构和 typed contracts。仅返回诊断信息，不修改任何状态。

- **入参 (Input)**:
  - `templateId` (string, 必填): 模板 ID。
- **返回值 (Output)**:
  - `valid` (boolean): 是否通过。
  - `dagErrors`: DAG 结构错误。
  - `contractErrors` / `contractWarnings`: 契约校验结果。
- **Hint**: `readOnly`

---

## V5.1 — 图编排工具

### 10. antigravity_validate_template
通用格式校验，自动检测 `pipeline[]` 或 `graphPipeline`，执行 DAG 结构和契约校验。

- **入参 (Input)**:
  - `templateId` (string, 可选): 从磁盘加载的模板 ID。
  - `template` (object, 可选): 内联的模板对象。
- **返回值 (Output)**:
  - `format`: 检测到的格式（`pipeline` 或 `graphPipeline`）。
  - `valid`、`dagErrors`、`contractErrors`、`contractWarnings`。
- **Hint**: `readOnly`

### 11. antigravity_convert_template
在 `pipeline[]` 和 `graphPipeline` 两种格式之间互转。

- **入参 (Input)**:
  - `direction` (enum, 必填): `"pipeline-to-graph"` 或 `"graph-to-pipeline"`。
  - `pipeline` (array, 可选): pipeline 格式源数据。
  - `graphPipeline` (object, 可选): graph 格式源数据。
- **返回值 (Output)**:
  - 转换后的目标格式对象。
- **Hint**: `readOnly`

---

## V5.2 — 控制流工具

### 12. antigravity_gate_approve
审批或拒绝 pipeline 中的 gate 节点。gate 节点在上游完成后阻塞流程，必须有显式 approve/reject 决策才能继续。

- **入参 (Input)**:
  - `projectId` (string, 必填): 项目 ID。
  - `nodeId` (string, 必填): Gate 节点 ID。
  - `decision` (enum, 必填): `"approved"` 或 `"rejected"`。
  - `reason` (string, 可选): 决策理由。
- **返回值 (Output)**:
  - `{ success, nodeId, decision }`。
- **Hint**: `destructive`

### 13. antigravity_list_checkpoints
列出项目的所有 pipeline 状态快照（checkpoint），可用于 replay/resume。

- **入参 (Input)**:
  - `projectId` (string, 必填): 项目 ID。
- **返回值 (Output)**:
  - checkpoint 数组，每项包含 `id`、`createdAt`、`nodeId` 等。
- **Hint**: `readOnly`

### 14. antigravity_replay
将项目 pipeline 状态恢复到指定 checkpoint。未指定 `checkpointId` 时使用最新的 checkpoint。

- **入参 (Input)**:
  - `projectId` (string, 必填): 项目 ID。
  - `checkpointId` (string, 可选): 目标 checkpoint ID。
- **返回值 (Output)**:
  - `{ replayed, checkpointId, restoredStageCount }`。
- **Hint**: `destructive`

### 15. antigravity_query_journal
查询项目的执行日志。返回控制流决策、gate 审批、loop 迭代、switch 路由等事件。

- **入参 (Input)**:
  - `projectId` (string, 必填): 项目 ID。
  - `nodeId` (string, 可选): 按节点 ID 过滤。
  - `type` (string, 可选): 按事件类型过滤（如 `gate:decided`、`loop:iteration`、`switch:routed`）。
  - `limit` (number, 可选, 默认 50): 最大返回条数。
- **返回值 (Output)**:
  - `{ entries, total }`。
- **Hint**: `readOnly`

---

## V5.3 — AI 辅助生成工具

### 16. antigravity_generate_pipeline
根据用户目标描述和约束条件，使用 AI 生成 graphPipeline 草案。返回的草案**必须经过确认**后才能保存。

- **入参 (Input)**:
  - `goal` (string, 必填, 最长 5000): 自然语言项目目标描述。
  - `constraints` (object, 可选):
    - `maxStages` (number): 最大 stage 数。
    - `allowFanOut` / `allowLoop` / `allowGate` (boolean): 允许的节点类型。
    - `techStack` / `teamSize` (string): 技术栈和团队规模提示。
  - `referenceTemplateId` (string, 可选): 参考模板 ID。
  - `model` (string, 可选): 使用的 LLM 模型。
- **返回值 (Output)**:
  - 包含 `draftId`、`graphPipeline`、`validationResult`、`riskAssessment`、`templateMeta`。
- **Hint**: `readOnly`（仅生成，不写入文件系统）

### 17. antigravity_confirm_pipeline_draft
确认 AI 生成的 pipeline 草案并保存为正式模板。草案必须先通过 `antigravity_generate_pipeline` 生成。

- **入参 (Input)**:
  - `draftId` (string, 必填): 生成结果中的 draft ID。
  - `title` (string, 可选): 覆盖模板标题。
  - `description` (string, 可选): 覆盖模板描述。
- **返回值 (Output)**:
  - `{ saved, templateId }` 或 `{ saved: false, validationErrors }`。
- **Hint**: **`destructive`**

---

## V5.4 — 平台化工具

### 18. antigravity_list_subgraphs
列出所有可用的可复用子图定义。

- **入参 (Input)**: 无。
- **返回值 (Output)**:
  - subgraph 定义数组。
- **Hint**: `readOnly`

### 19. antigravity_list_policies
列出资源配额策略。支持按 scope 和 targetId 过滤。

- **入参 (Input)**:
  - `scope` (enum, 可选): `"workspace"` / `"template"` / `"project"`。
  - `targetId` (string, 可选): 按目标 ID 过滤。
- **返回值 (Output)**:
  - 策略数组。
- **Hint**: `readOnly`

### 20. antigravity_check_policy
评估资源配额策略是否允许当前操作。根据当前 usage 计数器检查所有适用策略。

- **入参 (Input)**:
  - `workspaceUri` (string, 可选): workspace URI。
  - `templateId` (string, 可选): 模板 ID。
  - `projectId` (string, 可选): 项目 ID。
  - `runs` / `branches` / `iterations` / `stages` / `concurrentRuns` (number, 默认 0): 当前用量。
- **返回值 (Output)**:
  - `{ allowed, violations, warnings }`。
- **Hint**: `readOnly`

---

## 最佳实践指南

1. **取代脚本轮询**：若要监控项目进度，AI 应组合调用 `antigravity_get_project` -> 提取 `currentStage.runId` -> 调用 `antigravity_get_run` 这一链路，彻底抛弃旧版的 Python Terminal 查询习惯。
2. **闭环修复**：如果发现 `get_run` 报告的状态是 `timeout` 或 `failed`，且有对应的 `lastError` 描述，AI 可以分析原因后直接调用 `antigravity_intervene_run` 并通过附加 `prompt` 参数注入修复逻辑，从而无需人类介入。
3. **数据精简**：MCP Server 是经过修剪（Trim）后的输出。诸如内部的 AST 解析和庞大的 Work Package 二进制代码均已过滤，极大程度降低外部使用者的 Token 会话负担。
