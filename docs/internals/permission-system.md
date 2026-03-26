# Antigravity 权限系统完整参考文档

> 逆向分析日期：2026-03-22  
> 分析版本：Antigravity 1.107.0  
> Language Server 二进制：`language_server_macos_arm`

---

## 目录

1. [架构总览](#架构总览)
2. [三层权限模型](#三层权限模型)
3. [USS 统一状态同步机制](#uss-统一状态同步机制)
4. [toolConfig 完整子配置参考](#toolconfig-完整子配置参考)
5. [文件权限审批流程](#文件权限审批流程)
6. [gRPC 方法参考](#grpc-方法参考)
7. [React 前端适配策略](#react-前端适配策略)

---

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│                  Antigravity IDE                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐│
│  │ Settings UI  │  │Extension Host│  │ Chat Panel ││
│  │  (React)     │→ │  (Node.js)   │→ │  (React)   ││
│  └──────────────┘  └──────┬───────┘  └──────┬─────┘│
│                           │USS               │gRPC  │
│                           ↓                  ↓      │
│              ┌────────────────────────────────────┐ │
│              │      Language Server (Go 二进制)    │ │
│              │  ┌─────────┐  ┌─────────────────┐ │ │
│              │  │ToolConfig│  │FilePermission   │ │ │
│              │  │ Merger   │  │   Checker       │ │ │
│              │  └─────────┘  └─────────────────┘ │ │
│              └────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│            React 前端 (Antigravity-Mobility-CLI)     │
│  ┌──────────────┐        ┌──────────────┐           │
│  │ Chat UI      │  gRPC  │ grpc.ts      │           │
│  │ (chat.tsx)   │←──────→│ (bridge)     │           │
│  └──────────────┘        └──────┬───────┘           │
│                                 │                    │
│                    ❌ 无 USS 同步                     │
│                    ❌ 无 Extension Host               │
│                    ❌ 权限设置使用默认值（全部关闭）    │
└─────────────────────────────────────────────────────┘
```

---

## 三层权限模型

### 第一层：Agent Preferences（USS 同步）

IDE 通过 **Unified State Sync (USS)** 系统将全局设置同步到 Language Server。这些设置**不通过 `cascadeConfig` 传递**，而是通过独立的 key-value 存储系统。

| 设置 | Sentinel Key | 默认值 | 含义 |
|------|-------------|-------|------|
| `allowAgentAccessNonWorkspaceFiles` | `allowAgentAccessNonWorkspaceFilesSentinelKey` | `false` | 允许 Agent 访问 workspace 外的文件 |
| `allowCascadeAccessGitignoreFiles` | `allowCascadeAccessGitignoreFilesSentinelKey` | `false` | 允许 Agent 访问 .gitignore 中的文件 |
| `terminalAutoExecutionPolicy` | `terminalAutoExecutionPolicySentinelKey` | `OFF` | 终端命令自动执行策略 |
| `artifactReviewPolicy` | `artifactReviewPolicySentinelKey` | `ALWAYS` | Artifact 审核策略 |
| `secureMode` | — | `false` | 安全模式（覆盖其他设置） |
| `terminalAllowedCommands` | `terminalAllowedCommandsSentinelKey` | `[]` | 终端命令白名单 |
| `terminalDeniedCommands` | `terminalDeniedCommandsSentinelKey` | `[]` | 终端命令黑名单 |
| `enableTerminalSandbox` | `enableTerminalSandboxSentinelKey` | `false` | 终端沙箱 |
| `sandboxAllowNetwork` | `sandboxAllowNetworkSentinelKey` | `true` | 沙箱内允许网络 |
| `planningMode` | — | `ON` | 规划模式 |
| `knowledgeEnabled` | `knowledgeEnabledSentinelKey` | `true` | Knowledge 功能 |
| `conversationHistoryEnabled` | `conversationHistoryEnabledSentinelKey` | `true` | 对话历史 |
| `disableAutoOpenEditedFiles` | `disableAutoOpenEditedFilesSentinelKey` | `false` | 禁用自动打开编辑的文件 |
| `disableCascadeAutoFixLints` | `disableCascadeAutoFixLintsSentinelKey` | `false` | 禁用自动修复 Lint |
| `enableShellIntegration` | `enableShellIntegrationSentinelKey` | `true` | Shell 集成 |
| `enableSoundsForSpecialEvents` | `enableSoundsForSpecialEventsSentinelKey` | `false` | 音效 |
| `enableAutoExpandToolbar` | `enableAutoExpandToolbarSentinelKey` | `true` | 自动展开工具栏 |
| `followAlongWithAgentDefault` | `followAlongWithAgentDefaultSentinelKey` | `false` | 跟随 Agent |
| `explainAndFixInCurrentConversation` | `explainAndFixInCurrentConversationSentinelKey` | `false` | 在当前对话中解释并修复 |
| `disableOpenCascadeOnReload` | `disableOpenCascadeOnReloadSentinelKey` | `false` | 禁用重载时打开对话 |

> **关键问题**：React 前端从未调用 USS 同步，因此 Language Server 中这些设置全部为默认值（`allowCascadeAccessGitignoreFiles = false`，`allowAgentAccessNonWorkspaceFiles = false`）。

### 第二层：CascadeConfig（随消息传递）

通过 `SendUserCascadeMessage` 的 `cascadeConfig.plannerConfig.toolConfig` 传递。**这是用户主动控制的，可以在每条消息中自定义**。

```json
{
  "cascadeConfig": {
    "plannerConfig": {
      "conversational": {
        "plannerMode": "CONVERSATIONAL_PLANNER_MODE_DEFAULT",
        "agenticMode": true
      },
      "toolConfig": {
        "runCommand": { ... },      // ← 你当前只传了这两个
        "notifyUser": { ... },
        "code": { ... },            // ← 可以传但你没传
        "viewFile": { ... },        // ← 可以传但你没传
        "grep": { ... },            // ← 可以传但你没传
        "listDir": { ... },         // ...
        // ... 共 20+ 个子配置
      },
      "requestedModel": { "model": "MODEL_PLACEHOLDER_M47" }
    }
  }
}
```

### 第三层：对话级权限（HandleCascadeUserInteraction）

在运行时，用户可以针对**单个 step** 授权文件访问。这些权限缓存在 `TrajectoryPermissions.FileAccessPermissions`（对话级别）中。

```
gRPC 方法: HandleCascadeUserInteraction
Request: {
  cascadeId: string,
  interaction: {
    trajectoryId: string,
    stepIndex: number,
    filePermission: {            // oneof interaction case
      allow: bool,
      scope: "PERMISSION_SCOPE_ONCE" | "PERMISSION_SCOPE_CONVERSATION" | "PERMISSION_SCOPE_UNSPECIFIED",
      absolutePathUri: string
    }
  }
}
```

---

## USS 统一状态同步机制

### 架构

USS 是 Antigravity IDE 内部的 key-value 状态同步系统，运行在 Extension Host 进程中。

```
IDE Settings UI
    ↓ onChange
Extension Host (USS Provider)
    ↓ constructUpdateRequest()
    ↓ 构造 topicName + sentinelKey + value
Language Server (USS Consumer)
    ↓ 从 USS topic 读取设置
    ↓ 合并到 toolConfig
Tool Execution（使用最终合并后的 config）
```

### Topic 结构

所有 Agent 相关设置使用同一个 topic：`uss-agentPreferences`。

每个设置通过一个 **sentinel key** 标识。例如：

```javascript
// IDE 内部的 USS 定义（from agentFileAccess.js）
FJe = zg({
  topic: "uss-agentPreferences",
  sentinelKey: "allowAgentAccessNonWorkspaceFilesSentinelKey",
  defaultValue: false   // Bd.allowAgentAccessNonWorkspaceFiles
});

AJe = zg({
  topic: "uss-agentPreferences",
  sentinelKey: "allowCascadeAccessGitignoreFilesSentinelKey",
  defaultValue: false   // Bd.allowCascadeAccessGitignoreFiles
});
```

### USS 更新请求格式

```javascript
// 构造 USS 更新请求
{
  topicName: "uss-agentPreferences",
  appliedUpdate: {
    key: "<sentinelKey>",
    newRow: {
      value: JSON.stringify(<new_value>)
    }
  }
}
```

### USS 与 gRPC 的关系

USS 更新在 IDE 内部是通过 Extension Host IPC 完成的，**不直接走 gRPC**。但是 Language Server 通过 `GetUserSettings` / `SetUserSettings` gRPC 方法暴露了设置的读写接口。

### Cached Override 机制

设置在 IDE 缓存中的 key 格式为 `cached.<settingName>`：

```javascript
nd = {
  ALLOW_AGENT_ACCESS_NON_WORKSPACE_FILES: "cached.allowAgentAccessNonWorkspaceFiles",
  ALLOW_CASCADE_ACCESS_GITIGNORE_FILES: "cached.allowCascadeAccessGitignoreFiles",
  ENABLE_TERMINAL_SANDBOX: "cached.enableTerminalSandbox",
  SANDBOX_ALLOW_NETWORK: "cached.sandboxAllowNetwork",
  TERMINAL_AUTO_EXECUTION_POLICY: "cached.terminalAutoExecutionPolicy",
  ARTIFACT_REVIEW_POLICY: "cached.artifactReviewPolicy",
  BROWSER_JS_EXECUTION_POLICY: "cached.browserJsExecutionConfig",
  // ...
}
```

### Secure Mode 覆盖

当 `secureMode = true` 时，安全相关设置会被强制覆盖：

```javascript
{
  cachedOverrideSentinelKey: nd.ALLOW_CASCADE_ACCESS_GITIGNORE_FILES,
  overrides: {
    SECURE_MODE: {
      applyOverride: (e, t) => t.getSecureModeEnabled() ? NE(e, [true], 10) : e
    }
  }
}
```

---

## toolConfig 完整子配置参考

以下是从实际 gRPC stream 数据中提取的**完整 toolConfig 结构**（IDE 与 Language Server 合并后的最终版本）：

### 1. `mquery` — MQuery 工具
```json
{
  "forceDisable": true
}
```

### 2. `code` — 代码编辑工具（write_to_file, replace_file_content, multi_replace）

**⚠️ 包含 gitignore 权限字段**

```json
{
  "disableExtensions": [".ipynb"],
  "allowEditGitignore": true,         // ← 关键权限：是否允许编辑 gitignored 文件
  "enterpriseConfig": {
    "enforceWorkspaceValidation": false
  },
  "applyEdits": true,
  "onlyShowIncrementalDiffZone": false,
  "skipAwaitLintErrors": false,
  "autoFixLintsConfig": { "enabled": true },
  "replaceContentToolConfig": {
    "maxFuzzyEditDistanceFraction": 0.001,
    "allowPartialReplacementSuccess": true,
    "fastApplyFallbackConfig": {
      "enabled": false,
      "promptUnchangedThreshold": 5,
      "contentViewRadiusLines": 200,
      "contentEditRadiusLines": 5,
      "fastApplyModel": "MODEL_GOOGLE_GEMINI_2_5_FLASH"
    },
    "toolVariant": "REPLACE_TOOL_VARIANT_SINGLE_MULTI",
    "showTriggeredMemories": true,
    "disableAllowMultiple": false,
    "useLineRange": true
  },
  "classifyEdit": false,
  "provideImportance": false,
  "useSedEdit": false,
  "useReplaceContentProposeCode": false
}
```

### 3. `intent` — 用户意图分析
```json
{
  "intentModel": "MODEL_GOOGLE_GEMINI_2_5_FLASH",
  "maxContextTokens": 40000
}
```

### 4. `grep` — Grep 搜索工具

**⚠️ 包含 gitignore 权限字段**

```json
{
  "maxGrepResults": 50,
  "includeCciInResult": false,
  "enterpriseConfig": { "enforceWorkspaceValidation": false },
  "allowAccessGitignore": true,       // ← 关键权限：是否允许 grep gitignored 文件
  "useCodeSearch": false,
  "disableFallbackToLocalExecution": false
}
```

### 5. `find` — 文件查找工具
```json
{
  "maxFindResults": 50,
  "fdPath": "/Applications/Antigravity.app/.../bin/fd",
  "useCodeSearch": false,
  "disableFallbackToLocalExecution": false
}
```

### 6. `runCommand` — 终端命令执行工具
```json
{
  "maxCharsCommandStdout": 8192,
  "forceDisable": false,
  "autoCommandConfig": {
    "systemAllowlist": ["echo", "ls"],
    "systemDenylist": ["rmdir"],
    "autoExecutionPolicy": "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER"
  },
  "enableIdeTerminalExecution": true,
  "forceGoTerminalExecution": false,
  "shellName": "zsh",
  "shellPath": "/bin/zsh",
  "enterpriseConfig": { "enforceWorkspaceValidation": false },
  "forbidSearchCommands": false
}
```

autoExecutionPolicy 枚举值：
- `CASCADE_COMMANDS_AUTO_EXECUTION_EAGER` — 自动执行（除黑名单）
- `CASCADE_COMMANDS_AUTO_EXECUTION_OFF` — 每条命令都要审批

### 7. `viewFile` — 文件查看工具

**⚠️ 包含 gitignore 权限字段**

```json
{
  "allowViewGitignore": true,         // ← 关键权限：是否允许查看 gitignored 文件
  "splitOutlineTool": true,
  "showTriggeredMemories": true,
  "enterpriseConfig": { "enforceWorkspaceValidation": false },
  "maxLinesPerView": 800,
  "includeLineNumbers": true,
  "maxTotalOutlineBytes": 8192,
  "maxBytesPerOutlineItem": 512,
  "showFullFileBytes": 8192
}
```

### 8. `suggestedResponse` — 建议回复
```json
{ "forceDisable": true }
```

### 9. `searchWeb` — Web 搜索工具
```json
{
  "forceDisable": false,
  "thirdPartyConfig": {
    "provider": "THIRD_PARTY_WEB_SEARCH_PROVIDER_GEMINI"
  }
}
```

### 10. `mcp` — MCP Tools
```json
{
  "forceDisable": false,
  "maxOutputBytes": 4096
}
```

### 11. `listDir` — 目录列表工具

**⚠️ 没有 gitignore 权限字段，但有 workspace 限制**

```json
{
  "enterpriseConfig": { "enforceWorkspaceValidation": false }
}
```

> **重要发现**：`listDir` 没有自己的 `allowAccessGitignore` 字段。它的 gitignore 检查依赖全局的 `allowCascadeAccessGitignoreFiles` 设置（通过 USS 同步），不能通过 toolConfig 覆盖。

### 12. `commandStatus` — 命令状态查询工具
```json
{
  "useDelta": true,
  "maxOutputCharacters": 8192,
  "minOutputCharacters": 1024,
  "maxWaitDurationSeconds": 300,
  "outputStabilizationDurationSeconds": 5
}
```

### 13. `antigravityBrowser` — 浏览器工具集
```json
{
  "enabled": true,
  "captureBrowserScreenshot": { "enableSaving": true },
  "browserSubagent": {
    "mode": "BROWSER_SUBAGENT_MODE_SUBAGENT_ONLY",
    "browserSubagentModel": "MODEL_PLACEHOLDER_M18",
    "useDetailedConverter": true,
    "disableOnboarding": false,
    "subagentReminderMode": { "verifyScreenshots": {} },
    "contextConfig": {
      "type": "CONTEXT_TYPE_WITH_MARKDOWN_TRAJECTORY_SUMMARY",
      "maxChars": 10000
    },
    "domExtractionConfig": { "includeCoordinates": true },
    "lowLevelToolsConfig": {
      "enableLowLevelToolsInstructions": true,
      "enableMouseTools": true
    },
    "enableScratchpad": true
  },
  "clickBrowserPixel": {
    "clickFeedback": {
      "enabled": true,
      "red": 255, "green": 0, "blue": 0, "alpha": 255,
      "displayColor": "red",
      "radius": 25,
      "feedbackType": "FEEDBACK_TYPE_MOUSE_POINTER"
    }
  },
  "browserStateDiffingConfig": {
    "captureAgentActionDiffs": true,
    "includeDomTreeInDiffs": false
  },
  "browserListNetworkRequestsToolConfig": { "enabled": true },
  "browserGetNetworkRequestToolConfig": { "enabled": true },
  "toolSetMode": "BROWSER_TOOL_SET_MODE_ALL_INPUT_PIXEL_OUTPUT",
  "disableOpenUrl": false,
  "browserJsExecutionPolicy": "BROWSER_JS_EXECUTION_POLICY_DISABLED",
  "variableWaitTool": true,
  "disableWorkspaceApi": false,
  "skipPermissionChecks": false,
  "displayOnCrd": true
}
```

browserJsExecutionPolicy 枚举：
- `BROWSER_JS_EXECUTION_POLICY_DISABLED` — 禁用 JS 执行
- `BROWSER_JS_EXECUTION_POLICY_ALWAYS_ASK` — 每次都问
- `BROWSER_JS_EXECUTION_POLICY_TURBO` — 自动执行

### 14. `internalSearch` — 内部搜索
```json
{
  "maxResults": 10,
  "maxContentLength": 5000
}
```

### 15. `notifyUser` — 用户通知/审核工具
```json
{
  "artifactReviewMode": "ARTIFACT_REVIEW_MODE_ALWAYS"
}
```

artifactReviewMode 枚举：
- `ARTIFACT_REVIEW_MODE_ALWAYS` — 每次都审核 ← 当前配置
- `ARTIFACT_REVIEW_MODE_AUTO` — Agent 自己决定
- `ARTIFACT_REVIEW_MODE_TURBO` — 全部自动通过

### 16. `taskBoundary` — 任务边界管理
```json
{
  "minimumPredictedTaskSize": 3,
  "targetStatusUpdateFrequency": 5,
  "noActiveTaskSoftReminderToolThreshold": 2,
  "noActiveTaskStrictReminderToolThreshold": 5
}
```

### 17. `finish` — 完成工具
```json
{}
```

### 18. `notebookEdit` — Notebook 编辑工具
```json
{ "enabled": false }
```

### 19. `invokeSubagent` — 子代理调用工具
```json
{ "enabled": false }
```

---

## 文件权限审批流程

### BlockReason 枚举

Language Server（Go 二进制）中定义了 3 种阻断原因：

| 枚举值 | 含义 |
|--------|------|
| `BLOCK_REASON_UNSPECIFIED` | 未指定 |
| `BLOCK_REASON_GITIGNORED` | 文件在 .gitignore 中 |
| `BLOCK_REASON_OUTSIDE_WORKSPACE` | 文件在 workspace 外 |

### 每种工具的 FilePermissionRequest 支持

从 Language Server protobuf 定义中提取的 `GetFilePermissionRequest()` 方法列表：

| 工具 Step | 有 filePermissionRequest | 有独立 gitignore 字段 |
|-----------|:-----------------------:|:-------------------:|
| `CortexStepListDirectory` | ✅ | ❌ |
| `CortexStepViewFile` | ✅ | ✅ `allowViewGitignore` |
| `CortexStepGrepSearch` | ✅ | ✅ `allowAccessGitignore` |
| `CortexStepCodeAction` | ✅ | ✅ `allowEditGitignore` |
| `CortexStepViewCodeItem` | ✅ | ❌ |
| `CortexStepViewFileOutline` | ✅ | ❌ |

### 审批触发逻辑

```
Tool 执行请求
    ↓
Language Server 检查目标路径
    ├── 在 workspace 内？
    │   ├── 是 → 在 .gitignore 中？
    │   │       ├── 否 → ✅ 直接执行
    │   │       └── 是 → 检查 allowCascadeAccessGitignoreFiles (USS)
    │   │               ├── true → 检查 toolConfig 的工具级 allow*Gitignore
    │   │               │         ├── true → ⚠️ WAITING（等待用户审批一次）
    │   │               │         └── false/未设置 → ❌ CANCELED
    │   │               └── false → ❌ CANCELED
    │   └── —
    └── 不在 workspace 内？
        → 检查 allowAgentAccessNonWorkspaceFiles (USS)
            ├── true → ⚠️ WAITING
            └── false → ❌ CANCELED
```

> **关键发现**：即使全局 `allowCascadeAccessGitignoreFiles = true`，首次访问 gitignored 文件仍然需要一次用户确认（step 进入 WAITING 状态）。当用户选择 `PERMISSION_SCOPE_CONVERSATION` 后，同路径后续访问不再需要确认。

### PermissionScope 枚举

| 值 | 含义 |
|----|------|
| `PERMISSION_SCOPE_UNSPECIFIED` | 拒绝 |
| `PERMISSION_SCOPE_ONCE` | 仅允许这一次 |
| `PERMISSION_SCOPE_CONVERSATION` | 本次对话内都允许 |

### FileAccessPermission 缓存结构

```protobuf
message FileAccessPermission {
    string path = ...;
    bool is_directory = ...;
    bool allow = ...;
    PermissionScope scope = ...;
    bool from_current_step = ...;
}

message TrajectoryPermissions {
    repeated FileAccessPermission file_access_permissions = ...;
}
```

---

## gRPC 方法参考

### 核心方法

| 方法 | 用途 | React 前端是否已实现 |
|------|------|:---:|
| `StartCascade` | 创建新对话 | ✅ |
| `SendUserCascadeMessage` | 发送用户消息 + Artifact 审批 | ✅ |
| `GetCascadeTrajectorySteps` | 获取对话步骤 | ✅ |
| `StreamAgentStateUpdates` | 实时 step 流 | ✅ |
| `HandleCascadeUserInteraction` | 工具执行审批（文件/命令/浏览器） | ❌ |
| `SetUserSettings` | 推送用户设置到 LS | ❌ |
| `GetUserSettings` | 从 LS 读取用户设置 | ❌ |
| `CancelCascadeInvocation` | 取消对话 | ✅ |
| `RevertToCascadeStep` | 回退到某步 | ✅ |
| `LoadTrajectory` | 加载对话 | ✅ |
| `InitializeCascadePanelState` | 初始化面板状态 | ✅ |
| `AddTrackedWorkspace` | 添加追踪的 workspace | ✅ |

### HandleCascadeUserInteraction 请求格式

```json
{
  "cascadeId": "<conversation-id>",
  "interaction": {
    "trajectoryId": "<trajectory-id>",
    "stepIndex": 9,
    "filePermission": {
      "allow": true,
      "scope": "PERMISSION_SCOPE_CONVERSATION",
      "absolutePathUri": "/path/to/your/file"
    }
  }
}
```

支持的 interaction oneof cases：

| case | 用途 | 参数 |
|------|------|------|
| `filePermission` | 文件/目录访问 | `allow`, `scope`, `absolutePathUri` |
| `runCommand` | 终端命令执行 | `confirm`, `proposedCommandLine`, `submittedCommandLine`, `sandboxOverride` |
| `browserAction` | 浏览器页面访问 | `confirm` |
| `sendCommandInput` | 发送命令输入 | — |
| `openBrowserUrl` | 打开浏览器 URL | — |
| `readUrlContent` | 读取 URL 内容 | — |
| `clickBrowserPixel` | 浏览器点击 | — |
| `captureBrowserScreenshot` | 浏览器截图 | — |
| `executeBrowserJavascript` | 浏览器执行 JS | — |
| `openBrowserSetup` | 浏览器设置 | — |
| `confirmBrowserSetup` | 确认浏览器设置 | — |
| `runExtensionCode` | 运行扩展代码 | — |
| `deploy` | 部署 | — |
| `elicitation` | 用户引导 | — |
| `mcp` | MCP 工具 | — |

---

## React 前端适配策略

### 揭开 "跳过 WAITING 直接 CANCELED" 的谜团

正如你所观察到的，通过 IDE 发起的任务状态是 `PENDING → RUNNING → WAITING`，而在 React 前端中则是直接 `PENDING → RUNNING → CANCELED`。

**为什么前端拿不到 WAITING 状态？**
这是因为双重校验机制：
1. 第一重校验：Language Server 检查 USS 全局设置 `allowCascadeAccessGitignoreFiles`。由于你同时开着 IDE，IDE 的 Extension Host **已经帮你同步了 USS 设置为 true**，所以第一重校验通过了（无需你在 React 去调 USS）。
2. 第二重校验：Language Server 检查请求体 `cascadeConfig.plannerConfig.toolConfig` 中的工具级开关配置（例如 `viewFile.allowViewGitignore`）。
   - IDE 发请求时，带上了这个值为 `true`，因此进入 `WAITING` 等待你手动点击 Allow。
   - React 前端目前的源码中，`buildCascadeConfig` **没有传入这个字段，导致默认为 `false`**。Language Server 认为你明确拒绝了该工具访问 gitignore 文件，因此直接掐断，抛出 `CANCELED`，不给任何审批机会。

### 方案 A：在 buildCascadeConfig 中补充 toolConfig（最核心的修复）

为了让 Language Server 知道我们允许进入 `WAITING` 状态以供审批，必须在 `src/lib/bridge/grpc.ts` 的 `buildCascadeConfig` 函数中，补齐完整权限参数：

```typescript
export function buildCascadeConfig(model: string = '...', agenticMode: boolean = true) {
  return {
    plannerConfig: {
      conversational: { plannerMode: '...', agenticMode },
      toolConfig: {
        runCommand: {
          autoCommandConfig: { autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER' }
        },
        notifyUser: {
          artifactReviewMode: 'ARTIFACT_REVIEW_MODE_AUTO' // 交给 Agent
        },
        // ▼▼ 核心新增代码：告诉 Language Server 允许挂起以供审批 ▼▼
        code: { allowEditGitignore: true },
        viewFile: { allowViewGitignore: true },
        grep: { allowAccessGitignore: true },
        listDir: { 
          enterpriseConfig: { enforceWorkspaceValidation: false } // listDir 没有专属开关，只需放开 workspace 限制
        }
      },
      requestedModel: { model },
    },
  };
}
```

### 方案 B：实现 HandleCascadeUserInteraction 审批 UI

一旦补全了 `toolConfig`，React 前端在请求受到限制路径时（例如 `viewFile` 读取 gitignore 的文件）就可以正确收到 `status === 'WAITING'` 且携带 `filePermissionRequest` 的 step 数据了。

接下来只需：
1. 在 `watch-conversation.ts` 中允许处理 `WAITING` 状态。
2. 在 `chat.tsx` 中为这类 step 渲染 `Allow Once` 和 `Allow Conversation` 按钮。
3. 点击时调用 gRPC 的 `HandleCascadeUserInteraction` 给 LangServer 发回执，Agent 即可继续执行。

### 关于 `listDir` 的特殊无解限制 (为什么直接 CANCELED)

细心的开发者可能会发现，**无论怎么配置，使用 `listDir` 读取 gitignore 目录总是会直接被 CANCELED**，甚至连 `WAITING` 的审批机会都不给。

这个核心死穴的源头在于 Language Server 的底层架构对该工具的权限判别机制不同寻常：

1. **底层没有设计工具级开关**：`listDir` 在 `toolConfig` 里本身就不具备类似于 `viewFile.allowViewGitignore` 的子配置项（在 Language Server 的 protobuf 中 `ListDirToolConfig` 只有 `enterpriseConfig`）。
2. **唯一依赖 USS 特权内存**：它拦截 `gitignore` 的判别逻辑，被写死为仅仅去读取名为 `UnifiedStateSyncClient` (USS) 的全局缓存。
3. **前端无法直接注入 USS**：USS 是一个由 **Extension Server**（即 IDE 特权宿主进程）通过专用的单向流推送通道 (`PushUnifiedStateSyncUpdate`) 注入的。我们在前端无论在 `CascadeConfig` 里写什么参数，甚至直接调用 `SetUserSettings` gRPC 方法都无法修改到内存中真正被 `listDir` 读取的那个标志位！

#### 终极破解思路：被迫 Cancel 后主动“塞入”权限缓存 (强制挂载)

虽然配置阶段我们无法绕过拦截，但在实战测试中发现了一条“暗度陈仓”的后门：

**如果你监听到某次包含了文件路径访问的 Step 因为无情拦截导致了 `cancel`，你可以直接手动往后端发一个通过 `HandleCascadeUserInteraction` 方法构造的回执包！**

虽然这个任务并没有真正进入 `WAITING` 状态等待，但由于后端在收到这个回执请求后，会直接往 `TrajectoryPermissions.FileAccessPermissions` 缓存内暴力写入 `PERMISSION_SCOPE_CONVERSATION`（基于对话级别）通过记录。有了这条缓存后，后续的指令就能畅通无阻了。

这就是绕过 `listDir` 无解判定的唯一有效方案示例（相当于强制帮那个被 Cancel 的路径伪造一份通行证）：

```bash
# 遇到目录/文件被 CANCELED 之后，立即发送这个交互强签长效通行证
curl 'https://127.0.0.1:62591/exa.language_server_pb.LanguageServerService/HandleCascadeUserInteraction' \
  -H 'content-type: application/json' \
  -H 'x-codeium-csrf-token: <your-csrf>' \
  --data-raw '{
    "cascadeId": "<current-cascade-id>",
    "interaction": {
      "trajectoryId": "<trajectory-id>",
      "stepIndex": 9,
      "filePermission": {
        "allow": true,
        "scope": "PERMISSION_SCOPE_CONVERSATION",
        "absolutePathUri": "/Users/.../你的目标路径"
      }
    }
  }'
```
> 发送完该回执包并返回 200 成功后，你再让 Agent 重新执行刚才被无情 Cancel 掉的 `listDir` 或者其它无解工具指令，它就会直接顺利读取成功了！

## 附录：Language Server gRPC 完整方法列表

从 `language_server_macos_arm` 二进制中提取的所有 `LanguageServerService` 方法：

```
AcceptTermsOfService
AcknowledgeCascadeCodeEdit
AcknowledgeCodeActionStep
AddToBrowserWhitelist
AddTrackedWorkspace
BrowserValidateCascadeOrCancelOverlayGenerate
CancelCascadeInvocation
CancelCascadeSteps
CaptureConsoleLogs
CaptureScreenshot
ConvertTrajectoryToMarkdown
CopyBuiltinWorkflowToWorkspace
CopyTrajectory
CreateCustomizationFile
CreateReplayWorkspace
CreateTrajectoryShare
CreateWorktree
DeleteCascadeMemory
DeleteCascadeTrajectory
DeleteMediaArtifact
DeleteQueuedUserInputStep
DumpFlightRecorder
DumpPprof
FocusUserPage
ForceBackgroundResearchRefresh
GenerateCommitMessage
GetAgentScripts
GetAllBrowserWhitelistedUrls
GetAllCascadeTrajectories
GetAllCustomAgentConfigs
GetAllPlugins
GetAllRules
GetAllSkills
GetAllWorkflows
GetArtifactSnapshots
GetBrowserOpenConversation
GetBrowserWhitelistFilePath
GetCascadeMemories
GetCascadeModelConfigData
GetCascadeModelConfigs
GetCascadeNuxes
GetCascadePluginById
GetCascadeTrajectory
GetCascadeTrajectoryGeneratorMetadata
GetCascadeTrajectorySteps
GetChangelog
GetCodeValidationStates
GetCommandModelConfigs
GetDebugDiagnostics
GetMatchingContextScopeItems
GetMcpPrompt
GetMcpServerStates
GetMcpServerTemplates
GetModelResponse
GetModelStatuses
GetPatchAndCodeChange
GetProfileData
GetRepoInfos
GetRevertPreview
GetRevisionArtifact
GetStaticExperimentStatus
GetStatus
GetTermsOfService
GetTokenBase
GetTranscription
GetUnleashData
GetUserAnalyticsSummary
GetUserMemories
GetUserSettings
GetUserStatus
GetUserTrajectory
GetUserTrajectoryDebug
GetUserTrajectoryDescriptions
GetWebDocsOptions
GetWorkingDirectories
GetWorkspaceEditState
GetWorkspaceInfos
HandleCascadeUserInteraction
HandleScreenRecording
HandleStreamingCommand
Heartbeat
ImportFromCursor
InitializeCascadePanelState
InstallCascadePlugin
JetboxSubscribeToState
JetboxWriteState
ListCustomizationPathsByFile
ListMcpPrompts
ListMcpResources
ListPages
LoadReplayConversation
LoadTrajectory
MigrateApiKey
OpenUrlAuthentication
ProvideCompletionFeedback
ReadFile
ReconnectExtensionServer
RecordAnalyticsEvent
RecordChatFeedback
RecordChatPanelSession
RecordCommitMessageSave
RecordEvent
RecordInteractiveCascadeFeedback
RecordLints
RecordSearchDocOpen
RecordSearchResultsView
RecordUserGrep
RecordUserStepSnapshot
RefreshContextForIdeAction
RefreshMcpServers
RegisterGdmUser
RemoveTrackedWorkspace
ReplayGroundTruthTrajectory
RequestAgentStatePageUpdate
ResetOnboarding
ResolveOutstandingSteps
RevertToCascadeStep
RunCommand
SaveAgentScriptCommandSpec
SaveMediaAsArtifact
SaveScreenRecording
SendActionToChatPanel
SendAllQueuedMessages
SendUserCascadeMessage
SetBaseExperiments
SetBrowserOpenConversation
SetUserSettings
SetWorkingDirectories
SetupUniversitySandbox
ShouldEnableUnleash
SignalExecutableIdle
SimulateSegFault
SkipBrowserSubagent
SkipOnboarding
SmartFocusConversation
SmartOpenBrowser
StartCascade
StartScreenRecording
StatUri
StreamAgentStateUpdates
StreamCascadePanelReactiveUpdates
StreamCascadeReactiveUpdates
StreamCascadeSummariesReactiveUpdates
StreamTerminalShellCommand
StreamUserTrajectoryReactiveUpdates
UpdateCascadeMemory
UpdateConversationAnnotations
UpdateCustomization
UpdateCustomizationPathsFile
UpdateDevExperiments
UpdateEnterpriseExperimentsFromUrl
UpdatePRForWorktree
WatchDirectory
WellSupportedLanguages
```
