# Agent System Internals — Antigravity 调用机制

本文档详细说明 V3.5 多 Agent 系统如何调用 Antigravity 的 gRPC 接口来实现编程闭环。包含 V3.5 新增的 Template 配置加载、Pipeline 自动链式触发、Supervisor 看护等机制的底层调用链。

---

## 架构全景

```
API Request
  → group-runtime.ts (调度器)
    → gateway.ts (服务器发现 + owner 路由)
      → grpc.ts (gRPC-Web 调用)
        → language_server (Antigravity 后端)
          → Workspace 执行
```

当前版本（V3.5）中 `group-runtime.ts` 通过 `AssetLoader` 从 `.agents/assets/templates/*.json` 加载 Template 定义，Template 中内联了 Groups 和 Pipeline。调用链不经过 Adapter 抽象层，直接调用 Bridge 层（`gateway.ts` + `grpc.ts`）。

---

## 1. 服务器发现

**模块**: `src/lib/bridge/discovery.ts`

Antigravity 为每个打开的 Workspace 运行一个独立的 `language_server` 进程。系统通过以下方式发现它们：

1. `ps aux` 扫描进程名 `language_server`
2. `lsof` 获取监听的 HTTPS 端口
3. 从进程命令行参数解码 Workspace 路径和 CSRF token

**关键约束**: 每个 conversation 必须路由到正确的 server（按 Workspace 匹配），否则会产生 invisible fork。

---

## 2. Dispatch 调用链

当 `dispatchRun()` 被触发时，依次调用以下 gRPC 方法：

### 2.1 `StartCascade`

```
POST /exa.language_server_pb.LanguageServerService/StartCascade
```

**作用**: 创建一个新的 conversation（child conversation）

**请求体**: 
```json
{
  "metadata": { "apiKey": "...", "ideName": "antigravity", ... },
  "source": "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
  "workspaceUris": ["file:///path/to/workspace"]
}
```

**响应**: `{ "cascadeId": "uuid" }`

### 2.2 `UpdateConversationAnnotations`

```
POST /exa.language_server_pb.LanguageServerService/UpdateConversationAnnotations
```

**作用**: 给 child conversation 打上 hidden 标记

```json
{
  "cascadeId": "...",
  "annotations": {
    "antigravity.task.hidden": "true",
    "antigravity.task.parentId": "...",
    "antigravity.task.groupId": "coding-basic",
    "antigravity.task.runId": "...",
    "lastUserViewTime": "2026-03-21T..."
  },
  "mergeAnnotations": true
}
```

### 2.3 `SendUserCascadeMessage`

```
POST /exa.language_server_pb.LanguageServerService/SendUserCascadeMessage
```

**作用**: 向 child conversation 发送 workflow prompt

```json
{
  "cascadeId": "...",
  "items": [{ "text": "/dev-worker 修复登录 token 刷新问题" }],
  "metadata": { "apiKey": "...", ... },
  "cascadeConfig": {
    "plannerConfig": {
      "conversational": { "agenticMode": true },
      "requestedModel": { "model": "MODEL_PLACEHOLDER_M26" }
    }
  }
}
```

**说明**: `/dev-worker` 前缀触发 AssetLoader 从全局目录 `~/.gemini/antigravity/gateway/assets/workflows/dev-worker.md` 加载 system prompt。

---

## 3. Step Stream 监听

### `StreamAgentStateUpdates`

```
POST /exa.language_server_pb.LanguageServerService/StreamAgentStateUpdates
```

**协议**: Connect Streaming（二进制 envelope，每帧 5 字节 header + JSON payload）

**作用**: 实时推送 child conversation 的执行状态

**推送内容**:
```json
{
  "update": {
    "status": "CASCADE_RUN_STATUS_RUNNING",
    "mainTrajectoryUpdate": {
      "stepsUpdate": {
        "steps": [...],
        "indices": [0, 1, 5],
        "totalLength": 10
      }
    }
  }
}
```

**Delta Merge 机制** (`step-merger.ts`):
- `indices` 模式: 按索引位替换 — `fullSteps[indices[i]] = newSteps[i]`
- Full Replace 模式: 无 indices 时整体替换

**关键状态**:
- `CASCADE_RUN_STATUS_RUNNING` — 执行中
- `CASCADE_RUN_STATUS_IDLE` — 执行完成

---

## 4. Auto-Approve

Worker 执行过程中可能遇到 `NOTIFY_USER` 步骤请求审批。autoApprove 策略：

1. 检测 `plannerResponse.isBlocking === true`
2. 读取 `reviewAbsoluteUris`（优先）或 `pathsToReview`
3. 对每个 URI 调用 `SendUserCascadeMessage` + `artifactComments`：

```json
{
  "cascadeId": "...",
  "artifactComments": [{
    "artifactUri": "file:///path/to/file.ts",
    "fullFile": {},
    "approvalStatus": "ARTIFACT_APPROVAL_STATUS_APPROVED"
  }]
}
```

4. 如果 `isBlocking=true` 但没有 URI → 标记 run 为 `blocked`

---

## 5. 取消

### `CancelCascadeInvocation`

```
POST /exa.language_server_pb.LanguageServerService/CancelCascadeInvocation
```

```json
{ "cascadeId": "...", "metadata": { "apiKey": "...", ... } }
```

注意使用 `CancelCascadeInvocation` 而非 `CancelCascadeSteps`（后者行为不一致）。

---

## 6. 结果提取

当 stream 报告 `CASCADE_RUN_STATUS_IDLE` 时，提取结果优先使用 V3 平台级协议 `result.json`。

如果子 Agent 在项目级 artifact 目录（如 `demolong/projects/{projectId}/runs/{runId}/`）根下写了 `result.json`，则直接读取其 `status`, `summary`, `changedFiles` 等字段。

如果 `result.json` 不存在（例如对于 V1 的 legacy run），则退回到 `compactCodingResult()` 启发式从 steps 中提取：

| 字段 | 提取规则 |
|------|----------|
| `summary` | 最后一个 `status=DONE` 的 `PLANNER_RESPONSE` 的 `modifiedResponse ?? response` |
| `changedFiles` | 所有 `CODE_ACTION` 步骤中的 `absoluteUri` |
| `blockers` | 未解决的 blocking `NOTIFY_USER` |
| `needsReview` | `reviewAbsoluteUris` + `pathsToReview` |

---

## 7. Owner 路由

**模块**: `src/lib/bridge/gateway.ts`

每个 conversation 必须路由到创建它的 server。路由顺序：

1. `convOwnerMap` — 通过 `refreshOwnerMap()` 从所有 server 的 `GetAllCascadeTrajectories` 构建
2. `preRegisteredOwners` — dispatch 后立即注册，60s TTL，防止新 conversation 在 ownerMap 刷新前丢失
3. Fallback — 使用第一个可用 server（仅在前两者都 miss 时）

---

## 8. 文件目录

```
src/lib/agents/
├── group-types.ts          # 类型定义（V3.5: 含 maxRetries, staleThresholdMs, pipelineId）
├── group-registry.ts       # Group 注册表（委托 AssetLoader 从 Template 加载）
├── asset-loader.ts         # V3.5: 从 .agents/assets/templates/*.json 加载 Template，扁平化为 GroupDefinition[]
├── asset-types.ts          # Group/ReviewPolicy/TemplatePack 资产类型
├── pipeline-types.ts       # TemplateDefinition + PipelineStage 类型
├── pipeline-registry.ts    # Pipeline 查询（委托 AssetLoader.loadAllTemplates()）
├── run-registry.ts         # Run 状态 + JSON 持久化（V3.5: 含 pipelineId, pipelineStageIndex）
├── project-registry.ts     # V3 Project 注册表
├── review-engine.ts        # 审查策略引擎
├── scope-governor.ts       # writeScope 冲突检测
├── step-merger.ts          # 共享 delta merge
├── watch-conversation.ts   # gRPC stream 监听 + stale 检测
└── group-runtime.ts        # 核心调度器（V3.5: 含 tryAutoTriggerNextStage, supervisor retry loop）

src/lib/bridge/
├── discovery.ts            # 服务器发现
├── gateway.ts              # Owner 路由
├── grpc.ts                 # gRPC-Web 调用
└── statedb.ts              # SQLite 读取

.agents/assets/
├── templates/              # V3.5: Template 配置（每个文件 = groups + pipeline）
│   ├── development-template-1.json
│   ├── design-review-template.json
│   ├── ux-driven-dev-template.json
│   └── coding-basic-template.json
└── review-policies/        # 审查策略 JSON
```
