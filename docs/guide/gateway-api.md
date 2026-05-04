# Antigravity Gateway — 对外 API 文档

> **Base URL**: `http://localhost:3000`  
> **WebSocket**: `ws://localhost:3000/ws`  
> **认证**: 无需客户端传 API Key（Gateway 内部从 `state.vscdb` 自动获取）  
> **Content-Type**: 所有 POST 请求均使用 `application/json`  
> **Last Updated**: 2026-06-22

本文档面向 **Headless CLI** 及所有需要程序化调用 Antigravity 对话能力的场景。

> V6.1 Stage-Centric Migration:
> 对外编排接口已经改为 `templateId + stageId`。
> 模板持久化不再包含 `groups{}`，而是把 `executionMode`、`roles`、`sourceContract.acceptedSourceStageIds` 直接内联到 stage / node。
> `/api/agent-groups` 与 scheduler `dispatch-group` 已移除。

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

通过 `GET /api/models` 获取模型列表。当前策略是：

- 若存在 Antigravity server：返回 gRPC 模型列表，并合并 provider-aware fallback
- 若没有 Antigravity server：返回 provider-aware fallback model 列表

因此在纯云端 provider 场景下，`/api/models` 也能出现例如：

- `Native Codex · GPT-5.4`
- `Claude API · Sonnet 4`
- `OpenAI API · GPT-4.1`
- `Gemini API · Gemini 2.5 Pro`
- `Grok API · Grok 3`

当前 gRPC 实时列表示例如下：

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

> 列表分页约定（2026-04-20）:
> `GET /api/conversations`、`GET /api/projects`、`GET /api/agent-runs`、`GET /api/company/run-capsules`、`GET /api/company/memory-candidates`、`GET /api/company/signals`、`GET /api/company/agenda`、`GET /api/company/budget/*`、`GET /api/company/circuit-breakers`、`GET /api/company/growth/proposals`、`GET /api/company/loops/*`、`GET /api/company/self-improvement/*`、`GET /api/scheduler/jobs`、`GET /api/projects/:id/checkpoints`、`GET /api/projects/:id/journal`、`GET /api/projects/:id/deliverables`、`GET /api/operations/audit` 统一支持 `page/pageSize`，响应统一为 `{ items, page, pageSize, total, hasMore }`。
> `journal` / `audit` 的旧 `limit` 仍可用，但已被视为 `pageSize` 别名。

> Split-mode API ownership（2026-04-21）:
> 在 `AG_ROLE=web` 且配置了 `AG_CONTROL_PLANE_URL` / `AG_RUNTIME_URL` 时，`web` 只负责页面与 WS ingress，不再执行前端主链的控制面业务逻辑。
> - `control-plane` 负责：`/api/approval*`、`/api/ai-config`、`/api/provider-model-catalog`、`/api/provider-image-generation`、`/api/api-keys*`、`/api/ceo/*`、`/api/departments/*`、`/api/mcp*`、`/api/workspaces`、`/api/workspaces/import`、`/api/workspaces/close`
> - `runtime` 负责：`/api/me`、`/api/models`、`/api/workspaces/launch`、`/api/workspaces/kill`，以及 conversation send/steps/cancel、run stream/intervene 等运行时接口
> - `api` 组合服务允许同一路径按 method 分流；例如 `GET /api/conversations` 归 control-plane，`POST /api/conversations` 归 runtime，路由器会在 405 后继续匹配后续同路径 route。

### `GET /api/conversations` — 列出所有对话

**功能**: 从 SQLite conversation projection 返回所有已知对话；请求热路径不再同步扫描 `.pb / brain / trajectory`。

> 当 workspace 命中 Gateway 本地会话轨道时，对话可能只存在于 Gateway 本地缓存，不会落 `.pb`。当前该轨道包括：
>
> - `native-codex`
> - `claude-api`
> - `openai-api`
> - `gemini-api`
> - `grok-api`
> - `custom`
>
> 其中 `codex` / `claude-code` 属于执行工具层，不是 provider；它们在 Claude Engine 中通过 `ExecutionTool` 被调用，而不是作为这里的 provider 选择项。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `workspace` | `string` | 可选。按 workspace `file://` URI 过滤对话（前缀匹配） |
| `page` | `number` | 可选。页码，默认 `1` |
| `pageSize` | `number` | 可选。每页条数 |

**Response** `200 OK`:
```json
{
  "items": [
    {
      "id": "7e95db6b-5b5d-4035-a387-d9fd1d882fdb",
      "title": "Documenting External APIs",
      "workspace": "file:///Applications/Antigravity.app/Contents/Resources/app",
      "mtime": 1773872543459.765,
      "steps": 515
    }
  ],
  "page": 1,
  "pageSize": 100,
  "total": 253,
  "hasMore": true
}
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

**功能**: 创建一个新的对话。

- `antigravity` / Playground：创建真实 Cascade，对接 language_server
- Gateway 本地 conversation：创建 Gateway 本地 conversation，不依赖 IDE / language_server

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

当 provider 为 Gateway 本地会话路径时，返回可能类似：

```json
{
  "cascadeId": "local-native-codex-7f8498a5-a7a9-4aec-9d3d-167ecffccdc2",
  "state": "idle",
  "provider": "native-codex"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `cascadeId` | `string` | 新建对话的 UUID，后续所有操作需用此 ID |

**错误响应**:

当指定的 workspace provider 仍是 `antigravity` 且没有运行中的 language_server 时，返回 `503`：
```json
{
  "error": "workspace_not_running",
  "message": "Workspace is not running. Please open it in Antigravity first.",
  "workspace": "file:///path/to/my-project"
}
```

**内部执行流程**（客户端无需关心）:
```
1. resolveProvider('execution', workspacePath)
2. 若 provider ∈ {`native-codex`, `claude-api`, `openai-api`, `gemini-api`, `grok-api`, `custom`}
   ├─ 直接创建 `local-*` conversation
   └─ 写入 SQLite / 本地缓存
3. 若 provider = `antigravity`
   ├─ getLanguageServer(wsUri) → 找专属 server
   ├─ grpc.addTrackedWorkspace(...)
   ├─ grpc.startCascade(...)
   ├─ grpc.updateConversationAnnotations(...)
   └─ preRegisterOwner(...) + addLocalConversation(...)
```

---

### `POST /api/conversations/:id/send` — 发送消息

**功能**: 提交用户消息给 AI。

- Antigravity conversation：异步提交给 gRPC，后续通过 WebSocket 或轮询 `/steps` 获取
- Gateway 本地 conversation：Gateway 同步执行本地 provider，随后把 transcript 写回本地 steps 文件
- Gateway 本地执行路径返回 `status=failed` 时，接口返回 `502 { "error": "..." }`，不再把失败内容伪装成成功 assistant 回复
- Native Codex 请求默认 90s 超时，可通过 `NATIVE_CODEX_TIMEOUT_MS` 调整

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
1. 判断 conversation 是否为 Gateway 本地 conversation
2. 若是 Gateway 本地 conversation
   ├─ 首次消息：`executor.executeTask(...)`
   ├─ 后续消息：`executor.appendMessage(sessionHandle, ...)`
   └─ transcript 写回本地 steps 文件
3. 若是 Antigravity conversation
   ├─ 解析 `@[path]` → `attachments.items`
   ├─ refreshOwnerMap()
   ├─ getOwnerConnection(cascadeId)
   └─ grpc.sendMessage(...)
```

---

### `GET /api/conversations/:id/steps` — 获取对话步骤

**功能**: 获取对话的完整步骤列表。

- Antigravity conversation：从 checkpoint / gRPC 拉取
- Gateway 本地 conversation：从 Gateway 管理的本地 transcript / provider transcript store 回放

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

> Gateway 本地 conversation 返回的 transcript 也会标准化成前端可渲染的 CORTEX step，例如：
>
> - `CORTEX_STEP_TYPE_USER_INPUT`
> - `CORTEX_STEP_TYPE_PLANNER_RESPONSE`

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
| `errorMessage` | `object?` | 结构化错误信息（仅 `ERROR_MESSAGE` 类型） |

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
| `CORTEX_STEP_TYPE_ERROR_MESSAGE` | 错误信息 | `errorMessage.error.userErrorMessage`, `errorMessage.message`, `errorMessage.error.shortError` |
| `CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE` | 系统临时消息 | （通常无可用字段） |
| `CORTEX_STEP_TYPE_CHECKPOINT` | 状态检查点标记 | （无数据，仅分隔符） |

`ERROR_MESSAGE` 的常用字段：

| 字段 | 说明 |
|------|------|
| `errorMessage.message` / `errorMessage.errorMessage` | 旧版纯文本错误，兼容保留 |
| `errorMessage.error.userErrorMessage` | 用户可读的失败原因，前端优先展示 |
| `errorMessage.error.shortError` | 简短技术原因，适合做次级说明 |
| `errorMessage.error.errorCode` | HTTP / RPC 错误码 |
| `errorMessage.error.fullError` | 完整原始错误文本，适合展开查看 |
| `errorMessage.error.rpcErrorDetails` | 结构化 RPC 细节 |

---

### `POST /api/conversations/:id/cancel` — 取消生成

**功能**: 停止 AI 当前的生成任务。

- Antigravity conversation：调用 gRPC `cancelCascade`
- Gateway 本地 conversation：
  - 若当前有进行中的 API-backed 请求：尝试中断
  - 若当前没有活动请求：返回 `not_running`

**Request Body**: 无需 Body。

**Response** `200 OK`:
```json
{ "ok": true, "data": {} }
```

Gateway 本地 conversation 的典型返回可能是：

```json
{
  "ok": true,
  "data": {
    "status": "not_running",
    "provider": "native-codex"
  }
}
```

---

### `POST /api/conversations/:id/proceed` — 审批继续

**功能**: 当 AI 在某个 `NOTIFY_USER` 步骤等待用户审批时（`isBlocking: true`），调用此接口让 AI 继续工作。

> 对 Gateway 本地 conversation，这类审批语义通常不适用。当前会返回：
>
> - `ok: true`
> - `status: "not_applicable"`

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

- Antigravity conversation：通过 gRPC 回退
- Gateway 本地 conversation：直接截断本地 transcript / transcript store

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `stepIndex` | `number` | ✅ | 目标步骤索引（0-indexed） |
| `model` | `string` | 否 | 模型 ID |

```json
{ "stepIndex": 5, "model": "MODEL_PLACEHOLDER_M26" }
```

Gateway 本地 conversation 的典型响应：

```json
{
  "ok": true,
  "data": {
    "cascadeId": "local-native-codex-...",
    "stepIndex": 0,
    "stepCount": 1
  }
}
```

---

### `GET /api/conversations/:id/revert-preview` — 回退预览

**功能**: 获取回退后的步骤预览。

- Antigravity conversation：通过 gRPC 获取预览
- Gateway 本地 conversation：直接返回截断后的 preview steps

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `stepIndex` | `number` | 目标步骤索引 |
| `model` | `string` | 模型 ID |

```
GET /api/conversations/abc123/revert-preview?stepIndex=5&model=MODEL_PLACEHOLDER_M26
```

Gateway 本地 conversation 返回示例：

```json
{
  "cascadeId": "local-native-codex-...",
  "stepIndex": 0,
  "steps": [
    {
      "type": "CORTEX_STEP_TYPE_USER_INPUT"
    }
  ]
}
```

---

## Agent Run 调度

### `POST /api/agent-runs` — 派发 Department Run

**功能**: 创建一个新的 prompt run 或 template run，并允许调用方显式下发 Department runtime 合同。手动派发会写入 Company Kernel token/runtime budget ledger，但不消耗 autonomous dispatch quota；scheduler 触发已由 scheduler 自己的 budget gate 负责。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspace` | `string` | ✅ | 目标工作区绝对路径 |
| `templateId` / `pipelineId` | `string` | 否 | 模板 ID；与 `executionTarget.kind = "template"` 二选一 |
| `stageId` | `string` | 否 | 目标 stage ID |
| `prompt` | `string` | 否 | 自由文本目标；`prompt` 或 `taskEnvelope.goal` 至少其一 |
| `taskEnvelope` | `object` | 否 | 结构化任务体 |
| `executionTarget` | `object` | 否 | 显式指定 `prompt` 或 `template` 路径 |
| `executionProfile` | `object` | 否 | 执行画像；会在路由层归一化并继续下传 |
| `departmentRuntimeContract` / `runtimeContract` | `object` | 否 | Department 级 runtime 合同，声明目录边界、工具集、权限模式与交付要求 |
| `projectId` | `string` | 否 | 归属 Project |
| `sourceRunIds` | `string[]` | 否 | 上游 run 依赖 |
| `model` | `string` | 否 | 覆盖模型 |
| `parentConversationId` | `string` | 否 | 父会话 ID |

**Department runtime 合同字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `workspaceRoot` | `string` | Department 主工作目录 |
| `additionalWorkingDirectories` | `string[]` | 额外挂载目录 |
| `readRoots` | `string[]` | 允许读取的目录根 |
| `writeRoots` | `string[]` | 允许写入的目录根 |
| `artifactRoot` | `string` | 产物根目录 |
| `executionClass` | `string` | `light` / `artifact-heavy` / `review-loop` / `delivery` |
| `toolset` | `string` | `research` / `coding` / `safe` / `full` |
| `permissionMode` | `string` | `default` / `dontAsk` / `acceptEdits` / `bypassPermissions` |
| `requiredArtifacts[]` | `array` | 每个产物包含 `path`、`required`、可选 `format`、`description` |

**示例**:

```json
{
  "templateId": "development-template-1",
  "stageId": "product-spec",
  "workspace": "/Users/you/project",
  "prompt": "输出产品规格草案",
  "executionProfile": {
    "kind": "workflow-run",
    "workflowRef": "/pm-author"
  },
  "departmentRuntimeContract": {
    "workspaceRoot": "/Users/you/project",
    "additionalWorkingDirectories": [
      "/Users/you/shared-notes"
    ],
    "readRoots": [
      "/Users/you/project",
      "/Users/you/shared-notes"
    ],
    "writeRoots": [
      "/Users/you/project/docs",
      "/Users/you/project/demolong"
    ],
    "artifactRoot": "/Users/you/project/demolong/projects/proj-123/runs/run-456",
    "executionClass": "review-loop",
    "toolset": "coding",
    "permissionMode": "acceptEdits",
    "requiredArtifacts": [
      {
        "path": "spec.md",
        "required": true,
        "format": "md"
      }
    ]
  }
}
```

**Response** `201 Created`:

```json
{
  "runId": "run-456",
  "status": "starting"
}
```

**当前实现边界**:

- 路由层会把 `executionProfile + departmentRuntimeContract` 写入 `taskEnvelope` carrier。
- `group-runtime` 与 `prompt-executor` 会把它们继续合并进 `BackendRunConfig`。
- 当前真正消费这套合同的是 `ClaudeEngineAgentBackend`，覆盖 `claude-api`、`openai-api`、`gemini-api`、`grok-api`、`custom`、`native-codex`。
- `native-codex` 的 Department / agent-runs 主链已经切到 Claude Engine，并要求 provider 主线固定走 `pi-ai`；本地 conversation 也复用同一条 Claude Engine transcript-backed 路径。
- `codex` 仍然属于 light/local runtime，遇到 `artifact-heavy / review-loop / delivery` 任务会被 capability-aware routing 回退。

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
| `governance.platformEngineering.observe` | `boolean` | 否 | 是否纳入平台工程部观察 |
| `governance.platformEngineering.allowProposal` | `boolean` | 否 | 是否允许平台工程部根据真实运行自动生成 proposal |

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

常见治理 patch：

```json
{
  "governance": {
    "platformEngineering": {
      "observe": true,
      "allowProposal": true
    }
  }
}
```

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
    {
      "stageId": "project-planning",
      "title": "项目规划",
      "executionMode": "review-loop",
      "roles": [],
      "autoTrigger": true
    },
    {
      "stageId": "development",
      "title": "开发执行",
      "executionMode": "review-loop",
      "roles": []
    }
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

> 迁移边界：`recover` 仅适用于当前 stage-centric 持久化 run。旧的 `groupId`-only run/project 状态已不再加载。

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

**功能**: 接收 CEO 的自然语言命令。支持状态查询、即时部门任务调度和自然语言定时任务创建。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | `string` | ✅ | CEO 的自然语言命令 |
| `model` | `string` | ❌ | 可选模型 ID |

```json
{ "command": "每天工作日上午 9 点让后端团队创建一个日报任务项目，目标是汇总当前进行中的项目与风险" }
```

**Response** `200 OK`:
```json
{
  "success": true,
  "action": "create_scheduler_job",
  "message": "已创建定时任务“后端团队 定时任务 · 工作日 09:00”。触发时会自动创建一个 Ad-hoc 项目，并派发模板「Universal Batch Research (Fan-out)」。下一次执行时间：2026-04-09T01:00:00.000Z。当前系统共有 3 个定时任务。",
  "jobId": "abc123",
  "nextRunAt": "2026-04-09T01:00:00.000Z"
}
```

说明：

1. 定时场景：当 `/api/ceo/command` 解析到 `create-project` 且能唯一确定模板时，会把模板写入 scheduler job，后续触发时自动执行 `createProject + executeDispatch`；若不能唯一确定模板，则只创建项目，不直接启动 run。
2. 即时部门业务任务：现在会**先创建一个 `Ad-hoc Project`**。如果有明确模板，则在该项目下派发 template run；否则在该项目下派发 prompt run。不会再创建裸 prompt run。
3. CEO 命令解析现在会动态加载 CEO workspace 中的 `ceo-playbook.md` 与 `ceo-scheduler-playbook.md`，由 playbook 驱动 LLM 决策，再由后端执行。

| Action 值 | 说明 |
|:----------|:-----|
| `create_scheduler_job` | 创建了一个定时任务 |
| `create_project` | 即时创建了一个 `Ad-hoc Project`，并可选附带 `runId` |
| `info` | 查询了特定信息 |
| `needs_decision` | 需要 CEO 在多个方案间选择（返回 `suggestions` 数组） |
| `report_to_human` | 当前兼容层无法直接处理，请转到 CEO Office 会话或手动派发 |

### `GET /api/ceo/profile` — CEOProfile

**功能**: 读取当前 CEO 的持久状态，包括：

- `priorities`
- `activeFocus`
- `communicationStyle`
- `recentDecisions`
- `feedbackSignals`

### `PATCH /api/ceo/profile` — 更新 CEOProfile

**功能**: 更新 CEO 的持久状态字段。

**Request Body**:

- 任意 `CEOProfile` 可更新字段的局部 patch，例如：
  - `priorities`
  - `activeFocus`
  - `communicationStyle`
  - `riskTolerance`
  - `reviewPreference`

### `POST /api/ceo/profile/feedback` — 写入 CEO 反馈信号

**功能**: 记录用户对 CEO 的偏好/修正/批准/拒绝信号。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `string` | 否 | `correction` / `approval` / `rejection` / `preference`（默认 `preference`） |
| `content` | `string` | ✅ | 用户反馈内容 |

### `GET /api/ceo/routine` — CEO Routine Summary

**功能**: 返回当前 CEO 的 routine summary，包括：

- `activeProjects`
- `pendingApprovals`
- `activeSchedulers`
- `recentKnowledge`
- `highlights`
- `actions`

`actions` 是首页可执行动作列表，不再只是展示文案。每个 action 包含：

| 字段 | 说明 |
|------|------|
| `id` | 稳定动作 ID |
| `type` | `approval` / `project` / `scheduler` / `knowledge` / `focus` |
| `status` | `done` / `pending` / `attention` |
| `priority` | `low` / `medium` / `high` |
| `meta` | 首页副标题或当前证据 |
| `count` | 相关对象数量 |
| `target` | 可下钻目标，包含 `kind`、`section` 以及可选 `requestId` / `projectId` / `jobId` / `knowledgeId` / `workspaceUri` |

Web 首页展示原则：

- 全量 agent state 刷新为 60 秒级；审批通过 `/api/approval/events` SSE 做即时补充。
- 首页“今日关注”按 `attention/pending/done` 显示当前需处理状态，不把 action 列表渲染成虚假的用户完成清单。
- 指标卡不在前端合成“较昨日”趋势；没有后端历史序列时只展示当前可验证值。

### `GET /api/ceo/events` — CEO Events

**功能**: 返回最近的 CEO 组织事件流。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | `number` | 否。默认 `20` |

### `GET /api/management/overview` — Management Overview

**功能**: 返回经营概览与管理指标。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `workspace` | `string` | 否。提供时返回部门级概览；省略时返回组织级概览 |

**Response**:

- 组织级：
  - `activeProjects`
  - `completedProjects`
  - `failedProjects`
  - `blockedProjects`
  - `pendingApprovals`
  - `activeSchedulers`
  - `schedulerRuntime`
  - `recentKnowledge`
  - `metrics`
- 部门级额外返回：
  - `workspaceUri`
  - `workflowHitRate`
  - `throughput30d`

`schedulerRuntime` 用于区分“有启用任务”和“调度循环真的在跑”：

| 字段 | 说明 |
|------|------|
| `status` | `running` / `idle` / `disabled` / `stalled` |
| `loopActive` | 当前进程内 scheduler loop 是否初始化并活跃 |
| `configuredToStart` | 当前进程配置是否允许启动 scheduler |
| `enabledJobCount` | 启用中的 job 数 |
| `dueNowCount` | 当前应立即触发的 job 数 |
| `nextRunAt` | 最近一次预计触发时间 |
| `message` | 面向 UI/运维的状态说明 |

### `GET /api/evolution/proposals` — Evolution Proposals

**功能**: 返回当前 evolution proposals 列表，可选附带 rollout observe 结果。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `workspace` | `string` | 否。按部门过滤 |
| `kind` | `string` | 否。`workflow` / `skill` |
| `status` | `string` | 否。`draft` / `evaluated` / `pending-approval` / `published` / `rejected` |
| `observe` | `boolean` | 否。默认 `true`，published proposal 会附带 rollout 观察 |

### `POST /api/evolution/proposals/generate` — Generate Proposals

**功能**: 从 knowledge proposal signals 与 repeated prompt runs 生成 proposals。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspaceUri` | `string` | 否 | 按部门范围生成 |
| `limit` | `number` | 否 | 限制本次生成数量 |

### `GET /api/evolution/proposals/:id` — Proposal Detail

**功能**: 返回单个 proposal 详情。

### `POST /api/evolution/proposals/:id/evaluate` — Evaluate Proposal

**功能**: 用历史 runs 对 proposal 做样本匹配和成功率评估。

### `POST /api/evolution/proposals/:id/publish` — Request Publish Approval

**功能**: 为 proposal 创建发布审批，请求通过后由 approval callback 真正发布 workflow/skill。

### `POST /api/evolution/proposals/:id/observe` — Refresh Rollout Observe

**功能**: 刷新 proposal 发布后的 adoption / success observe 指标。

---

## 审批接口

### `GET /api/approval` — 审批请求列表

**Split mode owner**: `control-plane`

**功能**: 获取所有审批请求。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `status` | `string` | 可选。按 `pending` / `approved` / `rejected` / `feedback` 过滤 |
| `workspace` | `string` | 可选。按 workspace URI 过滤 |
| `type` | `string` | 可选。按审批类型过滤 |
| `summary` | `boolean` | 可选。`true` 时返回状态汇总 |

**Response** `200 OK`:

```json
{
  "requests": [
    {
      "id": "approval-123",
      "type": "proposal_publish",
      "workspace": "file:///tmp/research",
      "title": "发布提案",
      "description": "需要 CEO 审批",
      "urgency": "normal",
      "status": "pending",
      "createdAt": "2026-04-23T00:00:00.000Z",
      "updatedAt": "2026-04-23T00:00:00.000Z",
      "notifications": [
        {
          "channel": "web",
          "success": true,
          "messageId": "1776981167936-1",
          "sentAt": "2026-04-23T00:00:00.000Z"
        }
      ]
    }
  ],
  "summary": {
    "pending": 1,
    "approved": 0,
    "rejected": 0,
    "feedback": 0,
    "total": 1
  }
}
```

### `POST /api/approval` — 提交审批请求

**功能**: 由 Agent 或系统提交新的审批请求。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `string` | ✅ | `token_increase` / `tool_access` / `provider_change` / `scope_extension` / `pipeline_approval` / `proposal_publish` / `other` |
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

**功能**: CEO 对审批请求提供反馈（不批准也不拒绝，仅给意见）。Webhook / IM 一键审批链接也会调用该入口，并使用 HMAC token 验证。

**Query 参数**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | `string` | ✅ | `approve` / `reject` / `feedback` |
| `token` | `string` | ✅ | 由审批系统生成的 HMAC token |
| `message` | `string` | 否 | 反馈内容 |

### `GET /api/approval/events` — 审批事件流

**Split mode owner**: `control-plane`

**功能**: Server-Sent Events 审批推送流。Web UI 使用该接口在审批请求创建或响应后即时刷新，同时保留最近事件回放，避免短暂断线漏收。

**事件类型**:

| 事件 | 说明 |
|------|------|
| `approval_request` | 新审批请求已创建，并已通过 Web 通道写入 notification event bus |
| `approval_response` | CEO 已批准、拒绝或反馈审批请求 |

**Response** `200 OK`:

```text
retry: 5000

id: 1776981167936-1
event: approval_request
data: {"id":"1776981167936-1","type":"approval_request","requestId":"approval-123",...}
```

---

## 部门接口

### `GET /api/departments` — 获取部门配置

**Split mode owner**: `control-plane`

**功能**: 获取指定 workspace 的部门配置。如果 `.department/config.json` 不存在，返回默认配置。

> 自 2026-04-20 起，部门接口不再直接以 Antigravity 最近打开列表作为唯一准入边界，而是以 OPC 自己的 workspace catalog 为准。Antigravity recent 只作为 catalog 的导入源之一。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `workspace` | `string` | 必填。workspace `file://` URI |

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
| `403` | workspace 不在 OPC workspace catalog 中 |
| `422` | `.department/config.json` 格式错误 |

### `PUT /api/departments` — 更新部门配置

**功能**: 更新指定 workspace 的部门配置。如果 `.department/` 目录不存在，会自动创建。

> `PUT /api/departments` 现在只负责保存 `workspace/.department/config.json`。
> 不再隐式触发多 IDE 镜像同步；如需写入 `AGENTS.md` / `.agents/rules` / `CLAUDE.md` / `.cursorrules`，请显式调用 `POST /api/departments/sync`。

**Query 参数**: 同 GET

**Request Body**: 完整的 `DepartmentConfig` JSON 对象。

**Response** `200 OK`:
```json
{ "ok": true, "syncPending": true }
```

### `POST /api/departments/sync` — 同步部门状态

**功能**: 显式触发部门状态同步（配置 → IDE 适配）。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `workspace` | `string` | 必填。workspace `file://` URI |
| `target` | `string` | 可选。`all` / `antigravity` / `codex` / `claude-code` / `cursor` |

### `GET /api/departments/digest` — 部门摘要

**功能**: 获取部门的日报/周报摘要（已完成任务、进行中任务、阻塞项、Token 用量）。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `workspace` | `string` | 必填。workspace `file://` URI |
| `date` | `string` | 可选。`YYYY-MM-DD` |
| `period` | `string` | 可选。`day` / `week` / `month` |

### `GET /api/departments/quota` — 配额查询

**功能**: 获取部门当前 Token 配额和使用情况。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `workspace` | `string` | 必填。workspace `file://` URI |

### `GET /api/departments/memory` — 读取部门记忆

**功能**: 读取 `workspace/.department/memory/` 下的持久记忆内容。

### `POST /api/departments/memory` — 写入部门记忆

说明：

- 当前知识系统已采用：
  - SQLite 结构化 `knowledge_assets`
  - filesystem mirror (`~/.gemini/antigravity/knowledge/`)

双轨持久化。

- `/api/departments/memory` 仍负责传统 Markdown 部门记忆。
- `/api/knowledge*` 负责结构化知识资产与镜像兼容视图。
- `GET /api/knowledge` 现支持：
  - `workspace`
  - `category`
  - `status`
  - `scope`
  - `tag`
  - `q`
  - `sort=recent|created|updated|alpha|reuse`
  - `limit`
- `POST /api/knowledge` 可手动创建 `manual` source 的知识项，并立即返回 `KnowledgeDetail`。
- `GET /api/knowledge/:id` 会透出 richer knowledge metadata，例如 `tags`、`scope`、`sourceType/sourceRunId`、`confidence`、`evidenceCount`、`promotionLevel`。
- `POST /api/knowledge/:id/summary` 会按 `knowledge-summary` scene 解析 provider/model，生成摘要并回写到 Knowledge metadata。

### `POST /api/knowledge/:id/summary` — 生成并回写 Knowledge 摘要

**功能**: 读取指定 Knowledge 条目，使用当前 `knowledge-summary` scene 对应的 provider/model 生成摘要，并把结果回写到条目的 `summary`。

**Response** `200 OK`:

```json
{
  "ok": true,
  "summary": "本文适合用于判断 AI 从单点模型竞争转向 Agent 系统落地的行业趋势。",
  "provider": "native-codex",
  "model": "gpt-5.4",
  "source": "department",
  "scene": "knowledge-summary"
}
```

**功能**: 追加或更新部门记忆文件。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `workspace` | `string` | 必填。workspace `file://` URI |
| `scope` | `string` | GET 可选。`department` / `organization` |
| `category` | `string` | POST 必填。`knowledge` / `decisions` / `patterns` |

---

## Company Kernel API

Company Kernel 负责把 run 执行事实沉淀成可审计的公司记忆候选，并进一步形成经营信号、议程、预算 gate、熔断器和增长提案。它不启动 Provider，不改变 Antigravity IDE / Language Server 行为。分离部署时 `/api/company/*` 由 web 代理到 control-plane/API 服务，避免 web 进程直接读写本地 DB。

### `GET /api/company/run-capsules` — RunCapsule 列表

**功能**: 分页返回 run 的结构化事实胶囊。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `workspaceUri` / `workspace` | `string` | 可选。按 workspace URI 过滤 |
| `projectId` | `string` | 可选。按项目过滤 |
| `status` | `string` | 可选。按 run status 过滤 |
| `providerId` | `string` | 可选。按 provider 过滤 |
| `page` / `pageSize` | `number` | 分页参数，默认 `20`，最大 `100` |

**Response** `200 OK`:

```json
{
  "items": [
    {
      "capsuleId": "capsule-...",
      "runId": "run-1234",
      "workspaceUri": "file:///tmp/workspace",
      "status": "completed",
      "checkpoints": [],
      "verifiedFacts": [],
      "decisions": [],
      "reusableSteps": [],
      "qualitySignals": {
        "resultStatus": "completed",
        "hasResultEnvelope": true,
        "hasArtifactManifest": false,
        "hasDeliveryPacket": false
      }
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1,
  "hasMore": false
}
```

### `GET /api/company/run-capsules/:runId` — RunCapsule 详情

**功能**: 按 run id 返回单个 RunCapsule。系统重建 capsule 时会合并既有 WorkingCheckpoint，不覆盖已追加的生命周期证据。

### `GET /api/company/memory-candidates` — 记忆候选列表

**功能**: 分页返回从 RunCapsule 生成的记忆候选。候选不会自动成为长期 active knowledge；Knowledge 页面也通过该接口加载候选审核队列。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `workspaceUri` / `workspace` | `string` | 可选。按 workspace URI 过滤 |
| `sourceRunId` | `string` | 可选。按来源 run 过滤 |
| `sourceCapsuleId` | `string` | 可选。按来源 capsule 过滤 |
| `kind` | `string` | 可选。`decision` / `pattern` / `lesson` / `domain-knowledge` / `workflow-proposal` / `skill-proposal` |
| `status` | `string` | 可选。`candidate` / `pending-review` / `promoted` / `auto-promoted` / `rejected` / `archived` |
| `minScore` | `number` | 可选。最低评分 |
| `page` / `pageSize` | `number` | 分页参数，默认 `20`，最大 `100` |

**关键字段**:

| 字段 | 说明 |
|------|------|
| `status` | `candidate` / `pending-review` 表示可操作；`promoted` / `auto-promoted` / `rejected` / `archived` 为闭合状态 |
| `evidenceRefs` | 候选证据；空证据候选不会自动晋升 |
| `score` | 结构化评分，`total >= 75` 只是晋升必要条件之一 |
| `volatility` | `volatile` 候选不会自动晋升 |
| `conflicts` | 存在 `high` 冲突时不会自动晋升，必须人工审核 |

### `GET /api/company/memory-candidates/:id` — 记忆候选详情

**功能**: 返回单个 MemoryCandidate，包含 evidence refs、score、volatility、conflicts。

### `POST /api/company/memory-candidates/:id/promote` — 晋升为知识资产

**功能**: 将候选显式晋升为 `KnowledgeAsset`。晋升后写入 SQLite `knowledge_assets` 并同步 filesystem mirror。只有 `candidate` / `pending-review` 状态可晋升；对 `rejected/promoted/archived` 等闭合状态操作返回 `409`。

**Request Body**:

```json
{
  "title": "可选覆盖标题",
  "content": "可选覆盖内容",
  "category": "decision",
  "level": "l2-fact"
}
```

### `POST /api/company/memory-candidates/:id/reject` — 拒绝候选

只有 `candidate` / `pending-review` 状态可拒绝；已 promote 的候选不能回退为 rejected。重复 reject 已拒绝候选保持幂等。

**Request Body**:

```json
{ "reason": "重复或证据不足" }
```

### `GET /api/company/signals` — 经营信号列表

分页返回 `OperatingSignal`。支持 `workspaceUri` / `workspace`、`source`、`kind`、`status`、`minScore` 过滤。信号来源包括 `run`、`scheduler`、`approval`、`knowledge`、`system` 等。审批请求提交、批准、拒绝、反馈都会写入 approval signal，并由 agenda builder 形成需要 CEO 处理或观察的议程项。

### `GET /api/company/signals/:id` / `POST /api/company/signals/:id/dismiss`

读取或关闭单个经营信号。关闭后 dedupe upsert 不会把该信号重新打开。

### `GET /api/company/agenda` — 经营议程列表

分页返回 `OperatingAgendaItem`。支持 `workspaceUri`、`status`、`priority`、`minScore` 过滤。agenda 由信号确定性生成，不会自动执行任务。

### `GET /api/company/agenda/:id`

读取单个议程项。

### `POST /api/company/agenda/:id/snooze` / `dismiss`

延后或关闭议程项。

```json
{ "minutes": 60 }
```

### `POST /api/company/agenda/:id/dispatch-check`

只做预算与熔断检查，不创建 run。

```json
{
  "scope": "department",
  "scopeId": "file:///tmp/workspace",
  "schedulerJobId": "job-123"
}
```

### `POST /api/company/agenda/:id/dispatch`

先校验 agenda 是否具备 target workspace，再执行 budget gate；允许后创建一个 queued prompt run，并把 agenda 标记为 `dispatched`。该接口只创建 run，不直接启动新的后台 worker。创建 run 后会把 budget reservation 绑定到 `runId`；run 到达 terminal 状态后由 run registry 统一 commit / release，预算流水不会重复统计 reserved + committed。缺少 target workspace 的 agenda 会返回 `409`，且不会写入 reserved ledger。

### `GET /api/company/operating-day`

返回 CEO Office 使用的今日经营读模型：`agenda`、`activeSignals`、`departmentStates`、`activeRuns`、`completedRuns`、`memoryCandidateIds`。

### `GET /api/company/budget/policies` / `GET|PUT /api/company/budget/policies/:id`

读取或更新预算策略。策略字段包括 `scope`、`scopeId`、`period`、`maxTokens`、`maxMinutes`、`maxDispatches`、`maxConcurrentRuns`、`cooldownMinutesByKind`、`failureBudget`、`warningThreshold`、`hardStop`。

当请求默认策略 ID（例如 `budget:organization:default:day`、`budget:department:default:day`）且本地尚未落库时，`GET` 会自动创建并返回默认策略，避免 Settings 首次打开时产生 404 噪音。

### `GET /api/company/budget/ledger`

分页读取预算流水。支持 `scope`、`scopeId`、`policyId`、`decision`、`agendaItemId`、`runId`、`schedulerJobId`、`proposalId` 过滤。`decision` 包括 `reserved`、`committed`、`released`、`blocked`、`skipped`；`skipped` 表示调度被 budget/circuit gate 明确拦截，未创建 run；growth generate/evaluate 也会写入 `growth-proposal` scope ledger。

### `GET /api/company/circuit-breakers` / `POST /api/company/circuit-breakers/:id/reset`

读取或重置熔断器。打开的熔断器会让 `dispatch-check` / `dispatch` 返回 block。真实 run 进入 `failed` / `timeout` / `blocked` 终态会更新 department、scheduler-job、provider、workflow breaker；成功终态会 reset 对应 breaker。

### `GET /api/company/growth/proposals`

分页读取 GrowthProposal。支持 `workspaceUri`、`kind`、`status`、`risk`、`minScore` 过滤。`kind` 为 `sop` / `workflow` / `skill` / `script` / `rule`。

### `POST /api/company/growth/proposals/generate`

经过 budget gate 后，从 RunCapsule、已晋升知识和 workflow/skill memory candidate 生成增长提案。三次以上同类成功 RunCapsule 会生成 `workflow` proposal；两次同类成功或单次稳定 reusable steps 会优先生成 SOP proposal；重复出现的脚本化任务和规则约束会额外生成 `script` / `rule` proposal。

```json
{ "workspaceUri": "file:///tmp/workspace", "limit": 20 }
```

### `GET /api/company/growth/proposals/:id`

读取单个增长提案。

### `POST /api/company/growth/proposals/:id/evaluate|approve|reject|dry-run|publish`

评估、批准、拒绝、dry-run 或发布增长提案。`evaluate` 会经过 budget gate；高风险提案会创建 approval request；`script` proposal 必须先通过 `dry-run` 静态 sandbox 检查；公开 `publish` 不接受 `force` 绕过审批或 dry-run，只有满足约束后才会写入 canonical workflow/skill/rule、workflow script 或 SOP knowledge asset。已发布的 workflow/skill proposal 会参与后续 Prompt Mode 执行解析。

### `GET|POST /api/company/growth/observations`

读取或执行增长提案发布后的观察。只有 `published` / `observing` proposal 可以观察；观察结果包含命中 run、成功率、估算 token saving 和 regression signals。`POST` body:

```json
{ "proposalId": "growth-proposal-..." }
```

### `GET /api/company/loops/notification-targets`

读取公司循环摘要投递目标的当前可用性。该接口返回 `web / email / webhook` 的可用状态与说明，用于 Settings `预算策略` 页禁用未接入通道。`web` 固定可用；`email` 需要同时配置 `COMPANY_LOOP_EMAIL_WEBHOOK_URL`（或 `AG_COMPANY_LOOP_EMAIL_WEBHOOK_URL`）与收件人；`webhook` 需要配置 `COMPANY_LOOP_WEBHOOK_URL`（或 `AG_COMPANY_LOOP_WEBHOOK_URL`）。

### `GET /api/company/loops/policies` / `GET|PUT /api/company/loops/policies/:id`

读取或更新 `CompanyLoopPolicy`。默认组织策略 ID 为 `company-loop-policy:organization:default`，字段包括 `enabled`、`timezone`、`dailyReviewHour`、`weeklyReviewDay`、`weeklyReviewHour`、`maxAgendaPerDailyLoop`、`maxAutonomousDispatchesPerLoop`、`allowedAgendaActions`、`growthReviewEnabled`、`notificationChannels`。Settings `Autonomy 预算`页会通过该接口保存 loop policy；scheduler 内置 daily/weekly company-loop cron 会读取该策略的时间、时区和 enabled 状态。

`notificationChannels` 支持 `web`、`email`、`webhook`。`web` 始终固定启用；`email` 和 `webhook` 只有在对应外部投递目标已接入时才会被保存和执行。每个启用通道都会在 loop digest 后写入 channel-specific notification id；`webhook` 在配置 `COMPANY_LOOP_WEBHOOK_URL` 或 `AG_COMPANY_LOOP_WEBHOOK_URL` 后异步 POST digest payload；`email` 可通过 `COMPANY_LOOP_EMAIL_WEBHOOK_URL` 或 `AG_COMPANY_LOOP_EMAIL_WEBHOOK_URL` 接入外部邮件投递器，收件人来自 `COMPANY_LOOP_EMAIL_RECIPIENTS` 或 `AG_COMPANY_LOOP_EMAIL_RECIPIENTS`。

### `GET /api/company/loops/runs` / `GET /api/company/loops/runs/:id`

分页读取 `CompanyLoopRun`。支持 `policyId`、`kind`、`status`、`date` 过滤。响应记录包含 `selectedAgendaIds`、`dispatchedRunIds`、`generatedProposalIds`、`notificationIds`、`budgetLedgerIds`、`summary`、`skipReason`、`error`。`metadata.skippedAgenda` 会结构化保存每个 skipped item 的 `id`、`title`、`reason`、`status`、`priority`、`recommendedAction`、cost 和关联证据，便于 Ops 解释为什么没有执行。

### `POST /api/company/loops/run-now`

手动触发一次 `daily-review`、`weekly-review`、`growth-review` 或 `risk-review`。执行器只选择 Top-N agenda，`dispatch` 仍经过 budget gate / circuit breaker，默认 autonomous dispatch cap 为 1。policy disabled 时会写入 skipped loop run 并返回 `409`。

```json
{ "kind": "daily-review" }
```

### `GET /api/company/loops/digests` / `GET /api/company/loops/digests/:id`

分页读取 `CompanyLoopDigest`，用于 CEO Office / Ops 展示 loop 摘要。digest 只汇总结构化事实，不替代 `CompanyLoopRun`、agenda、budget ledger 的可审计数据。

### `POST /api/company/loops/runs/:id/retry`

只允许重试 `failed` / `skipped` loop run；会创建新的 loop run，不覆盖原记录。

### `GET|POST /api/company/self-improvement/signals`

读取或创建 `SystemImprovementSignal`。第一版信号来源包括 `performance`、`ux-breakpoint`、`test-failure`、`runtime-error`、`manual-feedback`、`duplicate-work`、`architecture-risk`。

系统当前还会自动补充两类来源：

1. 被平台工程部观察的项目出现 `failed / blocked / timeout` run。
2. `User Story` 文档中的 `[不支持]` 用户场景被同步为长期改进信号。

```json
{
  "source": "performance",
  "title": "Slow company API",
  "summary": "Response body is too large",
  "affectedAreas": ["api"],
  "evidenceRefs": []
}
```

### `GET /api/company/self-improvement/proposals`

分页读取系统改进 proposal。支持 `status`、`risk` 过滤。

### `POST /api/company/self-improvement/proposals/generate`

从 signal 生成 `SystemImprovementProposal`，包含 `affectedFiles`、`protectedAreas`、`risk`、`implementationPlan`、`testPlan`、`rollbackPlan`。涉及 protected core 的 high/critical proposal 会自动创建 approval request。该接口不创建 git branch、不提交、不推送、不合并。

平台工程部对已纳入观察且允许提案的项目，会在失败 run 出现后直接生成 proposal，CEO Office 可直接读取，不需要手工再次描述问题。

```json
{
  "signalIds": ["system-improvement-signal-..."],
  "affectedFiles": ["src/app/api/company/loops/runs/route.ts"]
}
```

### `GET /api/company/self-improvement/proposals/:id`

读取单个系统改进 proposal。

### `POST /api/company/self-improvement/proposals/:id/evaluate|approve|reject|attach-test-evidence|release-gate|observe`

`evaluate` 会重新计算 protected core 风险并按需创建 approval request；`approve` 会写入持久 `metadata.approvalStatus/approvedAt`，并自动在平台工程部创建 Project、挂上 `development-template-1`、派发首个 run，返回 `proposal + launch`；`reject` 只更新拒绝状态；`attach-test-evidence` 记录测试命令和摘要。proposal 运行态会根据平台工程项目与最新 run 自动推进：`approved -> in-progress -> testing -> ready-to-merge`。low/medium proposal 在最新 passed evidence 后可进入 `ready-to-merge`；high/critical proposal 必须已有持久审批事实，不能用测试证据绕过审批；已审批 proposal 可在 failed evidence 后通过最新 passed evidence 恢复到 `ready-to-merge`。`GET /api/company/self-improvement/proposals` 与 `GET /api/company/self-improvement/proposals/:id` 会返回 `exitEvidence`，其中包含 `project/latestRun/testing/mergeGate/releaseGate` 准出证据包。`release-gate` 接收 `preflight / approve / mark-merged / mark-restarted / start-observation / mark-rolled-back`，其中 `preflight` 会从 Codex worktree 生成 patch 并对当前主仓执行 `git apply --check`；后续动作只记录 CEO/Ops 显式准出、合并、重启、观察、回滚状态和命令包，不会静默执行 auto merge / push / deploy。`observe` 将 proposal 标记为 `observing` 并记录观察摘要。

---

## 定时任务接口

### `GET /api/scheduler/jobs` — 定时任务列表

**功能**: 返回所有已注册的定时任务及其运行状态。

**Response** `200 OK`:
```json
{
  "items": [
    {
      "jobId": "abc-123",
      "name": "AI 情报日报",
      "type": "cron",
      "cronExpression": "0 20 * * *",
      "timeZone": "Asia/Shanghai",
      "action": {
        "kind": "dispatch-execution-profile",
        "workspace": "file:///Users/darrel/Documents/baogaoai",
        "prompt": "生成今天的AI日报并上报",
        "executionProfile": {
          "kind": "workflow-run",
          "workflowRef": "/ai_digest"
        }
      },
      "enabled": true,
      "lastRunAt": "2026-04-22T14:35:47Z",
      "lastRunResult": "success",
      "nextRunAt": "2026-04-23T12:00:00.000Z",
      "departmentWorkspaceUri": "file:///Users/darrel/Documents/baogaoai",
      "createdAt": "2026-04-22T14:17:17Z"
    }
  ],
  "page": 1,
  "pageSize": 100,
  "total": 1,
  "hasMore": false
}
```

说明：

- `cron` job 支持可选 `timeZone` 字段；例如 `0 20 * * * + Asia/Shanghai` 表示每天北京时间 20:00。
- 列表和详情读取会按 SQLite `scheduled_jobs` 主存储刷新，不再只看某个进程里的旧内存态；任务已过触发点但尚未执行时，`nextRunAt` 返回当前时间，表示应立即补跑。
- 默认同设备部署中由 `opc-api` 承载 cron scheduler；`web` 不执行定时任务。`AG_ENABLE_SCHEDULER=0` 可显式关闭 cron，`AG_ENABLE_SCHEDULER_COMPANIONS=1` 才会启动 fan-out / approval / CEO event consumer 等 companion 后台。

### `POST /api/scheduler/jobs` — 创建定时任务

**功能**: 注册新的定时任务。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | ✅ | 任务名称 |
| `type` | `string` | ✅ | `cron` / `interval` / `once` |
| `cronExpression` | `string` | 条件 | cron 表达式（type=cron 时必填） |
| `timeZone` | `string` | 否 | `cron` 的 IANA 时区，例如 `Asia/Shanghai`；留空则按服务端本地时区解释 |
| `intervalMs` | `number` | 条件 | 间隔毫秒数（type=interval 时必填） |
| `scheduledAt` | `string` | 条件 | 执行时间（type=once 时必填，ISO 8601） |
| `action` | `object` | ✅ | 执行动作，见下方 |
| `enabled` | `boolean` | 否 | 是否启用（默认 `true`） |
| `departmentWorkspaceUri` | `string` | 否 | 关联的 OPC 部门 workspace |
| `opcAction` | `object` | 否 | OPC 专用动作（自动创建项目） |

**Action 类型**:

| kind | 说明 | 必填字段 |
|------|------|---------|
| `dispatch-pipeline` | 派发 Pipeline / Stage | `templateId`, `workspace`, `prompt`，可选 `stageId` |
| `dispatch-prompt` | Prompt Mode 执行（无需模板） | `workspace`, `prompt`，可选 `promptAssetRefs`, `skillHints`, `projectId` |
| `dispatch-execution-profile` | 按统一 `ExecutionProfile` 触发 | `workspace`, `prompt`, `executionProfile`，可选 `projectId` |
| `health-check` | 项目健康检查 | `projectId` |
| `create-project` | 定时创建 Ad-hoc Project | `departmentWorkspaceUri`, `opcAction.goal`，可选 `opcAction.skillHint`, `opcAction.templateId` |

说明：

- `dispatch-execution-profile` 目前支持：
  - `workflow-run`
  - `review-flow`
  - `dag-orchestration`
- `review-flow` 现在要求提供 template-backed target：
  - `templateId`
  - 可选 `stageId`
  并会走已有 `review-loop` stage runtime。

### `GET /api/scheduler/jobs/:id` — 任务详情

**功能**: 获取单个定时任务的详细信息。

### `PATCH /api/scheduler/jobs/:id` — 更新任务

**功能**: 更新定时任务的配置（如启用/禁用、修改 cron 表达式）。

### `DELETE /api/scheduler/jobs/:id` — 删除任务

**功能**: 删除定时任务。

说明：

- 删除现在会同步移除 SQLite `scheduled_jobs` 记录，避免“页面看不见但重启后又冒出来”的脏行残留。

### `POST /api/scheduler/jobs/:id/trigger` — 手动触发任务

**功能**: 立即触发一次定时任务执行（不影响下次 cron 触发时间）。触发前会生成 routine agenda 并经过 Company Kernel budget gate；如果 budget 或 circuit breaker 拦截，响应 `status` 为 `skipped`，不会创建 run，`lastRunResult` 也会记录为 `skipped`。

---

## 交付物接口

### `GET /api/projects/:id/deliverables` — 交付物列表

**功能**: 获取项目的所有交付物。

- 当前实现已经改为 **SQLite 主路径**。
- 返回值既包含手工添加的 deliverable，也包含从 `Run.resultEnvelope.outputArtifacts` 自动同步出来的 run outputs。
- 接口会在读取前执行一次项目级 backfill，确保 prompt-only / 第三方 Codex 项目也能看到交付物，不再依赖前端 fallback。

**Response** `200 OK`:
```json
[
  {
    "id": "del-001",
    "projectId": "proj-123",
    "stageId": "stage-0",
    "sourceRunId": "run-5678",
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

| 字段 | 类型 | 说明 |
|------|------|------|
| `sourceRunId` | `string?` | 若存在，表示该交付物是由某次 Run 的产物自动同步而来 |

### `POST /api/projects/:id/deliverables` — 添加交付物

**功能**: 为项目添加一个交付物记录。

- 手工添加的 deliverable 同样写入 SQLite 主库。
- 自动同步的 run outputs 与手工 deliverable 共用同一个读路径。

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

**Split mode owner**: `control-plane`

**功能**: 返回 OPC workspace catalog 中的所有已知 workspace。

目录来源说明：

1. 手动导入的项目
2. Antigravity recent 列表导入的项目
3. CEO bootstrap workspace

因此：

1. `GET /api/workspaces` 不再等价于“Antigravity 最近打开列表原样透传”
2. 也不要求 workspace 当前正在运行 language_server

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

**Split mode owner**: `runtime`

**功能**: 在 Antigravity IDE 中打开一个新的 workspace 窗口并启动其 language_server。

调用时会先把目标 workspace 注册到 OPC workspace catalog，再执行 Antigravity CLI 打开动作。

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

**Split mode owner**: `control-plane`

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

**Split mode owner**: `runtime`

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

---

### `POST /api/workspaces/import` — 导入 Workspace

**Split mode owner**: `control-plane`

**功能**: 将一个本地目录注册到 OPC workspace catalog，**不会**启动 Antigravity，也**不会**启动 language_server。

这条路由用于：

1. 先导入项目
2. 先配置 Department
3. 后续再按需选择是否“在 Antigravity 中打开”
4. Tauri 桌面壳中通过原生文件夹选择器新建部门

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspace` | `string` | ✅ | 本地目录绝对路径，或 `file://` URI |

**Response** `200 OK`:
```json
{
  "ok": true,
  "workspace": {
    "name": "my-project",
    "uri": "file:///path/to/my-project"
  }
}
```

**Response** `200 OK`:
```json
{ "ok": true, "hidden": false }
```

### `GET /api/me` — 当前用户

**Split mode owner**: `runtime`

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
| `credits` | `object` | Antigravity runtime 的模型配额信息（并不覆盖所有云端 provider） |

> ⚠️ `apiKey` 字段被有意隐藏，不对外暴露。

---

### `GET /api/models` — 可用模型与配额

**Split mode owner**: `runtime`

**功能**: 获取可用模型列表。

- 有 Antigravity server 时：返回 gRPC 模型与实时配额
- 无 Antigravity server 时：返回 provider-aware fallback model 列表
- provider-aware fallback 现在会合并：
  - `antigravity-runtime` 实时模型
  - `pi-ai` provider registry
  - `custom` provider 的 `/v1/models`
  - 必要时的手动模型回退缓存 `~/.gemini/antigravity/provider-model-catalog.json`

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

---

## Settings / Provider API

### `GET /api/ai-config` — 读取组织级 Provider 配置

**Split mode owner**: `control-plane`

**功能**: 返回当前组织级 AI Provider 配置（`~/.gemini/antigravity/ai-config.json`）。

**Response** `200 OK`:
```json
{
  "defaultProvider": "antigravity",
  "activeCustomProviderId": "baogaoai-glm",
  "customProviders": [
    {
      "id": "baogaoai-glm",
      "name": "BaogaoAI GLM",
      "baseUrl": "https://new.baogaoai.com/v1",
      "defaultModel": "glm-4-flash-250414"
    }
  ],
  "providerProfiles": {
    "antigravity": { "transport": "native", "authMode": "runtime" },
    "native-codex": { "transport": "pi-ai", "authMode": "codex-oauth" }
  },
  "layers": {
    "executive": { "provider": "antigravity" },
    "management": { "provider": "antigravity" },
    "execution": { "provider": "antigravity" },
    "utility": { "provider": "antigravity" }
  },
  "scenes": {}
}
```

### `PUT /api/ai-config` — 保存组织级 Provider 配置

**功能**: 保存组织级 Provider 配置，并在落盘前校验所有 `defaultProvider` / `layers.*.provider` / `scenes.*.provider` 是否真实可用。

> 2026-04-16 起，未配置 Provider 不再允许通过 Settings 被选中；即便绕过前端直接调用本接口，也会被服务端拒绝。
>
> 2026-04-30 起，遗留的 `codex / claude-code` 配置值会在服务端自动归一为 `native-codex`；CLI coder 不再属于组织级 Provider 配置平面。

**Request Body**:
```json
{
  "defaultProvider": "claude-api",
  "activeCustomProviderId": "baogaoai-glm",
  "customProviders": [
    {
      "id": "baogaoai-glm",
      "name": "BaogaoAI GLM",
      "baseUrl": "https://new.baogaoai.com/v1",
      "apiKey": "sk-...",
      "defaultModel": "glm-4-flash-250414"
    }
  ],
  "providerProfiles": {
    "native-codex": {
      "transport": "pi-ai",
      "authMode": "codex-oauth",
      "supportsImageGeneration": true,
      "enableImageGeneration": true,
      "imageGenerationModel": "gpt-5.5"
    },
    "openai-api": {
      "transport": "pi-ai",
      "authMode": "api-key",
      "supportsImageGeneration": true,
      "enableImageGeneration": true,
      "imageGenerationModel": "gpt-image-1"
    }
  },
  "layers": {
    "executive": { "provider": "antigravity" },
    "management": { "provider": "claude-api" },
    "execution": { "provider": "native-codex" },
    "utility": { "provider": "antigravity" }
  },
  "scenes": {
    "review-decision": { "provider": "claude-api", "model": "claude-sonnet-4-20250514" }
  }
}
```

**Response** `200 OK`:
```json
{ "ok": true }
```

**错误响应** `400 Bad Request`:
```json
{
  "error": "Provider \"OpenAI API\" at \"defaultProvider\" is not configured and cannot be selected",
  "issues": [
    { "path": "defaultProvider", "provider": "openai-api" }
  ]
}
```

### `GET /api/cc-connect/local-state` — 读取本机 cc-connect 状态

**Split mode owner**: `web`

**功能**: 供 `Settings -> 会话平台` 读取本机 `cc-connect` 的安装、配置、绑定和运行状态。这个接口不会透传到 `cc-connect`，而是直接检查：

- `which cc-connect`
- `~/.cc-connect/config.toml`
- `cc-connect.config.toml` 模板路径
- `management` 端口是否仍在 `LISTEN`

**Response** `200 OK`:

```json
{
  "ok": true,
  "data": {
    "installed": true,
    "binaryPath": "/opt/homebrew/bin/cc-connect",
    "configPath": "/Users/darrel/.cc-connect/config.toml",
    "templatePath": "/Users/darrel/Documents/Antigravity-Mobility-CLI/cc-connect.config.toml",
    "configExists": true,
    "configPrepared": true,
    "platformConfigured": true,
    "tokenConfigured": true,
    "managementEnabled": true,
    "managementPort": 9820,
    "running": true,
    "pid": 94985,
    "connectedPlatforms": ["weixin"],
    "projectsCount": 1,
    "version": "e64aa04",
    "issues": []
  }
}
```

### `POST /api/cc-connect/manage` — 修复 / 启停本机 cc-connect

**Split mode owner**: `web`

**功能**: 供 `Settings -> 会话平台` 执行本机管理动作。

**Request Body**:

```json
{ "action": "prepare-config" }
```

支持动作：

- `prepare-config`: 修复 `work_dir / args / [management]`
- `start`: 启动本机 `cc-connect`
- `stop`: 停止当前 `management` 端口对应的 `cc-connect` 监听进程

**Response** `200 OK`:

```json
{
  "ok": true,
  "action": "start",
  "data": {
    "running": true,
    "pid": 94985
  }
}
```

### `ALL /api/cc-connect/[...path]` — 代理 cc-connect Management API

**Split mode owner**: `web`

**功能**: 把浏览器端请求代理到本机 `cc-connect` 的 Management API（默认 `http://127.0.0.1:9820/api/v1/*`），例如：

- `GET /api/cc-connect/status`
- `GET /api/cc-connect/projects`
- `GET /api/cc-connect/projects/:project/sessions`

> 这个代理只负责把 Settings / 会话平台页和本机 `cc-connect` 接起来；本机安装、配置修复、进程启停不走这个代理，而是走上面的 `local-state` / `manage`。

### `GET /api/provider-model-catalog` — 读取 provider 模型目录

**Split mode owner**: `control-plane`

**功能**: 读取指定 provider 的模型目录。默认优先返回缓存，`refresh=1` 时强制刷新。

**Query 参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `provider` | `string` | 必填。`antigravity / native-codex / claude-api / openai-api / gemini-api / grok-api / custom` |
| `refresh` | `0/1` | 可选。`1` 时强制刷新 |

**Response** `200 OK`:
```json
{
  "entry": {
    "provider": "native-codex",
    "transport": "pi-ai",
    "source": "pi-registry",
    "fetchedAt": "2026-04-28T09:15:12.000Z",
    "models": [
      { "id": "gpt-5.5", "label": "GPT-5.5", "supportsTools": true, "supportsReasoning": true }
    ]
  },
  "cachePath": "/Users/you/.gemini/antigravity/provider-model-catalog.json"
}
```

### `POST /api/provider-model-catalog` — 刷新 provider 模型目录

**Split mode owner**: `control-plane`

**功能**: 用 request body 指定 provider、刷新策略，或为 `custom` provider 传入临时的 `baseUrl/apiKey/defaultModel` 覆盖。

**Request Body**:
```json
{
  "provider": "custom",
  "refresh": true,
  "customProviderOverride": {
    "baseUrl": "https://api.deepseek.com",
    "apiKey": "sk-...",
    "defaultModel": "deepseek-chat"
  }
}
```

**Response** `200 OK`:
```json
{
  "entry": {
    "provider": "custom",
    "transport": "pi-ai",
    "source": "remote-discovery",
    "fetchedAt": "2026-04-28T09:18:00.000Z",
    "models": [
      { "id": "deepseek-chat", "label": "deepseek-chat", "supportsTools": true }
    ]
  },
  "cachePath": "/Users/you/.gemini/antigravity/provider-model-catalog.json"
}
```

### `POST /api/provider-image-generation` — 触发 provider 图像生成测试

**Split mode owner**: `control-plane`

**功能**: 使用当前 provider 配置触发一次图像生成测试。当前实现支持：

1. `native-codex`（Codex subscription auth + Responses `image_generation` tool）
2. `openai-api`
3. `custom`

`custom` 失败时可回退到已配置的 `openai-api`。`native-codex` 若收到小尺寸请求，会在 provider 层自动归一到 `1024x1024` 以满足上游最小像素预算。

**Request Body**:

```json
{
  "provider": "native-codex",
  "prompt": "A compact product icon with a blue square and a clean white background",
  "size": "512x512"
}
```

**Response** `200 OK`:

```json
{
  "provider": "native-codex",
  "model": "gpt-5.5",
  "size": "1024x1024",
  "dataUrl": "data:image/png;base64,..."
}
```

**配置错误示例** `500`:

```json
{
  "error": "Provider openai-api is not configured for image generation"
}
```

### `GET /api/api-keys` — Provider 凭据与本机执行工具状态

**Split mode owner**: `control-plane`

**功能**: 返回已配置的 API Key 状态，以及本机 AI provider / execution tool 的安装与登录检测结果。不会返回真实 key 内容。

**Response** `200 OK`:
```json
{
  "anthropic": { "set": true },
  "openai": { "set": false },
  "gemini": { "set": false },
  "grok": { "set": false },
  "providers": {
    "codex": { "installed": true },
    "nativeCodex": {
      "installed": true,
      "loggedIn": true,
      "authFilePath": "/Users/you/.codex/auth.json"
    },
    "claudeCode": {
      "installed": true,
      "loginDetected": false,
      "command": "claude",
      "installSource": "global"
    }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `anthropic/openai/gemini/grok.set` | `boolean` | 对应 API key 是否已写入 `~/.gemini/antigravity/api-keys.json` |
| `providers.codex.installed` | `boolean` | 是否检测到 `codex` 可执行文件 |
| `providers.nativeCodex.loggedIn` | `boolean` | 是否检测到 `~/.codex/auth.json`，可复用本地 Codex OAuth 登录 |
| `providers.claudeCode.installed` | `boolean` | 是否检测到 Claude Code CLI 或 sibling 开发版本 |
| `providers.claudeCode.loginDetected` | `boolean` | 是否检测到本地 Claude 配置文件，可用于提示本地登录态 |

### `PUT /api/api-keys` — 保存 API Keys

**功能**: 保存或覆盖 API 凭据。支持 `anthropic`、`openai`、`gemini`、`grok` 四种 key。

**Request Body**:
```json
{
  "anthropic": "sk-ant-...",
  "openai": "sk-...",
  "gemini": "AIza...",
  "grok": "xai-..."
}
```

**Response** `200 OK`:
```json
{ "ok": true }
```

### `POST /api/api-keys/test` — 测试 Provider 凭据

**功能**: 对给定 provider 做在线连通性测试。当前支持：
- `anthropic`
- `openai` / `openai-api`
- `gemini` / `gemini-api`
- `grok` / `grok-api`
- `custom`（OpenAI-compatible）

**Request Body**:
```json
{
  "provider": "custom",
  "apiKey": "sk-...",
  "baseUrl": "https://api.deepseek.com/v1"
}
```

也支持复测已保存接入，而不重新提交密钥：

```json
{
  "provider": "custom",
  "connectionId": "baogaoai-glm",
  "useStored": true
}
```

或：

```json
{
  "provider": "openai-api",
  "useStored": true
}
```

**Response** `200 OK`:
```json
{ "status": "ok" }
```

**错误示例**:
```json
{ "status": "invalid", "error": "Invalid API key" }
```

```json
{ "status": "error", "error": "base URL invalid" }
```

说明：

1. `custom.baseUrl` 现在接受 `https://host` 和 `https://host/v1` 两种写法；服务端会自动归一化，避免 `/v1/v1/models`。
2. `useStored=true` 时：
   - API provider 会读取 `~/.gemini/antigravity/api-keys.json`
   - `custom` 会读取 `AIProviderConfig.customProviders[]` / `activeCustomProviderId`
