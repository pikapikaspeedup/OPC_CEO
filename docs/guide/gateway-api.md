# Antigravity Gateway — 对外 API 文档

> **Base URL**: `http://localhost:3000`  
> **WebSocket**: `ws://localhost:3000/ws`  
> **认证**: 无需客户端传 API Key（Gateway 内部从 `state.vscdb` 自动获取）  
> **Content-Type**: 所有 POST 请求均使用 `application/json`  
> **Last Updated**: 2026-06-22

本文档面向 **Headless CLI** 及所有需要程序化调用 Antigravity 对话能力的场景。

---

## 快速开始：一个完整的对话生命周期

```bash
# 1. 查看可用 workspace 及其 language_server
curl http://localhost:3000/api/servers

# 2. 创建对话（指定 workspace URI）
CID=$(curl -sX POST http://localhost:3000/api/conversations \
  -H 'Content-Type: application/json' \
  -d '{"workspace": "file:///path/to/mytools"}' | jq -r .cascadeId)

# 3. 发送消息
curl -sX POST "http://localhost:3000/api/conversations/$CID/send" \
  -H 'Content-Type: application/json' \
  -d '{"text": "帮我分析这个项目的架构", "model": "MODEL_PLACEHOLDER_M26"}'

# 4. 等待后获取全部步骤
sleep 15
curl -s "http://localhost:3000/api/conversations/$CID/steps" | jq '.steps | length'

# 5. 提取 AI 回复文本
curl -s "http://localhost:3000/api/conversations/$CID/steps" | \
  jq -r '.steps[] | select(.plannerResponse) | .plannerResponse.modifiedResponse'
```

---

## 可用模型速查表

通过 `GET /api/models` 获取实时列表。当前可用：

| 内部 Model ID | 显示名称 | 图片 | 推荐 | 说明 |
|---------------|----------|------|------|------|
| `MODEL_PLACEHOLDER_M37` | Gemini 3.1 Pro (High) | ✅ | ⭐ | Gemini 旗舰，支持 PDF/音频/视频 |
| `MODEL_PLACEHOLDER_M36` | Gemini 3.1 Pro (Low) | ✅ | ⭐ | Gemini 旗舰低配额版 |
| `MODEL_PLACEHOLDER_M47` | Gemini 3 Flash | ✅ | ⭐ | 快速模型，支持 PDF/音频/视频 |
| `MODEL_PLACEHOLDER_M35` | Claude Sonnet 4.6 (Thinking) | ✅ | ⭐ | Claude 思考模型 |
| `MODEL_PLACEHOLDER_M26` | Claude Opus 4.6 (Thinking) | ✅ | ⭐ | Claude 最强模型 |
| `MODEL_OPENAI_GPT_OSS_120B_MEDIUM` | GPT-OSS 120B (Medium) | ❌ | ⭐ | OpenAI 开源模型 |

> **在 `send` 接口中**，`model` 字段使用上表的 **"内部 Model ID"** 列的值。不传则使用服务器默认。

---

## 核心对话接口

### `GET /api/conversations` — 列出所有对话

**功能**: 从 `.pb` 文件扫描 + gRPC 实时查询 + SQLite 兜底，合并返回所有已知对话。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `workspace` | `string` | 可选。按 workspace `file://` URI 过滤对话（前缀匹配） |

**Response** `200 OK`:
```json
[
  {
    "id": "7e95db6b-5b5d-4035-a387-d9fd1d882fdb",
    "title": "Documenting External APIs",
    "workspace": "file:///Applications/Antigravity.app/Contents/Resources/app",
    "mtime": 1773872543459.765,
    "steps": 515
  }
]
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 对话唯一 UUID（即 `cascadeId`） |
| `title` | `string` | 对话标题（由 AI 自动生成的摘要；无标题时为 `Conversation {id前8位}`） |
| `workspace` | `string` | 所属工作空间的 `file://` URI |
| `mtime` | `number` | 最后修改时间戳（毫秒级 Unix epoch） |
| `steps` | `number` | 总步骤数（含 user/AI/tool 等所有类型） |

---

### `POST /api/conversations` — 创建新对话

**功能**: 创建一个新的 Cascade 对话。内部自动处理 `AddTrackedWorkspace`（非专属 server 时）和 `UpdateConversationAnnotations`（防幽灵对话过滤）。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspace` | `string` | 否 | workspace `file://` URI。不传默认 `file:///path/to/mytools` |

特殊值 `"playground"` 会自动在 `~/.gemini/antigravity/playground/` 下创建沙箱目录。

```json
{ "workspace": "file:///path/to/my-project" }
```

**Response** `200 OK`:
```json
{ "cascadeId": "3cb98b88-b875-4611-85d7-0782321db911" }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `cascadeId` | `string` | 新建对话的 UUID，后续所有操作需用此 ID |

**错误响应**:

当指定的 workspace 没有运行中的 language_server 时，返回 `503`：
```json
{
  "error": "workspace_not_running",
  "message": "Workspace is not running. Please open it in Antigravity first.",
  "workspace": "file:///path/to/my-project"
}
```

**内部执行流程**（客户端无需关心）:
```
1. getLanguageServer(wsUri) → 找专属 server？
   ├─ YES → 直接使用
   └─ NO  → 返回 503 workspace_not_running
2. grpc.addTrackedWorkspace(port, csrf, workspacePath)
3. grpc.startCascade(port, csrf, apiKey, wsUri)
4. grpc.updateConversationAnnotations(cascadeId, {lastUserViewTime: now, summary: ...})
5. preRegisterOwner(cascadeId, conn) → ownerMap 预注册
6. addLocalConversation(cascadeId, wsUri, title) → 本地缓存
```

---

### `POST /api/conversations/:id/send` — 发送消息

**功能**: 异步提交用户消息给 AI。返回成功仅表示消息已提交，AI 回复需通过 WebSocket 或轮询 `/steps` 获取。

**URL 参数**: `:id` = `cascadeId`

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `text` | `string` | ✅ | 用户消息文本。支持 `@[path/to/file]` 语法引用文件（见下方说明） |
| `model` | `string` | 否 | 模型 ID（见模型速查表）。不传使用默认 |
| `agenticMode` | `boolean` | 否 | 是否启用 Agentic 模式（默认 `true`）。`false` 时使用 fast 模式 |
| `attachments` | `object` | 否 | 附件对象，包含 `items` 数组。用于传递文件引用等结构化附件 |

**文件引用语法**：

`text` 中可使用 `@[path/to/file]` 语法引用文件。服务端会自动解析为 `file://` URI 附件：
- 绝对路径：`@[/Users/you/project/src/app.ts]`
- 相对路径：`@[src/app.ts]`（相对于对话所属的 workspace 目录）

```json
{
  "text": "帮我重构这个函数 @[src/utils/helpers.ts]",
  "model": "MODEL_PLACEHOLDER_M26",
  "agenticMode": true
}
```

**Response** `200 OK`:
```json
{ "ok": true, "data": {} }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `ok` | `boolean` | 消息是否成功提交 |
| `data` | `object` | gRPC 原始返回（通常为空对象） |

**内部执行流程**:
```
1. 解析 @[path] 文件引用 → 转换为 attachments.items
2. refreshOwnerMap() → 确保 ownerMap 新鲜（30s 缓存）
3. getOwnerConnection(cascadeId) → 找到此对话所属的 server
4. grpc.sendMessage(port, csrf, apiKey, cascadeId, text, model, agenticMode, attachments)
```

---

### `GET /api/conversations/:id/steps` — 获取对话步骤

**功能**: 获取对话的完整步骤列表（从 checkpoint `.pb` 加载）。

**URL 参数**: `:id` = `cascadeId`

**Response** `200 OK`:
```json
{
  "steps": [
    {
      "type": "CORTEX_STEP_TYPE_USER_INPUT",
      "status": "CORTEX_STEP_STATUS_DONE",
      "userInput": {
        "items": [{ "text": "帮我分析这个项目" }]
      }
    },
    {
      "type": "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
      "status": "CORTEX_STEP_STATUS_DONE",
      "plannerResponse": {
        "modifiedResponse": "这是一个 Next.js 项目，使用了..."
      }
    },
    {
      "type": "CORTEX_STEP_TYPE_RUN_COMMAND",
      "status": "CORTEX_STEP_STATUS_DONE",
      "runCommand": {
        "command": "ls -la",
        "output": "total 64\ndrwxr-xr-x..."
      }
    },
    {
      "type": "CORTEX_STEP_TYPE_CODE_ACTION",
      "status": "CORTEX_STEP_STATUS_DONE",
      "codeAction": {
        "filePath": "/path/to/file.ts",
        "diff": "--- a/file.ts\n+++ b/file.ts\n..."
      }
    }
  ]
}
```

**Step 对象完整字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `string` | 步骤类型枚举（见下表） |
| `status` | `string` | `CORTEX_STEP_STATUS_DONE` / `_RUNNING` / `_PENDING` / `_ERROR` |
| `userInput` | `object?` | 用户输入（仅 `USER_INPUT` 类型） |
| `plannerResponse` | `object?` | AI 回复（仅 `PLANNER_RESPONSE` 类型） |
| `notifyUser` | `object?` | 用户审批请求（仅 `NOTIFY_USER` 类型） |
| `taskBoundary` | `object?` | 任务边界（仅 `TASK_BOUNDARY` 类型） |
| `codeAction` | `object?` | 代码操作（仅 `CODE_ACTION` 类型） |
| `runCommand` | `object?` | 命令执行（仅 `RUN_COMMAND` 类型） |
| `viewFile` | `object?` | 文件查看（仅 `VIEW_FILE` 类型） |
| `searchWeb` | `object?` | 网络搜索（仅 `SEARCH_WEB` 类型） |
| `grepSearch` | `object?` | 代码搜索（仅 `GREP_SEARCH` 类型） |
| `listDirectory` | `object?` | 目录列举（仅 `LIST_DIRECTORY` 类型） |
| `errorMessage` | `object?` | 错误信息（仅 `ERROR_MESSAGE` 类型） |

**Step Types 完整枚举**:

| Type 枚举值 | 含义 | 关键数据字段 |
|-------------|------|-------------|
| `CORTEX_STEP_TYPE_USER_INPUT` | 用户消息 | `userInput.items[].text` |
| `CORTEX_STEP_TYPE_PLANNER_RESPONSE` | AI 文本回复 | `plannerResponse.modifiedResponse` |
| `CORTEX_STEP_TYPE_NOTIFY_USER` | 需要用户审批/交互 | `notifyUser.message`, `.isBlocking`, `.pathsToReview[]`, `.shouldAutoProceed` |
| `CORTEX_STEP_TYPE_TASK_BOUNDARY` | 任务模式切换 | `taskBoundary.taskName`, `.mode` (`PLANNING`/`EXECUTION`/`VERIFICATION`), `.taskStatus`, `.taskSummary` |
| `CORTEX_STEP_TYPE_CODE_ACTION` | 创建/编辑文件 | `codeAction.filePath`, `.diff` |
| `CORTEX_STEP_TYPE_RUN_COMMAND` | 执行 Shell 命令 | `runCommand.command`, `.output`, `.exitCode` |
| `CORTEX_STEP_TYPE_VIEW_FILE` | 读取文件内容 | `viewFile.path`, `.content` |
| `CORTEX_STEP_TYPE_SEARCH_WEB` | 网络搜索 | `searchWeb.query`, `.results` |
| `CORTEX_STEP_TYPE_GREP_SEARCH` | 代码搜索 | `grepSearch.query`, `.results` |
| `CORTEX_STEP_TYPE_LIST_DIRECTORY` | 列出目录 | `listDirectory.path`, `.entries` |
| `CORTEX_STEP_TYPE_ERROR_MESSAGE` | 错误信息 | `errorMessage.message` |
| `CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE` | 系统临时消息 | （通常无可用字段） |
| `CORTEX_STEP_TYPE_CHECKPOINT` | 状态检查点标记 | （无数据，仅分隔符） |

---

### `POST /api/conversations/:id/cancel` — 取消生成

**功能**: 停止 AI 当前的生成任务。

**Request Body**: 无需 Body。

**Response** `200 OK`:
```json
{ "ok": true, "data": {} }
```

---

### `POST /api/conversations/:id/proceed` — 审批继续

**功能**: 当 AI 在某个 `NOTIFY_USER` 步骤等待用户审批时（`isBlocking: true`），调用此接口让 AI 继续工作。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `artifactUri` | `string` | ✅ | 审批的文件/资源 URI |
| `model` | `string` | 否 | 模型 ID |

```json
{ "artifactUri": "file:///path/to/reviewed/file.md", "model": "MODEL_PLACEHOLDER_M26" }
```

**Response** `200 OK`:
```json
{ "ok": true, "data": {} }
```

---

### `POST /api/conversations/:id/revert` — 回退步骤

**功能**: 回退对话到指定步骤索引处。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `stepIndex` | `number` | ✅ | 目标步骤索引（0-indexed） |
| `model` | `string` | 否 | 模型 ID |

```json
{ "stepIndex": 5, "model": "MODEL_PLACEHOLDER_M26" }
```

---

### `GET /api/conversations/:id/revert-preview` — 回退预览

> ⚠️ **注意**: 此端点目前仅在前端客户端代码中有调用，**后端尚未实现对应的 route handler**。调用会返回 404。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `stepIndex` | `number` | 目标步骤索引 |
| `model` | `string` | 模型 ID |

```
GET /api/conversations/abc123/revert-preview?stepIndex=5&model=MODEL_PLACEHOLDER_M26
```

---

## 实时流：WebSocket

### 连接地址

```
ws://localhost:3000/ws
```

### 客户端 → 服务器消息

#### 订阅对话更新
```json
{ "type": "subscribe", "cascadeId": "uuid" }
```

### 服务器 → 客户端推送

#### 步骤更新（`steps` 类型）
```json
{
  "type": "steps",
  "cascadeId": "uuid",
  "data": {
    "steps": [ ... ],
    "status": "CASCADE_RUN_STATUS_RUNNING",
    "conversationId": "uuid",
    "trajectoryId": "uuid"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"steps"` | 固定值 |
| `cascadeId` | `string` | 对话 UUID |
| `data.steps` | `Step[]` | **完整步骤数组**（后端已合并 delta，客户端直接替换即可） |
| `data.status` | `string` | `CASCADE_RUN_STATUS_RUNNING` = AI 工作中；`CASCADE_RUN_STATUS_IDLE` = AI 完成 |
| `data.conversationId` | `string` | 对话 UUID |
| `data.trajectoryId` | `string` | 轨迹 UUID |

### CLI 轮询替代方案

如果不方便使用 WebSocket，可以用轮询 `/steps` 替代：
```bash
while true; do
  STEPS=$(curl -s "http://localhost:3000/api/conversations/$CID/steps")
  COUNT=$(echo "$STEPS" | jq '.steps | length')
  LAST_TYPE=$(echo "$STEPS" | jq -r '.steps[-1].type // "none"')
  LAST_STATUS=$(echo "$STEPS" | jq -r '.steps[-1].status // "none"')
  echo "Steps: $COUNT | Last: $LAST_TYPE ($LAST_STATUS)"
  
  # 如果最后一步是 AI 回复且已完成，退出
  if [[ "$LAST_TYPE" == *"PLANNER_RESPONSE"* && "$LAST_STATUS" == *"DONE"* ]]; then
    echo "=== AI Reply ==="
    echo "$STEPS" | jq -r '.steps[-1].plannerResponse.modifiedResponse'
    break
  fi
  sleep 2
done
```

---

## V3 Agent 编排接口

这是从 V3 开始引入的顶层多智能体并行自治的编排 API，支持创建项目和解决冲突。详细调用说明请参阅 [cli-api-reference.md](./cli-api-reference.md)。

### `POST /api/projects` — 创建 Project

**功能**: 创建一个自治开发项目的容器，用于将多个相关的 Task 组织在一起。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | ✅ | 项目名称 |
| `goal` | `string` | ✅ | 项目目标描述 |
| `workspace` | `string` | ✅ | workspace `file://` URI |
| `templateId` | `string` | 否 | 模板 ID |
| `projectType` | `string` | 否 | 项目类型 |
| `skillHint` | `string` | 否 | 技能提示 |

**Request Body** 示例:
```json
{
  "name": "Tetris Game",
  "goal": "Build a simple Tetris game in HTML5",
  "workspace": "file:///path/to/mytools"
}
```

### `GET /api/projects/:id` — 获取项目详情

**功能**: 返回项目定义，包含 `runs` 数组（完整 `AgentRunState` 对象）。

### `PATCH /api/projects/:id` — 更新项目

**功能**: 部分更新项目属性。

### `DELETE /api/projects/:id` — 删除项目

**功能**: 删除指定项目。

**Response** `200 OK`:
```json
{ "success": true }
```

### `POST /api/scope-check` — WriteScope 冲突检测

**功能**: 在将多个 Work Package 并行派发给开发节点之前，验证各自写入范围是否有重叠冲突。

**Request Body** 示例:
```json
{
  "packages": [
    {
      "taskId": "task-1",
      "writeScope": [ { "path": "src/auth.ts", "operation": "modify" } ]
    }
  ]
}
```

---

## V4.4~V5.4 Pipeline 编排接口

以下是 V4.4 以来新增的 Pipeline 和 Project 管理 API。

### `POST /api/pipelines/lint` — 模板契约校验（V4.4）

**功能**: 校验 template 的 DAG 结构和 typed contracts。

**Request Body**:
```json
{ "templateId": "development-template-1" }
```

**Response** `200 OK`:
```json
{
  "templateId": "development-template-1",
  "valid": true,
  "dagErrors": [],
  "contractErrors": [],
  "contractWarnings": []
}
```

### `POST /api/pipelines/validate` — 通用模板校验（V5.1）

**功能**: 自动检测 `pipeline[]` 或 `graphPipeline` 格式，执行 DAG 结构和契约校验。

**Request Body**:
```json
{ "templateId": "my-template" }
```
或传入内联模板：
```json
{ "template": { "graphPipeline": { "nodes": [], "edges": [] } } }
```

**Response** `200 OK`:
```json
{
  "format": "graphPipeline",
  "valid": true,
  "dagErrors": [],
  "contractErrors": [],
  "contractWarnings": []
}
```

### `POST /api/pipelines/convert` — 格式互转（V5.1）

**功能**: 在 `pipeline[]` 和 `graphPipeline` 之间互转。

**Request Body**:
```json
{
  "direction": "pipeline-to-graph",
  "pipeline": [
    { "groupId": "project-planning", "autoTrigger": true },
    { "groupId": "development" }
  ]
}
```

**Response** `200 OK`:
```json
{
  "graphPipeline": {
    "nodes": [],
    "edges": []
  }
}
```

### `POST /api/projects/:id/gate/:nodeId/approve` — Gate 审批（V5.2）

**功能**: 审批或拒绝 pipeline 中的 gate 节点。

**Request Body**:
```json
{
  "action": "approve",
  "reason": "代码审查通过"
}
```

**Response** `200 OK`:
```json
{ "success": true, "nodeId": "review-gate", "decision": "approved" }
```

### `GET /api/projects/:id/checkpoints` — 列出 Checkpoint（V5.2）

**功能**: 列出项目的所有 pipeline 状态快照。

**Response** `200 OK`:
```json
{
  "checkpoints": [
    { "id": "cp-001", "nodeId": "loop-end-1", "createdAt": "2026-06-01T12:00:00Z", "iteration": 2 }
  ]
}
```

### `POST /api/projects/:id/checkpoints/:checkpointId/restore` — 从 Checkpoint 恢复（V5.2）

**功能**: 将 pipeline 状态恢复到指定 checkpoint。

**Response** `200 OK`:
```json
{ "restored": true, "checkpointId": "cp-001", "stageCount": 5 }
```

### `GET /api/projects/:id/journal` — 查询执行日志（V5.2）

**功能**: 返回项目的控制流执行日志。支持查询参数 `nodeId`、`type`、`limit` 过滤。

| 参数 | 类型 | 说明 |
|:-----|:-----|:-----|
| `nodeId` | string | 按节点 ID 过滤 |
| `type` | string | 按事件类型过滤（如 `gate:decided`、`loop:iteration`） |
| `limit` | number | 最大返回条数（默认 100，上限 1000） |

**Response** `200 OK`:
```json
{ "entries": [], "total": 42 }
```

### `POST /api/projects/:id/resume` — 恢复 Project Pipeline

**功能**: 恢复项目的 Pipeline 执行。支持多种恢复动作：`recover`、`nudge`、`restart_role`、`cancel`、`skip`、`force-complete`。

详细参数说明请参阅 [cli-api-reference.md](./cli-api-reference.md#resume-project-pipeline)。

**Response** `200 OK` / `202 Accepted`:
```json
{ "resumed": true, "checkpointId": "cp-003" }
```

### `POST /api/projects/:id/replay` — 回放到 Checkpoint（V5.2）

**功能**: 回放到指定 checkpoint。

**Request Body**:
```json
{ "checkpointId": "cp-001" }
```

### `POST /api/pipelines/generate` — AI 生成 Pipeline 草案（V5.3）

**功能**: 根据自然语言目标描述生成 graphPipeline 草案。

**Request Body**:
```json
{
  "goal": "构建微服务后端开发流程",
  "constraints": { "maxStages": 8, "allowFanOut": true }
}
```

**Response** `200 OK`:
```json
{
  "draftId": "draft-xxx",
  "graphPipeline": { "nodes": [], "edges": [] },
  "validationResult": { "valid": true },
  "riskAssessment": { "level": "low", "risks": [] },
  "templateMeta": { "title": "微服务开发模板" }
}
```

### `GET /api/pipelines/generate/:draftId` — 查看草案（V5.3）

**功能**: 查看已生成的 pipeline 草案详情。

### `POST /api/pipelines/generate/:draftId/confirm` — 确认草案（V5.3）

**功能**: 确认并保存 AI 草案为正式模板。**Destructive** — 会写入模板目录。

**Request Body**:
```json
{
  "templateMeta": { "title": "微服务开发模板" }
}
```

**Response** `200 OK`:
```json
{ "saved": true, "templateId": "generated-xxx" }
```

### `GET /api/pipelines/subgraphs` — 列出子图（V5.4）

**功能**: 列出所有可用的可复用子图定义。

### `GET /api/pipelines/policies` — 列出资源策略（V5.4）

**功能**: 列出所有资源配额策略。支持查询参数 `scope` 和 `targetId` 过滤。

### `POST /api/pipelines/policies/check` — 检查配额（V5.4）

**功能**: 评估当前 usage 是否违反资源策略。

**Request Body**:
```json
{
  "projectId": "xxx",
  "usage": { "runs": 15, "branches": 8, "iterations": 3, "stages": 10, "concurrentRuns": 2 }
}
```

**Response** `200 OK`:
```json
{ "allowed": true, "violations": [], "warnings": [] }
```

### `GET /api/projects/:id/diagnostics` — 项目健康诊断

**功能**: 返回项目健康摘要、活跃 stage、阻塞原因、分支异常。

### `POST /api/projects/:id/reconcile` — 项目状态修复

**功能**: 对项目执行幂等状态修复。支持 `dryRun` 参数（默认 true）。

### `GET /api/projects/:id/graph` — 获取项目 DAG 图

**功能**: 返回项目当前 pipeline 的 DAG IR 表示。

---

## CEO 命令接口

### `POST /api/ceo/command` — CEO 自然语言命令

**功能**: 接收 CEO 的自然语言命令，自动进行意图识别、部门匹配和任务派发。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | `string` | ✅ | CEO 的自然语言命令 |

```json
{ "command": "给后端团队安排一个登录模块的开发任务" }
```

**Response** `200 OK`:
```json
{
  "success": true,
  "action": "create_project",
  "message": "已在「后端研发」部门创建项目",
  "projectId": "abc123"
}
```

| Action 值 | 说明 |
|:----------|:-----|
| `create_project` | 在最匹配的部门创建了项目 |
| `multi_create` | 批量创建了多个项目 |
| `report_to_human` | 生成了各部门状态汇报 |
| `cancel` / `pause` / `resume` / `retry` / `skip` | 控制了运行中的任务 |
| `info` | 查询了特定信息 |
| `needs_decision` | 需要 CEO 在多个方案间选择（返回 `suggestions` 数组） |

---

## 审批接口

### `GET /api/approval` — 审批请求列表

**功能**: 获取所有审批请求。

**Response** `200 OK`: 数组，每项为 `ApprovalRequest` 对象。

### `POST /api/approval` — 提交审批请求

**功能**: 由 Agent 或系统提交新的审批请求。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `string` | ✅ | `token_increase` / `tool_access` / `provider_change` / `scope_extension` / `pipeline_approval` / `other` |
| `workspace` | `string` | ✅ | 发起部门的 workspace URI |
| `title` | `string` | ✅ | 审批标题 |
| `description` | `string` | ✅ | 详细描述 |
| `urgency` | `string` | 否 | `low` / `normal` / `high` / `critical`（默认 `normal`） |
| `runId` | `string` | 否 | 关联的 Run ID |

### `GET /api/approval/:id` — 审批详情

**功能**: 获取单个审批请求的详细信息。

### `PATCH /api/approval/:id` — 更新审批状态

**功能**: CEO 批准/拒绝审批请求。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | `string` | ✅ | `approved` / `rejected` / `feedback` |
| `message` | `string` | 否 | CEO 的回复消息 |

### `POST /api/approval/:id/feedback` — 审批反馈

**功能**: CEO 对审批请求提供反馈（不批准也不拒绝，仅给意见）。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | `string` | ✅ | 反馈内容 |

---

## 部门接口

### `GET /api/departments` — 获取部门配置

**功能**: 获取指定 workspace 的部门配置。如果 `.department/config.json` 不存在，返回默认配置。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `workspace` | `string` | 必填。workspace 绝对路径（不含 `file://` 前缀） |

**Response** `200 OK`:
```json
{
  "name": "后端研发",
  "type": "build",
  "description": "负责后端 API 和数据库",
  "skills": [],
  "okr": null,
  "provider": "antigravity",
  "tokenQuota": { "daily": 500000, "monthly": 10000000, "used": { "daily": 12300, "monthly": 456000 }, "canRequestMore": true }
}
```

**错误响应**:

| 状态码 | 条件 |
|--------|------|
| `400` | 缺少 `workspace` 参数 |
| `403` | workspace 不在已注册列表中（防路径穿越） |
| `422` | `.department/config.json` 格式错误 |

### `PUT /api/departments` — 更新部门配置

**功能**: 更新指定 workspace 的部门配置。如果 `.department/` 目录不存在，会自动创建。

**Query 参数**: 同 GET

**Request Body**: 完整的 `DepartmentConfig` JSON 对象。

### `POST /api/departments/sync` — 同步部门状态

**功能**: 触发部门状态同步（配置 → IDE 适配）。

### `GET /api/departments/digest` — 部门摘要

**功能**: 获取部门的日报/周报摘要（已完成任务、进行中任务、阻塞项、Token 用量）。

### `GET /api/departments/quota` — 配额查询

**功能**: 获取部门当前 Token 配额和使用情况。

### `GET /api/departments/memory` — 读取部门记忆

**功能**: 读取 `workspace/.department/memory/` 下的持久记忆内容。

### `POST /api/departments/memory` — 写入部门记忆

**功能**: 追加或更新部门记忆文件。

---

## 定时任务接口

### `GET /api/scheduler/jobs` — 定时任务列表

**功能**: 返回所有已注册的定时任务及其运行状态。

**Response** `200 OK`:
```json
[
  {
    "jobId": "abc-123",
    "name": "每日代码审查",
    "type": "cron",
    "cronExpression": "0 9 * * 1-5",
    "action": {
      "kind": "dispatch-pipeline",
      "templateId": "coding-basic",
      "workspace": "/Users/darrel/Projects/backend",
      "prompt": "审查昨日提交的代码"
    },
    "enabled": true,
    "lastRunAt": "2026-04-04T09:00:00Z",
    "lastRunResult": "success",
    "departmentWorkspaceUri": "/Users/darrel/Projects/backend",
    "createdAt": "2026-04-01T10:00:00Z"
  }
]
```

### `POST /api/scheduler/jobs` — 创建定时任务

**功能**: 注册新的定时任务。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | ✅ | 任务名称 |
| `type` | `string` | ✅ | `cron` / `interval` / `once` |
| `cronExpression` | `string` | 条件 | cron 表达式（type=cron 时必填） |
| `intervalMs` | `number` | 条件 | 间隔毫秒数（type=interval 时必填） |
| `scheduledAt` | `string` | 条件 | 执行时间（type=once 时必填，ISO 8601） |
| `action` | `object` | ✅ | 执行动作，见下方 |
| `enabled` | `boolean` | 否 | 是否启用（默认 `true`） |
| `departmentWorkspaceUri` | `string` | 否 | 关联的 OPC 部门 workspace |
| `opcAction` | `object` | 否 | OPC 专用动作（自动创建项目） |

**Action 类型**:

| kind | 说明 | 必填字段 |
|------|------|---------|
| `dispatch-pipeline` | 派发 Pipeline | `templateId`, `workspace`, `prompt` |
| `dispatch-group` | 派发 Agent Group | `groupId`, `workspace`, `prompt` |
| `health-check` | 项目健康检查 | `projectId` |

### `GET /api/scheduler/jobs/:id` — 任务详情

**功能**: 获取单个定时任务的详细信息。

### `PATCH /api/scheduler/jobs/:id` — 更新任务

**功能**: 更新定时任务的配置（如启用/禁用、修改 cron 表达式）。

### `DELETE /api/scheduler/jobs/:id` — 删除任务

**功能**: 删除定时任务。

### `POST /api/scheduler/jobs/:id/trigger` — 手动触发任务

**功能**: 立即触发一次定时任务执行（不影响下次 cron 触发时间）。

---

## 交付物接口

### `GET /api/projects/:id/deliverables` — 交付物列表

**功能**: 获取项目的所有交付物。

**Response** `200 OK`:
```json
[
  {
    "id": "del-001",
    "projectId": "proj-123",
    "stageId": "stage-0",
    "type": "document",
    "title": "产品需求文档 v1",
    "artifactPath": "specs/product-spec.md",
    "createdAt": "2026-04-04T12:00:00Z",
    "quality": {
      "reviewDecision": "approved",
      "reviewedAt": "2026-04-04T13:00:00Z"
    }
  }
]
```

### `POST /api/projects/:id/deliverables` — 添加交付物

**功能**: 为项目添加一个交付物记录。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `stageId` | `string` | ✅ | 所属 Stage ID |
| `type` | `string` | ✅ | `document` / `code` / `data` / `review` |
| `title` | `string` | ✅ | 交付物标题 |
| `artifactPath` | `string` | 否 | 产物文件路径 |

---

## 运维接口

### `GET /api/operations/audit` — 审计日志

**功能**: 获取系统审计事件日志。

### `GET /api/logs` — 日志查看

**功能**: 获取系统运行日志。

---

## 环境与配置接口

### `GET /api/servers` — Language Server 实例

**功能**: 列出所有正在运行的 `language_server_macos_arm` 进程及其端口、CSRF token、关联 workspace。

**Response** `200 OK`:
```json
[
  {
    "pid": 54642,
    "port": 52980,
    "csrf": "265bb393-840b-4f6b-8ce9-d02ddd7404e6",
    "workspace": "file:///path/to/Antigravity-Mobility-CLI"
  },
  {
    "pid": 4029,
    "port": 54187,
    "csrf": "023bbbe9-a7c0-4d2f-b034-f48f77f6b49c",
    "workspace": "file:///path/to/mytools"
  }
]
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `pid` | `number` | 操作系统进程 ID |
| `port` | `number` | gRPC HTTPS 端口 |
| `csrf` | `string` | CSRF Token（Gateway 内部使用） |
| `workspace` | `string` | 关联的 workspace `file://` URI |

---

### `GET /api/workspaces` — 所有已知 Workspace

**功能**: 从 SQLite `state.vscdb` 读取所有注册过的 workspace（含当前未运行的）。

**Response** `200 OK`:
```json
{
  "workspaces": [
    { "uri": "file:///path/to/mytools", "name": "mytools" }
  ],
  "playgrounds": [
    { "name": "vast-orion", "path": "~/.gemini/antigravity/playground/vast-orion" }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `workspaces` | `Array` | 注册过的 workspace 列表 |
| `workspaces[].uri` | `string` | Workspace `file://` URI |
| `workspaces[].name` | `string` | 显示名称 |
| `playgrounds` | `Array` | 沙箱 playground 列表 |
| `playgrounds[].name` | `string` | Playground 名称 |
| `playgrounds[].path` | `string` | 磁盘绝对路径 |

---

### `POST /api/workspaces/launch` — 启动 Workspace

**功能**: 在 Antigravity IDE 中打开一个新的 workspace 窗口并启动其 language_server。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspace` | `string` | ✅ | workspace `file://` URI |

```json
{ "workspace": "file:///path/to/my-project" }
```

**Response** `200 OK`:
```json
{ "ok": true }
```

> ⚠️ 启动是异步的。响应成功仅表示命令已发送，language_server 可能需要 5-30 秒才能完全就绪。建议轮询 `GET /api/servers` 等待目标 server 出现。

---

### `POST /api/workspaces/close` — 隐藏 Workspace

**功能**: 从 React 前端侧边栏隐藏指定 workspace。**不会杀死 language_server 进程**。

> ⚠️ **重要**: 此接口仅在前端 UI 层面隐藏 workspace，language_server 保持运行。这是有意设计 — 杀死 language_server 会导致 Antigravity IDE 崩溃。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspace` | `string` | ✅ | 要隐藏的 workspace `file://` URI |

```json
{ "workspace": "file:///path/to/mytools" }
```

**Response** `200 OK`:
```json
{ "ok": true, "hidden": true, "windowMinimized": true }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `ok` | `boolean` | 操作是否成功 |
| `hidden` | `boolean` | workspace 是否已隐藏 |
| `windowMinimized` | `boolean` | 是否成功最小化了 Antigravity IDE 窗口 |

---

### `POST /api/workspaces/kill` — 停止 Workspace

**功能**: 真正停止指定 workspace 的 `language_server` 进程。

> ⚠️ **危险操作**: 这会杀死 language_server 进程。如果该 workspace 同时在 Antigravity IDE 中打开，IDE 会断开连接并显示错误。仅需从侧边栏隐藏请用 `POST /api/workspaces/close`。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspace` | `string` | ✅ | 要停止的 workspace `file://` URI |

```json
{ "workspace": "file:///path/to/mytools" }
```

**Response** `200 OK`:
```json
{ "ok": true, "killed": { "pid": 54642, "port": 52980, "windowClosed": true } }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `killed.pid` | `number` | 被终止的进程 ID |
| `killed.port` | `number` | 被终止的 gRPC 端口 |
| `killed.windowClosed` | `boolean` | 是否通过 AppleScript 关闭了窗口（false 则回退到 SIGTERM） |

---

### `GET /api/workspaces/close` — 列出已隐藏 Workspace

**功能**: 返回当前被隐藏的 workspace URI 列表。

**Response** `200 OK`:
```json
["file:///path/to/mytools"]
```

---

### `DELETE /api/workspaces/close` — 取消隐藏 Workspace

**功能**: 将之前隐藏的 workspace 重新显示在侧边栏。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspace` | `string` | ✅ | 要取消隐藏的 workspace `file://` URI |

```json
{ "workspace": "file:///path/to/mytools" }
```

**Response** `200 OK`:
```json
{ "ok": true, "hidden": false }
```

### `GET /api/me` — 当前用户

**Response** `200 OK`:
```json
{
  "name": "Your Name",
  "email": "user@example.com",
  "hasApiKey": true,
  "credits": { "clientModelConfigs": [ ... ] }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 用户名 |
| `email` | `string` | 邮箱 |
| `hasApiKey` | `boolean` | 是否已登录（有 API Key） |
| `credits` | `object` | 模型配额信息（同 `/api/models` 返回） |

> ⚠️ `apiKey` 字段被有意隐藏，不对外暴露。

---

### `GET /api/models` — 可用模型与配额

**功能**: 从 language_server 获取当前可用的 AI 模型列表，含实时配额信息。

**Response** `200 OK`:
```json
{
  "clientModelConfigs": [
    {
      "label": "Claude Opus 4.6 (Thinking)",
      "modelOrAlias": { "model": "MODEL_PLACEHOLDER_M26" },
      "supportsImages": true,
      "isRecommended": true,
      "allowedTiers": [
        "TEAMS_TIER_PRO", "TEAMS_TIER_TEAMS",
        "TEAMS_TIER_ENTERPRISE_SELF_HOSTED", "TEAMS_TIER_ENTERPRISE_SAAS",
        "TEAMS_TIER_HYBRID", "TEAMS_TIER_PRO_ULTIMATE"
      ],
      "quotaInfo": {
        "remainingFraction": 1,
        "resetTime": "2026-03-19T01:31:23Z"
      },
      "supportedMimeTypes": {
        "image/jpeg": true, "image/png": true, "image/webp": true,
        "image/heic": true, "image/heif": true
      }
    },
    {
      "label": "Gemini 3.1 Pro (High)",
      "modelOrAlias": { "model": "MODEL_PLACEHOLDER_M37" },
      "supportsImages": true,
      "isRecommended": true,
      "tagTitle": "New",
      "quotaInfo": { "remainingFraction": 1, "resetTime": "2026-03-19T01:13:26Z" },
      "supportedMimeTypes": {
        "application/pdf": true, "application/json": true,
        "audio/webm;codecs=opus": true,
        "video/mp4": true, "video/webm": true,
        "text/plain": true, "text/markdown": true,
        "image/jpeg": true, "image/png": true
      }
    }
  ]
}
```

**Model Config 字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `label` | `string` | 面向用户的模型显示名 |
| `modelOrAlias.model` | `string` | **内部模型 ID**（用于 `send` 接口的 `model` 参数） |
| `supportsImages` | `boolean?` | 是否支持图片输入 |
| `isRecommended` | `boolean?` | 是否推荐模型 |
| `tagTitle` | `string?` | 标签（如 "New"） |
| `allowedTiers` | `string[]` | 允许使用的订阅层级 |
| `quotaInfo.remainingFraction` | `number` | 剩余配额比例（1 = 满额，0 = 耗尽） |
| `quotaInfo.resetTime` | `string` | 配额重置时间（ISO 8601） |
| `supportedMimeTypes` | `object` | 支持的文件 MIME 类型映射 |

---

### `GET /api/skills` — 所有 Skills

**功能**: 从所有 language_server 聚合 Skills（全局 + 工作空间），去重后返回。

**Response** `200 OK`:
```json
[
  {
    "name": "algorithmic-art",
    "description": "Creating algorithmic art using p5.js with seeded randomness and interactive parameter exploration...",
    "path": "~/.gemini/antigravity/skills/algorithmic-art/SKILL.md",
    "baseDir": "file://~/.gemini/antigravity",
    "scope": "global"
  },
  {
    "name": "frontend-design",
    "description": "Create distinctive, production-grade frontend interfaces with high design quality...",
    "path": "~/.gemini/antigravity/skills/frontend-design/SKILL.md",
    "baseDir": "file://~/.gemini/antigravity",
    "scope": "global"
  }
]
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | Skill 名称（可用于 `@` 触发） |
| `description` | `string` | 功能描述 |
| `path` | `string` | `SKILL.md` 文件的绝对路径 |
| `baseDir` | `string` | Skill 所在的根目录 |
| `scope` | `"global" \| "workspace"` | 作用域（全局或特定工作空间） |

---

### `GET /api/skills/:name` — 单个 Skill 详情

**URL 参数**: `:name` = Skill 名称（如 `frontend-design`）

**Response** `200 OK`: 返回 gRPC 原始 Skill 对象（含完整定义）。

**Response** `404`: `{ "error": "Skill not found" }`

---

### `GET /api/workflows` — 所有 Workflows

**功能**: 从所有 language_server 聚合 Workflows，去重后返回。

> 这是一个**发现/读取接口**。Gateway 负责枚举可用 workflow；真正执行 workflow 的方式，是在对话中发送对应的 `/workflow-name` 命令。

**Response** `200 OK`:
```json
[
  {
    "name": "ai-topic-discovery",
    "description": "AI 赛道自媒体选题发现与评估。从 MeiliSearch 新闻数据库扫描近期 AI 热点标题...",
    "path": "~/.gemini/antigravity/global_workflows/ai-topic-discovery.md",
    "content": "---\ndescription: ...\n---\n具体 workflow 步骤内容...",
    "scope": "global",
    "baseDir": "file://~/.gemini/antigravity"
  }
]
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | Workflow 名称（可用于 `/` 触发） |
| `description` | `string` | 功能描述 |
| `path` | `string` | Workflow `.md` 文件绝对路径 |
| `content` | `string` | **完整的 Workflow markdown 内容**（含 YAML frontmatter） |
| `scope` | `"global" \| "workspace"` | 作用域 |
| `baseDir` | `string` | 所在根目录 |

---

### `GET /api/rules` — 自定义规则

**功能**: 从所有 language_server 聚合用户自定义规则。

> 这也是一个**发现/读取接口**。Gateway 只负责展示和返回规则内容；规则的实际生效由底层 language_server / 客户端规则系统负责。

**Response** `200 OK`:
```json
[
  {
    "name": "rule-name",
    "description": "规则描述",
    "path": "/path/to/rules.md",
    "content": "规则内容...",
    "scope": "global",
    "baseDir": "file:///..."
  }
]
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 规则名称 |
| `description` | `string` | 描述 |
| `path` | `string` | 规则文件绝对路径 |
| `content` | `string` | 完整规则内容 |
| `scope` | `"global" \| "workspace"` | 作用域 |
| `baseDir` | `string` | 所在根目录 |

---

### `GET /api/analytics` — 用户使用分析

**功能**: 获取用户使用统计信息（gRPC `GetUserAnalyticsSummary`）。

**Response** `200 OK`: gRPC 原始返回。

---

### `GET /api/mcp` — MCP 配置

**功能**: 读取 `~/.gemini/antigravity/mcp_config.json` 的 MCP 服务器配置。

**Response** `200 OK`:
```json
{
  "servers": []
}
```

---

## 错误处理

所有接口统一的错误响应格式：
```json
{ "error": "错误描述信息" }
```

| HTTP Status | 含义 | 典型场景 |
|-------------|------|----------|
| `200` | 成功 | — |
| `404` | 未找到 | 对话 ID 不存在、Skill 名称不存在 |
| `500` | 服务器内部错误 | gRPC 调用失败、language_server 无响应 |
| `503` | 服务不可用 | 无运行中的 language_server、无 API Key（未登录） |

---

## Headless CLI 集成示例

### Python: 完整对话 + 等待回复

```python
import requests, time, json

BASE = "http://localhost:3000"

# 1. 查看有哪些 workspace 和模型
servers = requests.get(f"{BASE}/api/servers").json()
models = requests.get(f"{BASE}/api/models").json()
print("Workspaces:", [s["workspace"] for s in servers])
print("Models:", [(m["label"], m["modelOrAlias"]["model"]) 
                  for m in models["clientModelConfigs"]])

# 2. 创建对话
ws = servers[0]["workspace"]  # 使用第一个 workspace
r = requests.post(f"{BASE}/api/conversations", json={"workspace": ws})
cid = r.json()["cascadeId"]
print(f"Created conversation: {cid}")

# 3. 发送消息
requests.post(f"{BASE}/api/conversations/{cid}/send",
    json={"text": "列出项目中所有的 Python 文件", 
          "model": "MODEL_PLACEHOLDER_M26"})

# 4. 轮询等待 AI 完成
prev_count = 0
for i in range(60):
    time.sleep(2)
    r = requests.get(f"{BASE}/api/conversations/{cid}/steps")
    steps = r.json().get("steps", [])
    
    if len(steps) > prev_count:
        prev_count = len(steps)
        last = steps[-1]
        step_type = last.get("type", "").replace("CORTEX_STEP_TYPE_", "")
        status = last.get("status", "").replace("CORTEX_STEP_STATUS_", "")
        print(f"  [{i*2}s] Steps: {len(steps)} | {step_type} ({status})")
        
        # AI 回复完成
        if step_type == "PLANNER_RESPONSE" and status == "DONE":
            print("\n=== AI Reply ===")
            print(last["plannerResponse"]["modifiedResponse"])
            break
        
        # 需要审批
        if step_type == "NOTIFY_USER" and last.get("notifyUser", {}).get("isBlocking"):
            print("AI is waiting for approval!")
            # 自动 proceed
            requests.post(f"{BASE}/api/conversations/{cid}/proceed",
                json={"artifactUri": "", "model": "MODEL_PLACEHOLDER_M26"})
```

### Shell: 一行式快速提问

```bash
CID=$(curl -sX POST http://localhost:3000/api/conversations \
  -H 'Content-Type: application/json' \
  -d '{"workspace":"file:///path/to/mytools"}' | jq -r .cascadeId) && \
curl -sX POST "http://localhost:3000/api/conversations/$CID/send" \
  -H 'Content-Type: application/json' \
  -d '{"text":"这个项目是做什么的？","model":"MODEL_PLACEHOLDER_M26"}' && \
echo "Waiting..." && sleep 15 && \
curl -s "http://localhost:3000/api/conversations/$CID/steps" | \
  jq -r '[.steps[] | select(.plannerResponse)] | last | .plannerResponse.modifiedResponse'
```

### Node.js: WebSocket 实时监听

```javascript
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000/ws');
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'subscribe', cascadeId: 'your-cascade-id' }));
});
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'steps') {
    const { steps, status } = msg.data;
    console.log(`Steps: ${steps.length}, Status: ${status}`);
    
    const lastAI = [...steps].reverse().find(s => s.plannerResponse);
    if (lastAI) {
      console.log('AI:', lastAI.plannerResponse.modifiedResponse.slice(0, 200));
    }
    
    if (status === 'CASCADE_RUN_STATUS_IDLE') {
      console.log('AI finished.');
      ws.close();
    }
  }
});
```
