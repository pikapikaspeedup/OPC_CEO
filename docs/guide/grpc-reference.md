# Antigravity Language Server gRPC 协议参考

> 逆向工程自 `language_server_macos_arm`。合并了原 API_GUIDE + API_REFERENCE。

---

## 目录

- [连接与认证](#连接与认证)
- [gRPC 方法参考](#grpc-方法参考)
- [Streaming API](#streaming-api)
- [Step 类型与数据结构](#step-类型与数据结构)
- [Pitfalls & 经验教训](#pitfalls--经验教训)

---

## 连接与认证

### 服务发现

Antigravity 桌面应用为每个 workspace 启动一个 `language_server` 进程，监听随机 HTTPS 端口。

**发现步骤** (`src/lib/bridge/discovery.ts`):
1. `ps aux | grep language_server` → 提取 PID + `--csrf_token`
2. `lsof -iTCP -sTCP:LISTEN` → 匹配 PID 到 TCP 端口
3. `--workspace_id` 参数 → 标识所属 workspace

**认证** (`src/lib/bridge/statedb.ts`):
- API Key: `~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb`
- SQLite: `SELECT value FROM ItemTable WHERE key='antigravityAuthStatus'` → JSON `apiKey`

### gRPC-Web 调用格式

```bash
curl -k 'https://127.0.0.1:{PORT}/exa.language_server_pb.LanguageServerService/{METHOD}' \
  -H 'Content-Type: application/json' \
  -H 'connect-protocol-version: 1' \
  -H 'x-codeium-csrf-token: {CSRF_TOKEN}' \
  -d '{JSON_BODY}'
```

所有调用需要 `metadata` 对象：
```json
{
  "ideName": "antigravity",
  "apiKey": "YOUR_API_KEY",
  "locale": "en",
  "ideVersion": "1.20.5",
  "extensionName": "antigravity"
}
```

### `workspace_id` 编码规则

Language Server 的 `--workspace_id` 参数会把 `/` 和 `-` **都替换为 `_`**。
示例: `/path/to/my-project-name` → `file_path_to_my_project_name`

> ⚠️ 不要 `replace(/_/g, '/')` 解码，会破坏包含连字符的路径。需用贪心文件系统验证 (`fs.existsSync`) 解码。

---

## gRPC 方法参考

Service: `exa.language_server_pb.LanguageServerService`

### Core Conversation APIs

| Method | Description | Tested |
|--------|-------------|--------|
| `StartCascade` | 创建对话 | ✅ |
| `SendUserCascadeMessage` | 发送消息 / 审批 Artifact | ✅ |
| `GetCascadeTrajectorySteps` | 获取 checkpoint 步骤 | ✅ |
| `CancelCascadeInvocation` | 停止 AI 生成 | ✅ |
| `RevertToCascadeStep` | 回退到指定步骤 | ✅ |
| `GetRevertPreview` | 回退预览 | ✅ |
| `GetCascadeTrajectory` | 获取 live fork (仅增量) | ✅ |
| `LoadTrajectory` | 加载 `.pb` checkpoint 到内存 | ✅ |
| `GetAllCascadeTrajectories` | 所有对话摘要 (stepCount, workspace) | ✅ |
| `GetUserTrajectoryDescriptions` | 列出所有 trajectory | ✅ |
| `UpdateConversationAnnotations` | 更新标注 (如 `lastUserViewTime`) | ✅ |

### Skills & Customization

| Method | Description | Tested |
|--------|-------------|--------|
| `GetAllSkills` | 所有 Skills (全局+workspace) | ✅ |
| `ListCustomizationPathsByFile` | 自定义路径 | ❓ |
| `UpdateCustomization` | 更新自定义 | ❓ |

### User & Status

| Method | Description | Tested |
|--------|-------------|--------|
| `GetUserStatus` | 用户 Profile & Plan | ✅ |
| `GetProfileData` | Base64 头像 | ✅ |
| `GetCascadeModelConfigData` | 可用模型 & 配额 | ✅ |
| `GetStatus` | 服务器状态 | ✅ |

### Workspace & Indexing

| Method | Description | Tested |
|--------|-------------|--------|
| `GetWorkspaceInfos` | Workspace URI 列表 | ✅ |
| `AddTrackedWorkspace` | 注册 workspace（非 IDE 窗口文件夹必需）| ✅ |
| `RemoveTrackedWorkspace` | 移除 workspace | ❓ |

### MCP & Browser

| Method | Description |
|--------|-------------|
| `GetMcpServerStates` | MCP 服务器状态 |
| `GetBrowserOpenConversation` | 获取打开的对话 |
| `SetBrowserOpenConversation` | 设置打开的对话 |
| `SmartFocusConversation` | 聚焦对话 |

---

### 正确的对话创建流程

为确保 Agent Manager 和 Language Server 正确跟踪新对话，必须按以下顺序：

1. **`AddTrackedWorkspace`**（可选但推荐）：如果在没有 IDE 窗口的文件夹中创建对话，先调用此方法让 fallback server 跟踪该目录
2. **`StartCascade`**：创建对话，返回 `cascadeId`
3. **`UpdateConversationAnnotations`**：**立即**设置 `{"lastUserViewTime": "<current_iso_time>"}`。否则 Agent Manager 会将 0 步对话视为"幽灵"并从列表中过滤掉

### StartCascade

```json
// Request
{
  "metadata": { "ideName": "antigravity", "apiKey": "...", ... },
  "source": "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
  "workspaceUris": ["file:///path/to/workspace"]
}
// Response
{ "cascadeId": "abc123-..." }
```

### SendUserCascadeMessage

```json
// 普通消息
{
  "cascadeId": "abc123",
  "items": [{ "text": "Your message here" }],
  "metadata": { ... },
  "cascadeConfig": {
    "plannerConfig": {
      "conversational": { "plannerMode": "CONVERSATIONAL_PLANNER_MODE_DEFAULT", "agenticMode": true },
      "toolConfig": {
        "runCommand": { "autoCommandConfig": { "autoExecutionPolicy": "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER" } },
        "notifyUser": { "artifactReviewMode": "ARTIFACT_REVIEW_MODE_ALWAYS" }
      },
      "requestedModel": { "model": "MODEL_PLACEHOLDER_M26" }
    }
  }
}

// 审批 Artifact (proceed)
{
  "cascadeId": "abc123",
  "metadata": { ... },
  "artifactComments": [{
    "artifactUri": "file:///path/to/artifact.md",
    "fullFile": {},
    "approvalStatus": "ARTIFACT_APPROVAL_STATUS_APPROVED"
  }]
}
```

### GetCascadeTrajectorySteps

获取 checkpoint 步骤。非活跃对话需先调用 `LoadTrajectory`。

```json
// Request
{ "cascadeId": "abc123", "metadata": { ... } }
// Response
{ "steps": [{ "type": "CORTEX_STEP_TYPE_USER_INPUT", "status": "CORTEX_STEP_STATUS_DONE", ... }] }
```

### GetCascadeModelConfigData

```json
// Response
{
  "clientModelConfigs": [{
    "label": "Claude Sonnet 4",
    "modelOrAlias": { "model": "MODEL_PLACEHOLDER_M26" },
    "quotaInfo": { "remainingFraction": 0.85 }
  }]
}
```

### GetAllCascadeTrajectories

```json
// Response
{
  "trajectorySummaries": {
    "abc123": {
      "summary": "Conversation title",
      "stepCount": 42,
      "workspaces": [{ "workspaceFolderAbsoluteUri": "file:///path" }]
    }
  }
}
```

---

## Streaming API

### StreamAgentStateUpdates（主要实时接口）

**协议**: Connect streaming (`application/connect+json`)，二进制 envelope:
```
[flags: 1 byte = 0x00][length: 4 bytes BE uint32][JSON payload]
```

**请求**:
```
POST /exa.language_server_pb.LanguageServerService/StreamAgentStateUpdates
Content-Type: application/connect+json
Connect-Protocol-Version: 1
x-codeium-csrf-token: {csrf}
```
```json
{ "conversationId": "uuid", "subscriberId": "unique-id" }
```

**响应结构** (初始 ~191KB，之后推送增量):
```
update/
  conversationId         ← UUID
  trajectoryId           ← UUID
  status                 ← CASCADE_RUN_STATUS_IDLE | CASCADE_RUN_STATUS_RUNNING
  executableStatus       ← same enum
  executorLoopStatus     ← same enum
  mainTrajectoryUpdate/
    stepsUpdate/
      indices[]          ← 步骤索引数组
      steps[]            ← 完整步骤对象
      totalLength        ← 总步骤数
    trajectoryType       ← CORTEX_TRAJECTORY_TYPE_CASCADE
    metadata/
      workspaces[]       ← workspace 信息
      createdAt          ← ISO 时间戳
```

**关键状态**:
- `CASCADE_RUN_STATUS_IDLE` → AI 完成 → 隐藏停止按钮
- `CASCADE_RUN_STATUS_RUNNING` → AI 工作中 → 显示停止按钮

### 其他 Streaming APIs

| Method | Status | Description |
|--------|--------|-------------|
| `StreamCascadeReactiveUpdates` | ❌ 已禁用 | "reactive state is disabled" |
| `StreamCascadeSummariesReactiveUpdates` | ❌ 已禁用 | "reactive state is disabled" |
| `StreamCascadePanelReactiveUpdates` | ❓ | Panel 状态 |
| `StreamUserTrajectoryReactiveUpdates` | ❓ | Trajectory 变化 |

### 步骤数据源优先级

| 优先级 | 数据源 | 说明 |
|--------|--------|------|
| 1 | `StreamAgentStateUpdates` (streaming) | **权威。** 实时推送步骤 + 状态 |
| 2 | `GetCascadeTrajectorySteps` (checkpoint) | 稳定快照，需 `LoadTrajectory` 预加载冷对话 |
| 3 | `GetCascadeTrajectory` (live fork) | 仅增量，**不要与 checkpoint 合并**（会导致 UI 闪烁）|

---

## Step 类型与数据结构

### Step Types

| Type | Data Field | 说明 |
|------|-----------|------|
| `USER_INPUT` | `userInput.items[].text` | 用户消息 |
| `PLANNER_RESPONSE` | `plannerResponse.modifiedResponse` | AI 回复 |
| `NOTIFY_USER` | `notifyUser` | 审批请求 (`isBlocking`, `pathsToReview`) |
| `TASK_BOUNDARY` | `taskBoundary` | 任务状态更新 (`taskName`, `mode`) |
| `CODE_ACTION` / `CODE_EDIT` | `codeAction` / `codeEdit` | 代码创建/修改 |
| `VIEW_FILE` / `CODE_READ` | `viewFile` / `codeRead` | 读取文件 |
| `RUN_COMMAND` / `TERMINAL_COMMAND` | `runCommand` / `terminalCommand` | Shell 命令 |
| `TOOL_CALL` / `TOOL_RESULT` | `toolCall` / `toolResult` | 工具调用 |
| `SEARCH_WEB` / `WEB_SEARCH` | `searchWeb` / `webSearch` | 网页搜索 |
| `GREP_SEARCH` / `CODEBASE_SEARCH` | `grepSearch` / `codebaseSearch` | 代码搜索 |
| `FILE_SEARCH` / `LIST_DIRECTORY` | `fileSearch` / `listDirectory` | 文件搜索 |
| `ERROR_MESSAGE` | `errorMessage` | 错误 |
| `EPHEMERAL_MESSAGE` | — | 系统消息 |
| `CHECKPOINT` | — | Checkpoint 标记 |

所有 type 前缀 `CORTEX_STEP_TYPE_`，status 后缀 `_DONE` / `_RUNNING` / `_PENDING` / `_ERROR`。

### NotifyUser 结构

```json
{
  "notifyUser": {
    "notificationContent": "Message to the user...",
    "isBlocking": true,
    "askForUserFeedback": true,
    "pathsToReview": [{ "uri": "file:///path/to/artifact.md" }]
  }
}
```

### Proceed/Reject 按钮显示逻辑

```
显示 Proceed 按钮条件:
  1. step.notifyUser.isBlocking === true
  2. 该 NOTIFY_USER 步骤之后不存在 USER_INPUT 步骤
     (如果存在 → 用户已响应 → 隐藏)
```

> ⚠️ **不要**用 `step.status` 判断 — 即使用户未响应，status 也会立即变为 `DONE`
> ⚠️ **不要**用位置判断如 `index >= total - 2` — NOTIFY_USER 可能出现在对话中间

### TaskBoundary 结构

```json
{
  "taskBoundary": {
    "taskName": "Implementing Feature X",
    "taskStatus": "Writing unit tests",
    "taskSummary": "Completed core implementation...",
    "mode": "AGENT_MODE_EXECUTION"
  }
}
```

---

## Pitfalls & 经验教训

### ❌ Phase 1: Checkpoint + Live Fork 合并 → UI 闪烁
合并 `[...checkpoint, ...liveFork]` 导致重复和步骤数震荡。**永远不要合并这两个数据源。**

### ❌ Phase 2: Checkpoint 轮询 → 延迟 + 不一致
3 秒 `setInterval` 轮询 `GetCascadeTrajectorySteps` 导致：
- Checkpoint 刷新滞后（新步骤不可见直到落盘）
- 多服务器步骤数不一致 → 停止按钮闪烁
- 基于 trajectory summary 比较的 `isActive` 不可靠

### ✅ Phase 3: StreamAgentStateUpdates → 当前方案
每个对话打开 streaming 连接。实时推送步骤 + 权威 `CASCADE_RUN_STATUS_IDLE/RUNNING`。单数据源，无轮询，无闪烁。

### 其他要点

- **Cancel**: 使用 `CancelCascadeInvocation`，**不要**用 `CancelCascadeSteps`
- **单调递增守卫**: 前端不应接受步骤数减少的更新
- **Model ID**: `MODEL_PLACEHOLDER_M26` 等是内部名称，用 `GetCascadeModelConfigData` 获取显示标签
