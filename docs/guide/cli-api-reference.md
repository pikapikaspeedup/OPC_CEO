# Antigravity Agent System - CLI & API Reference

## Overview
This document provides reference for the REST API exposed by the V3.5 Multi-Agent system. These APIs can be used by external CLI tools, CI/CD pipelines, or other systems to orchestrate and manage autonomous agent tasks.
The API runs on port 3000 by default.

> V6.1 Stage-Centric Migration:
> Public dispatch now uses `templateId + stageId`.
> Persisted templates are inline-only (`pipeline[]` / `graphPipeline.nodes[]` carry execution config directly).
> `groupId`, `/api/agent-groups`, and scheduler `dispatch-group` are removed from the public contract.

> List pagination contract (2026-04-20):
> `GET /api/conversations`, `GET /api/projects`, `GET /api/agent-runs`, `GET /api/company/run-capsules`, `GET /api/company/memory-candidates`, `GET /api/company/signals`, `GET /api/company/agenda`, `GET /api/company/budget/*`, `GET /api/company/circuit-breakers`, `GET /api/company/growth/proposals`, `GET /api/company/loops/*`, `GET /api/company/self-improvement/*`, `GET /api/scheduler/jobs`, `GET /api/projects/:id/checkpoints`, `GET /api/projects/:id/journal`, `GET /api/projects/:id/deliverables`, `GET /api/operations/audit` 统一支持 `page` / `pageSize`，并返回 `{ items, page, pageSize, total, hasMore }`。
> `journal` / `audit` 仍兼容旧 `limit` 参数，但语义已收口为 `pageSize`。

> Split-mode ownership (2026-04-21):
> 当 `web` 以 `AG_CONTROL_PLANE_URL` / `AG_RUNTIME_URL` 运行时，CLI 打到 `localhost:3000` 的这些 endpoint 会被壳层代理到独立后端。
> - `control-plane`: `/api/approval*`、`/api/ai-config`、`/api/api-keys*`、`/api/ceo/*`、`/api/departments/*`、`/api/mcp*`、`/api/workspaces`、`/api/workspaces/import`、`/api/workspaces/close`
> - `runtime`: `/api/me`、`/api/models`、`/api/workspaces/launch`、`/api/workspaces/kill`，以及 conversation / run runtime 主链
> - `api` 组合服务支持同一路径按 method 分流；`GET /api/conversations` 与 `POST /api/conversations` 不会因前序 route 返回 405 而互相截断。

## API Endpoints

### Conversation Shell Compatibility

- `POST /api/conversations`
  - 当 workspace provider 为 `antigravity` 时，创建真实 Cascade conversation，仍依赖 language_server。
  - 当 workspace provider 为本地 provider 轨道时，创建 Gateway 本地 conversation，不依赖 IDE。当前轨道包括：
    - `codex`
    - `native-codex`
    - `claude-api`
    - `openai-api`
    - `gemini-api`
    - `grok-api`
    - `custom`
- `POST /api/conversations/:id/send`
  - `antigravity` conversation 仍走 gRPC send。
  - 本地 provider conversation 走 Gateway 本地 executor / provider transcript store，并把 transcript 写回本地 steps。
  - 本地 provider executor 返回 `status=failed` 时，接口返回 `502 { "error": "..." }`；Native Codex 默认 90s 超时，可通过 `NATIVE_CODEX_TIMEOUT_MS` 调整。
- `GET /api/conversations/:id/steps`
  - 对本地 provider conversation，返回标准化的 CORTEX transcript step（例如 `CORTEX_STEP_TYPE_USER_INPUT`、`CORTEX_STEP_TYPE_PLANNER_RESPONSE`），可直接被前端聊天面板渲染。
- `POST /api/conversations/:id/cancel`
  - Antigravity conversation 走 gRPC cancel。
  - 本地 provider conversation 若没有活动请求，会返回 `status = not_running`，不再错误回退到 IDE 路径。
- `POST /api/conversations/:id/revert` / `GET /api/conversations/:id/revert-preview`
  - Antigravity conversation 走 gRPC。
  - 本地 provider conversation 直接对本地 transcript / transcript store 做 preview 与截断。
- `GET /api/conversations/:id/files`
  - 现在会优先使用 conversation record / backing run 的 workspace，不再只依赖 gRPC owner。

这意味着：

- `Projects / Scheduler / Run transcript` 继续使用统一 backend/run 路径
- `Conversations / CEO Office chat` 现在也能在本地 provider 轨道下独立工作，不再只绑定 Antigravity IDE 会话

### 1. Projects

#### Create a Project
- **URL:** `POST /api/projects`
- **Request Body (JSON):**
  - `name` (String, required): Project name
  - `goal` (String, required): Project goal description
  - `workspace` (String, required): Absolute path to the workspace
  - `templateId` (String, optional): Template identification
  - `projectType` (String, optional): Project type classification
  - `skillHint` (String, optional): Skill hint for the project
- **Example Body:**
  ```json
  {
    "name": "Tetris Game",
    "goal": "Build a simple Tetris game in HTML5",
    "workspace": "/path/to/your/workspace"
  }
  ```
- **Response:** `201 Created`
  ```json
  {
    "projectId": "proj-1234",
    "name": "Tetris Game",
    "goal": "Build a simple Tetris game in HTML5",
    "status": "active",
    "createdAt": "2026-03-22T12:00:00Z",
    "updatedAt": "2026-03-22T12:00:00Z",
    "runIds": []
  }
  ```

#### List Projects
- **URL:** `GET /api/projects`
- **Query Parameters (Optional):**
  - `page` / `pageSize`: 分页参数
- **Response:** `200 OK`
  ```json
  {
    "items": [{ "projectId": "proj-1234", "name": "Tetris Game" }],
    "page": 1,
    "pageSize": 100,
    "total": 154,
    "hasMore": false
  }
  ```

#### Get Project Details
- **URL:** `GET /api/projects/:id`
- **Response:** `200 OK`
  Returns the project definition populated with a `runs` array containing full `AgentRunState` objects.

#### Update a Project
- **URL:** `PATCH /api/projects/:id`
- **Request Body:** Partial `ProjectDefinition` object to update.

#### Resume Project Pipeline
- **URL:** `POST /api/projects/:id/resume`
- **Description:** Resumes a project from its first actionable pipeline stage. The project must have a `pipelineState` (i.e., it was created via template dispatch).
- **Request Body (JSON):**
  - `stageId` (string, optional): Target a specific stage by ID. Defaults to the first actionable stage.
  - `stageIndex` (number, optional): Target a specific stage by index. Defaults to the first actionable stage.
  - `branchIndex` (number, optional): Target a specific branch within a fan-out stage.
  - `action` (string, required): One of:
    - `recover`: Restores the existing Run from artifacts/result envelope.
    - `nudge`: Sends a follow-up prompt to a stale-active Run's existing conversation.
    - `restart_role`: Starts a fresh child conversation for the target role within the same Run.
    - `cancel`: Cancels the canonical Run and marks the stage as `cancelled`.
    - `skip`: Marks the stage as `skipped` without running. For `pending`/`failed`/`blocked`/`cancelled` stages.
    - `force-complete`: **Marks the stage as `completed` and emits `stage:completed` event**, triggering downstream dispatch (fan-out, join, etc). Use when the watcher failed to detect completion. For `running`/`failed`/`blocked`/`cancelled`/`pending` stages.
  - `prompt` (string, optional): Custom prompt for `nudge` / `restart_role`.
  - `roleId` (string, optional): Target role for `restart_role`.
- **Response:** `200 OK` for `recover`, `cancel`, `force-complete`, `skip`. `202 Accepted` for async `nudge` / `restart_role`.
- **Migration Boundary:** `recover` only works for current persisted runs that already carry `stageId` / `pipelineStageId`. Pre-migration `groupId`-only run state is no longer loaded.
- **Action Selection Guide:**
  - `recover` — artifacts exist, restore status only.
  - `nudge` — stale-active run (`liveState.staleSince` present).
  - `restart_role` — fresh child conversation within the same run.
  - `cancel` — stop and mark `cancelled`.
  - `skip` — bypass stage, **no downstream dispatch**.
  - `force-complete` — **manually advance past stuck stage, triggers downstream dispatch**.
- **Example:**
  ```bash
  # Force-complete a stuck planning stage → triggers fan-out
  curl -X POST http://localhost:3000/api/projects/<projectId>/resume \
    -H "Content-Type: application/json" \
    -d '{ "action": "force-complete", "stageId": "planning" }'

  # Recover from artifacts
  curl -X POST http://localhost:3000/api/projects/<projectId>/resume \
    -H "Content-Type: application/json" \
    -d '{ "action": "recover" }'

  # Restart a role
  curl -X POST http://localhost:3000/api/projects/<projectId>/resume \
    -H "Content-Type: application/json" \
    -d '{ "action": "restart_role", "roleId": "ux-review-critic" }'
  ```

### 2. Agent Runs

#### Dispatch a Run
- **URL:** `POST /api/agent-runs`
- **Budget:** Manual dispatch records token/runtime budget ledger and bypasses only autonomous dispatch quota; scheduler-triggered dispatches are budgeted by scheduler before run creation.
- **Request Body (JSON):**
  - `templateId` (String, required): Template ID. Also supports `pipelineId` as an alias.
  - `stageId` (String, optional): Target stage ID inside the template. If omitted, the API dispatches the template entry stage.
  - `workspace` (String, required): Absolute path to the workspace.
  - `prompt` (String): Free-text prompt describing the goal (either `prompt` or `taskEnvelope.goal` is required).
  - `taskEnvelope` (Object): Structured task data (`goal`, `inputArtifacts`, etc.).
  - `executionProfile` (Object, optional): 执行画像。会在路由层归一化后，透传到 `prompt-executor` / `group-runtime` / `BackendRunConfig`。
  - `departmentRuntimeContract` / `runtimeContract` (Object, optional): Department 级 runtime 合同。用于声明工作目录、读写边界、工具集、权限模式与必交付物。路由层会把它写入 `taskEnvelope` carrier 后继续下传。
  - `projectId` (String, optional): ID of the project to associate this run with.
  - `sourceRunIds` (Array of Strings, optional): Used to chain dependencies (e.g., provide specs to an architecture run).
  - `pipelineStageIndex` (Number, optional): Current stage index within the pipeline (0-based). Default is 0 when expanding templates. If omitted while `templateId/pipelineId` and `sourceRunIds` are both present, the API infers the next stage from the first source run.
  - `templateOverrides` (Object, optional, V5.3): Runtime overrides to deep-merge onto the template before compiling the DAG. Any template field can be overridden (e.g., `maxConcurrency`, `defaultModel`). The original template file is never modified; overrides persist in the project's pipeline state.
  - `conversationMode` (String, optional, V5.5): Controls conversation reuse in review-loop stages. `"shared"` = author reuses cascade across rounds (~73% token saving), `"isolated"` = each role gets a new conversation (default). Only effective for `review-loop` stages. Can also be set globally via `AG_SHARED_CONVERSATION=true`.
  - `model` (String, optional): Model ID to use for this run (e.g., `MODEL_PLACEHOLDER_M47`). If omitted, uses the template/stage recommended model.
  - `parentConversationId` (String, optional): ID of the parent conversation to create a child cascade under. Used internally by the runtime for hidden child conversations.
- **Example Body:**
  ```json
  {
    "templateId": "development-template-1",
    "stageId": "product-spec",
    "workspace": "/Users/user/workspace",
    "prompt": "Draft spec for user authentication",
    "projectId": "proj-1234",
    "executionProfile": {
      "kind": "workflow-run",
      "workflowRef": "/pm-author"
    },
    "departmentRuntimeContract": {
      "workspaceRoot": "/Users/user/workspace",
      "additionalWorkingDirectories": [
        "/Users/user/shared-specs"
      ],
      "readRoots": [
        "/Users/user/workspace",
        "/Users/user/shared-specs"
      ],
      "writeRoots": [
        "/Users/user/workspace/docs",
        "/Users/user/workspace/demolong"
      ],
      "artifactRoot": "/Users/user/workspace/demolong/projects/proj-1234/runs/run-5678",
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
    },
    "templateOverrides": { "maxConcurrency": 5 }
  }
  ```
- **Response:** `201 Created`
  ```json
  {
    "runId": "run-5678",
    "status": "starting"
  }
  ```

- **Department Runtime Contract 字段:**
  - `workspaceRoot` (String, required when using contract): Department 主工作目录。
  - `additionalWorkingDirectories` (String[], optional): 额外允许挂载的工作目录。
  - `readRoots` (String[], optional): 允许读取的根路径列表。
  - `writeRoots` (String[], optional): 允许写入的根路径列表。
  - `artifactRoot` (String, optional): 产物根目录。
  - `executionClass` (String, optional): `light` / `artifact-heavy` / `review-loop` / `delivery`。
  - `toolset` (String, optional): `research` / `coding` / `safe` / `full`。
  - `permissionMode` (String, optional): `default` / `dontAsk` / `acceptEdits` / `bypassPermissions`。
  - `requiredArtifacts` (Array, optional): 结构化产物合同，字段包括 `path`、`required`、`format`、`description`。

- **当前实现边界:**
  - `departmentRuntimeContract` 已经会透传到 `BackendRunConfig`。
  - 当前主消费方是 `ClaudeEngineAgentBackend`，覆盖 `claude-api`、`openai-api`、`gemini-api`、`grok-api`、`custom`、`native-codex`。
  - `native-codex` 的 Department / agent-runs 主链已经切到 Claude Engine；旧 `NativeCodexExecutor` 仅保留本地 conversation / chat shell。
  - `codex` 仍然只适合 `light` 任务；高约束任务会被 capability-aware routing 回退。

#### List Runs
- **URL:** `GET /api/agent-runs`
- **Query Parameters (Optional):**
  - `status`: Filter by status (`queued`, `completed`, etc.)
  - `stageId`: Filter by stage (`product-spec`, `planning`, etc.)
  - `projectId`: Filter by project association
  - `reviewOutcome`: Filter by outcome (`approved`, `rejected`, etc.)
  - `schedulerJobId`: Filter by scheduler source
  - `executorKind`: Filter by `prompt` / `template`
  - `page` / `pageSize`: 分页参数
- **Response:** `200 OK`
  ```json
  {
    "items": [
      {
        "runId": "run-5678",
        "stageId": "product-spec",
        "status": "completed",
        "prompt": "输出产品规格草案",
        "result": {
          "status": "completed",
          "summary": "...",
          "changedFiles": []
        }
      }
    ],
    "page": 1,
    "pageSize": 50,
    "total": 4197,
    "hasMore": true
  }
  ```
- **Notes:**
  - 列表接口现在只返回 list view 所需字段。
  - `taskEnvelope`、顶层 `promptResolution`、完整 `sessionProvenance` 等重字段不再出现在列表里。
  - 如需完整 envelope / artifact / review 细节，请读取 `GET /api/agent-runs/:id`。

#### Get Run Details
- **URL:** `GET /api/agent-runs/:id`
- **Response:** `200 OK` Returns the full `AgentRunState`.
  ```json
  {
    "runId": "run-5678",
    "status": "completed",
    "artifactDir": "demolong/projects/proj-1234/runs/run-5678/",
    "result": {
      "status": "completed",
      "summary": "...",
      "changedFiles": []
    }
  }
  ```

#### Cancel a Run
- **URL:** `DELETE /api/agent-runs/:id`
- **Response:** `200 OK`
  ```json
  {
    "status": "cancelled"
  }
  ```

### 2.1 Company Kernel

Company Kernel 是 run 执行后的学习、经营与自增长收口层。CLI 可以读取 RunCapsule / MemoryCandidate，也可以读取经营信号、议程、预算 gate、熔断器和 GrowthProposal。分离部署时这些接口由 web 代理到 `api/control-plane` 服务。

#### List Run Capsules
- **URL:** `GET /api/company/run-capsules`
- **Query Parameters:** `workspaceUri`, `projectId`, `status`, `providerId`, `page`, `pageSize`
- **Response:** paginated `{ items, page, pageSize, total, hasMore }`

#### Get Run Capsule
- **URL:** `GET /api/company/run-capsules/:runId`
- **Response:** `RunCapsule`
- **Note:** capsule rebuild 会合并既有 WorkingCheckpoint，不覆盖历史 checkpoint。

#### List Memory Candidates
- **URL:** `GET /api/company/memory-candidates`
- **Query Parameters:** `workspaceUri`, `sourceRunId`, `sourceCapsuleId`, `kind`, `status`, `minScore`, `page`, `pageSize`
- **Response:** paginated `{ items, page, pageSize, total, hasMore }`
- **Note:** `candidate` / `pending-review` 才是可审核状态；空证据、高冲突、volatile 候选不会自动晋升。

#### Get Memory Candidate
- **URL:** `GET /api/company/memory-candidates/:id`
- **Response:** `MemoryCandidate`

#### Promote Memory Candidate
- **URL:** `POST /api/company/memory-candidates/:id/promote`
- **Body:** optional `title`, `content`, `category`, `level`
- **Response:** `201 Created`; `rejected/promoted/archived` 等闭合状态返回 `409 Conflict`
  ```json
  { "knowledge": { "id": "knowledge-...", "promotion": { "sourceCandidateId": "..." } } }
  ```

#### Reject Memory Candidate
- **URL:** `POST /api/company/memory-candidates/:id/reject`
- **Body:** `{ "reason": "duplicate or low evidence" }`
- **Response:** `200 OK`; 已 promote 的候选返回 `409 Conflict`
  ```json
  { "candidate": { "id": "...", "status": "rejected" } }
  ```

#### Operating Signals
- **URL:** `GET /api/company/signals`
- **Query Parameters:** `workspaceUri`, `source`, `kind`, `status`, `minScore`, `page`, `pageSize`
- **URL:** `GET /api/company/signals/:id`
- **URL:** `POST /api/company/signals/:id/dismiss`
- **Note:** approval submit / approve / reject / feedback lifecycle is converted into `approval` operating signals and agenda items.

#### Operating Agenda
- **URL:** `GET /api/company/agenda`
- **Query Parameters:** `workspaceUri`, `status`, `priority`, `minScore`, `page`, `pageSize`
- **URL:** `GET /api/company/agenda/:id`
- **URL:** `POST /api/company/agenda/:id/snooze`
- **URL:** `POST /api/company/agenda/:id/dismiss`
- **URL:** `POST /api/company/agenda/:id/dispatch-check` returns `{ decision }` without creating a run
- **URL:** `POST /api/company/agenda/:id/dispatch` validates target workspace before reserving budget, applies budget gate, creates a queued prompt run when allowed, attaches the reserved ledger to `runId`, and returns `{ decision, ledger, item, run }`. Terminal run status later commits or releases the reservation.

#### Operating Day
- **URL:** `GET /api/company/operating-day`
- **Query Parameters:** `date`, `timezone`, `workspaceUri`, `limit`
- **Response:** `CompanyOperatingDay` with `agenda`, `activeSignals`, `departmentStates`, `activeRuns`, `completedRuns`, `memoryCandidateIds`

#### Budget & Circuit Breakers
- **URL:** `GET /api/company/budget/policies`
- **URL:** `GET|PUT /api/company/budget/policies/:id`
- **URL:** `GET /api/company/budget/ledger`
- **URL:** `GET /api/company/circuit-breakers`
- **URL:** `POST /api/company/circuit-breakers/:id/reset`
- **Note:** ledger `decision` can be `reserved`, `committed`, `released`, `blocked`, or `skipped`; scheduler budget/circuit blocks use `skipped` and do not create runs. Growth proposal generate/evaluate also writes `growth-proposal` scope ledger entries.
- **Note:** real terminal run failures update department, scheduler-job, provider, and workflow circuit breakers; successful terminal runs reset the matching breakers.

#### Growth Proposals
- **URL:** `GET /api/company/growth/proposals`
- **URL:** `POST /api/company/growth/proposals/generate`
- **URL:** `GET /api/company/growth/proposals/:id`
- **URL:** `POST /api/company/growth/proposals/:id/evaluate`
- **URL:** `POST /api/company/growth/proposals/:id/approve`
- **URL:** `POST /api/company/growth/proposals/:id/reject`
- **URL:** `POST /api/company/growth/proposals/:id/dry-run`
- **URL:** `POST /api/company/growth/proposals/:id/publish`
- **URL:** `GET|POST /api/company/growth/observations`
- **Note:** proposal `kind` can be `sop`, `workflow`, `skill`, `script`, or `rule`. Generate/evaluate is budgeted. Public publish no longer accepts force mode; high-risk proposals require approval, and `script` proposals additionally require a passed dry-run. Published workflow/skill proposals can be injected into later Prompt Mode execution resolution. Three or more repeated successful RunCapsules can generate a `workflow` proposal; repeated automation/script signals can generate `script`, and repeated operating constraints can generate `rule`.

#### Company Loops

- **URL:** `GET /api/company/loops/policies`
- **URL:** `GET|PUT /api/company/loops/policies/:id`
- **URL:** `GET /api/company/loops/runs`
- **URL:** `GET /api/company/loops/runs/:id`
- **URL:** `POST /api/company/loops/run-now`
- **URL:** `GET /api/company/loops/digests`
- **URL:** `GET /api/company/loops/digests/:id`
- **URL:** `POST /api/company/loops/runs/:id/retry`
- **Note:** `run-now` 执行 daily/weekly/growth/risk review，只选择 Top-N agenda，dispatch 仍经过 budget/circuit gate，policy disabled 时返回 skipped。scheduler 内置 daily/weekly company-loop 使用 cron job，不创建 5s interval，并从 `CompanyLoopPolicy` 读取 cadence / timezone / enabled。loop run 的 `metadata.skippedAgenda` 保存 skipped 原因；`notificationChannels` 会产出 web/email/webhook channel-specific notification id。

#### Guarded Self Improvement

- **URL:** `GET|POST /api/company/self-improvement/signals`
- **URL:** `GET /api/company/self-improvement/proposals`
- **URL:** `POST /api/company/self-improvement/proposals/generate`
- **URL:** `GET /api/company/self-improvement/proposals/:id`
- **URL:** `POST /api/company/self-improvement/proposals/:id/evaluate`
- **URL:** `POST /api/company/self-improvement/proposals/:id/approve`
- **URL:** `POST /api/company/self-improvement/proposals/:id/reject`
- **URL:** `POST /api/company/self-improvement/proposals/:id/attach-test-evidence`
- **URL:** `POST /api/company/self-improvement/proposals/:id/observe`
- **Note:** high/critical proposal 不能通过 passed test evidence 绕过 approval；`approve` 会写入持久 approval metadata，已审批 proposal 可在 failed evidence 后通过最新 passed evidence 恢复到 `ready-to-merge`。
- **Note:** high/critical protected-core proposal 会创建 approval request；第一版没有 auto merge / auto push / auto deploy API。

### 3. Templates & Pipelines

#### List Available Templates
- **URL:** `GET /api/pipelines`
- **Response:** `200 OK` Array of `TemplateDefinition` objects. Each template contains inline stage / node execution config.
- **Example Response:**
  ```json
  [
    {
      "id": "development-template-1",
      "kind": "template",
      "title": "完整产研链",
      "stages": {
        "product-spec": { "title": "产品规格", "executionMode": "review-loop", "roleIds": ["pm-author", "product-lead-reviewer"] }
      },
      "pipeline": [
        { "stageId": "product-spec", "title": "产品规格" },
        { "stageId": "architecture-advisory", "title": "架构顾问", "stageType": "normal" },
        { "stageId": "autonomous-dev-pilot", "title": "自主开发（含交付审核）", "stageType": "normal" }
      ]
    }
  ]
  ```

### Run Intervention

#### Intervene on a Run
- **URL:** `POST /api/agent-runs/:runId/intervene`
- **Request Body (JSON):**
  - `action` (String, required): `"nudge"`, `"retry"`, `"restart_role"`, `"cancel"`, or `"evaluate"`.
    - `nudge`: Sends a follow-up message to the existing child conversation for a stale-active run.
    - `retry`: Compatibility alias for `restart_role`.
    - `restart_role`: Creates a fresh child conversation for just the target role, re-executing it within the same Run.
    - `cancel`: Cancels the canonical Run.
    - `evaluate`: Triggers an evaluation of the current run state.
  - `prompt` (String, optional): Custom prompt for the intervention. If omitted, a sensible default is generated.
  - `roleId` (String, optional): Target role to intervene on. Defaults to the last role in the run.
- **Response:** `202 Accepted` — intervention runs asynchronously. `cancel` also uses the same route and returns `202`.
  ```json
  { "status": "intervening", "action": "nudge", "runId": "..." }
  ```
- **Conflict Response:** `409 Conflict` when another intervention is already active for the same run.
- **Important:** `retry` is a compatibility alias. New callers should prefer `restart_role`.
- **Prompt-mode note:** `executorKind = prompt` 的 run 目前支持：
  - `cancel`
  - `evaluate`
  其它 intervention 仍会被拒绝。
- **Example:**
  ```bash
  # Nudge a critic that forgot DECISION: marker
  curl -X POST http://localhost:3000/api/agent-runs/<runId>/intervene \
    -H "Content-Type: application/json" \
    -d '{ "action": "nudge" }'

  # Restart the critic role with a fresh conversation
  curl -X POST http://localhost:3000/api/agent-runs/<runId>/intervene \
    -H "Content-Type: application/json" \
    -d '{ "action": "restart_role", "roleId": "ux-review-critic" }'

  # Cancel the canonical run
  curl -X POST http://localhost:3000/api/agent-runs/<runId>/intervene \
    -H "Content-Type: application/json" \
    -d '{ "action": "cancel" }'
  ```

### 4. Utility & Governance

#### Check Write Scope Conflicts
- **URL:** `POST /api/scope-check`
- **Request Body (JSON):**
  - `packages` (Array of objects, required): Array where each object includes `taskId` and `writeScope` (array of structural path entries).
- **Example Body:**
  ```json
  {
    "packages": [
      {
        "taskId": "task-A",
        "writeScope": [ { "path": "src/auth/", "type": "directory" } ]
      },
      {
        "taskId": "task-B",
        "writeScope": [ { "path": "src/auth/login.ts", "type": "file" } ]
      }
    ]
  }
  ```
- **Response:** `200 OK`
  ```json
  {
    "hasConflicts": true,
    "conflicts": [ ... ],
    "checkedPackages": 2
  }
  ```

### 5. CEO Command

#### Send CEO Command
- **URL:** `POST /api/ceo/command`
- **Description:** CEO 自然语言命令入口。当前兼容层支持状态查询、自然语言定时任务创建，以及“先创建 `Ad-hoc Project` 再执行”的即时部门任务。
- **Notes:** 解析阶段会动态读取 CEO workspace 里的 `ceo-playbook.md` 和 `ceo-scheduler-playbook.md` 作为决策规则。
- **Request Body (JSON):**
  - `command` (String, required): CEO 的自然语言命令
  - `model` (String, optional): 可选模型 ID
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "action": "create_scheduler_job",
    "message": "已创建定时任务“后端团队 定时任务 · 工作日 09:00”。触发时会自动创建一个 Ad-hoc 项目，并派发模板「Universal Batch Research (Fan-out)」。下一次执行时间：2026-04-09T01:00:00.000Z。当前系统共有 3 个定时任务。",
    "jobId": "abc123",
    "nextRunAt": "2026-04-09T01:00:00.000Z"
  }
  ```

- **即时部门任务响应示例：**
  ```json
  {
    "success": true,
    "action": "create_project",
    "projectId": "proj-1234",
    "runId": "run-5678",
    "message": "已创建 Ad-hoc Project，并发起即时执行。"
  }
  ```

#### Dispatch Run With Execution Profile
- **URL:** `POST /api/agent-runs`
- **Description:** 统一执行入口，支持通过 `executionProfile` 分流。
- **Request Body (JSON):**
  - `workspace` (String, required)
  - `prompt` (String, optional for template-backed profiles)
  - `executionProfile` (Object, optional)

- **Supported `executionProfile.kind`:**
  - `workflow-run`
    - optional `workflowRef`
    - optional `skillHints`
  - `dag-orchestration`
    - `templateId`
    - optional `stageId`

- **Current limitation:**
  - `review-flow` 现在可作为 direct execution profile 使用，但必须提供 template-backed target（`templateId`，可选 `stageId`）。

#### Get CEO Profile
- **URL:** `GET /api/ceo/profile`
- **Response:** `200 OK` `CEOProfile` object.

#### Update CEO Profile
- **URL:** `PATCH /api/ceo/profile`
- **Request Body (JSON):**
  - 任意 `CEOProfile` 可更新字段的局部 patch，例如 `priorities`、`activeFocus`、`communicationStyle`

#### Append CEO Feedback
- **URL:** `POST /api/ceo/profile/feedback`
- **Request Body (JSON):**
  - `content` (String, required): 用户反馈内容
  - `type` (String, optional): `correction` / `approval` / `rejection` / `preference`

#### Get CEO Routine Summary
- **URL:** `GET /api/ceo/routine`
- **Response:** `200 OK` Object with:
  - `generatedAt`
  - `overview`
  - `activeProjects`
  - `pendingApprovals`
  - `activeSchedulers`
  - `recentKnowledge`
  - `highlights`
  - `actions`
- **Action Contract:** each `actions[]` item includes `id`, `type`, `status`, `priority`, `meta`, `count`, and a `target` object. `target.kind` maps to `approvals`, `project`, `scheduler`, `knowledge`, or `ceo-focus`; optional target IDs include `requestId`, `projectId`, `jobId`, `knowledgeId`, and `workspaceUri`.

#### Get CEO Events
- **URL:** `GET /api/ceo/events?limit=20`
- **Response:** `200 OK` `{ events: CEOEventRecord[] }`

#### Get Management Overview
- **URL:** `GET /api/management/overview`
- **Response:** `200 OK` organization-level overview with:
  - `activeProjects`
  - `completedProjects`
  - `failedProjects`
  - `blockedProjects`
  - `pendingApprovals`
  - `activeSchedulers`
  - `schedulerRuntime`
  - `recentKnowledge`
  - `metrics`
- **Scheduler Runtime:** `schedulerRuntime.status` is one of `running`, `idle`, `disabled`, or `stalled`. Use it to tell whether cron scheduling is actually active instead of relying only on `activeSchedulers`.

#### Get Department Management Overview
- **URL:** `GET /api/management/overview?workspace=<workspace_uri>`
- **Response:** `200 OK` department-level overview plus:
  - `workspaceUri`
  - `workflowHitRate`
  - `throughput30d`

### 6. Approval

#### List Approval Requests
- **URL:** `GET /api/approval`
- **Query Parameters (Optional):**
  - `status`: `pending` / `approved` / `rejected` / `feedback`
  - `workspace`: workspace URI
  - `type`: approval type
  - `summary`: set `true` to include status counts
- **Response:** `200 OK` `{ requests: ApprovalRequest[], summary?: ApprovalSummary }`.

#### Submit Approval Request
- **URL:** `POST /api/approval`
- **Request Body (JSON):**
  - `type` (String, required): `token_increase` / `tool_access` / `provider_change` / `scope_extension` / `pipeline_approval` / `proposal_publish` / `other`
  - `workspace` (String, required): 发起部门的 workspace URI
  - `title` (String, required): 审批标题
  - `description` (String, required): 详细描述
  - `urgency` (String, optional): `low` / `normal` / `high` / `critical`
  - `runId` (String, optional): 关联的 Run ID

#### Get Approval Details
- **URL:** `GET /api/approval/:id`
- **Response:** `200 OK` Full `ApprovalRequest` object.

#### Update Approval Status
- **URL:** `PATCH /api/approval/:id`
- **Request Body (JSON):**
  - `action` (String, required): `approved` / `rejected` / `feedback`
  - `message` (String, optional): CEO 回复消息

#### Submit Approval Feedback
- **URL:** `GET|POST /api/approval/:id/feedback`
- **Query Parameters:**
  - `action` (String, required): `approve` / `reject` / `feedback`
  - `token` (String, required): HMAC token generated by the approval notification channel
  - `message` (String, optional): 反馈内容

#### Subscribe Approval Events
- **URL:** `GET /api/approval/events`
- **Split mode owner:** `control-plane`
- **Response:** `text/event-stream`
- **Events:**
  - `approval_request`: new approval request notification
  - `approval_response`: CEO approved / rejected / replied
- **Notes:** Web UI uses this SSE stream to refresh the approval inbox without polling every interaction. The stream replays recent events so reconnects do not miss the latest approval state.

### 7. Departments

#### Get Department Config
- **URL:** `GET /api/departments?workspace=<file_uri>`
- **Description:** 获取部门配置。workspace 参数为 `file://` URI，并以 OPC workspace catalog 为准。
- **Split mode owner:** `control-plane`
- **Response:** `200 OK` `DepartmentConfig` object.
- **Error:** `403` if workspace is not known to OPC workspace catalog.

#### Update Department Config
- **URL:** `PUT /api/departments?workspace=<file_uri>`
- **Request Body:** Full `DepartmentConfig` JSON object.
- **Note:** 该接口现在只保存 `.department/config.json`，不会再隐式同步所有 IDE mirror。响应会返回 `{ ok: true, syncPending: true }`。
- **Split mode owner:** `control-plane`

#### Sync Department State
- **URL:** `POST /api/departments/sync?workspace=<file_uri>&target=<all|antigravity|codex|claude-code|cursor>`
- **Description:** 显式同步部门配置到对应 IDE mirror。
- **Split mode owner:** `control-plane`

#### Get Department Digest
- **URL:** `GET /api/departments/digest?workspace=<file_uri>&date=<YYYY-MM-DD>&period=<day|week|month>`

#### Get Department Quota
- **URL:** `GET /api/departments/quota?workspace=<file_uri>`

#### Read/Write Department Memory
- **URL:** `GET /api/departments/memory?workspace=<file_uri>` / `POST /api/departments/memory?workspace=<file_uri>&category=<knowledge|decisions|patterns>`

### 7.1 Workspaces

#### List Known Workspaces
- **URL:** `GET /api/workspaces`
- **Description:** 返回 OPC workspace catalog 中的所有已知 workspace。来源包括手动导入、Antigravity recent 导入和 CEO bootstrap。
- **Split mode owner:** `control-plane`

#### Import Workspace
- **URL:** `POST /api/workspaces/import`
- **Request Body (JSON):**
  - `workspace` (String, required): Absolute path or `file://` URI
- **Description:** 仅导入到 OPC catalog，不启动 Antigravity。Tauri 桌面壳的新建部门会先用原生目录选择器拿到本地路径，再调用此接口。
- **Split mode owner:** `control-plane`

#### Launch Workspace in Antigravity
- **URL:** `POST /api/workspaces/launch`
- **Description:** 先注册到 OPC catalog，再打开 Antigravity 并触发 language_server 启动。
- **Split mode owner:** `runtime`

#### Knowledge Assets
- **URL:** `GET /api/knowledge`
- **Description:** 列出知识资产，支持：
  - `workspace`
  - `category`
  - `limit`
- **Response:** `200 OK` Array of `KnowledgeItem`

#### Knowledge Asset Detail
- **URL:** `GET /api/knowledge/:id`
- **Response:** `200 OK` `KnowledgeDetail`

#### Update Knowledge Asset
- **URL:** `PUT /api/knowledge/:id`

#### Delete Knowledge Asset
- **URL:** `DELETE /api/knowledge/:id`

#### Read/Write Knowledge Artifact
- **URL:** `GET /api/knowledge/:id/artifacts/:path`
- **URL:** `PUT /api/knowledge/:id/artifacts/:path`

### 7.5 Evolution

#### List Evolution Proposals
- **URL:** `GET /api/evolution/proposals`
- **Description:** 返回 evolution proposals，支持：
  - `workspace`
  - `kind`
  - `status`
  - `observe`

#### Generate Evolution Proposals
- **URL:** `POST /api/evolution/proposals/generate`
- **Request Body (JSON):**
  - `workspaceUri` (String, optional): 按部门范围生成
  - `limit` (Number, optional): 本次最大生成数

#### Get Evolution Proposal Detail
- **URL:** `GET /api/evolution/proposals/:id`

#### Evaluate Evolution Proposal
- **URL:** `POST /api/evolution/proposals/:id/evaluate`

#### Request Evolution Publish
- **URL:** `POST /api/evolution/proposals/:id/publish`
- **Description:** 创建发布审批，请求通过后由 approval callback 真正发布 workflow/skill。

#### Refresh Evolution Observe
- **URL:** `POST /api/evolution/proposals/:id/observe`

### 8. Scheduler

#### List Scheduled Jobs
- **URL:** `GET /api/scheduler/jobs`
- **Response:** `200 OK` Paginated envelope of `ScheduledJob` objects.
- `cron` job 现在支持可选 `timeZone`（IANA 时区，例如 `Asia/Shanghai`）。
- `GET /api/scheduler/jobs` / `GET /api/scheduler/jobs/:id` 会按 SQLite 主存储刷新，不再依赖单进程内存态；已过触发点但尚未执行的任务会把 `nextRunAt` 标为当前时间。

#### Scheduler Action Kinds
- `dispatch-pipeline`
- `dispatch-prompt`
- `dispatch-execution-profile`
- `health-check`
- `create-project`

默认同设备部署中，`opc-api` 负责 cron scheduler 循环；`web` 只做代理和页面，不执行定时任务。`AG_ENABLE_SCHEDULER=0` 可关闭 cron，`AG_ENABLE_SCHEDULER_COMPANIONS=1` 才会额外启动 fan-out / approval / CEO event consumer 等恢复类后台。

`dispatch-execution-profile` 当前支持：
- `workflow-run`
- `review-flow`
- `dag-orchestration`

#### Create Scheduled Job
- **URL:** `POST /api/scheduler/jobs`
- **Request Body (JSON):**
  - `name` (String, required): 任务名称
  - `type` (String, required): `cron` / `interval` / `once`
  - `cronExpression` (String, conditional): cron 表达式
  - `timeZone` (String, optional): cron 时区；留空则按服务端本地时区解释
  - `action` (Object, required): `{ kind: 'dispatch-pipeline' | 'health-check' | 'create-project', ... }`
  - `enabled` (Boolean, optional): 默认 `true`
  - `departmentWorkspaceUri` (String, optional): 关联部门 workspace
  - `action.kind = "dispatch-pipeline"` 时使用 `templateId`，可选 `stageId` 指定非入口阶段
  - `action.kind = "create-project"` 时使用 `departmentWorkspaceUri` + `opcAction.goal`；如需触发后自动启动 run，写入 `opcAction.templateId`

#### Get Scheduled Job
- **URL:** `GET /api/scheduler/jobs/:id`

#### Update Scheduled Job
- **URL:** `PATCH /api/scheduler/jobs/:id`

#### Delete Scheduled Job
- **URL:** `DELETE /api/scheduler/jobs/:id`
- **说明:** 删除现在会同步移除 SQLite `scheduled_jobs` 行，不再只删当前进程内存态。

#### Trigger Scheduled Job
- **URL:** `POST /api/scheduler/jobs/:id/trigger`
- **Description:** 立即触发一次执行（不影响 cron 下次触发）。触发前会经过 Company Kernel budget gate；被 budget/circuit 拦截时返回 `status = skipped`，不会创建 run。

### 9. Deliverables

#### List Deliverables
- **URL:** `GET /api/projects/:id/deliverables`
- **Query Parameters (Optional):**
  - `page` / `pageSize`: 分页参数
- **Response:** `200 OK` Paginated deliverable envelope.
- **Notes:**
  - 读路径已经切到 SQLite 主库。
  - 返回值同时包含手工 deliverables 与由 run `outputArtifacts` 自动同步出来的交付物。
  - 自动同步项会额外携带可选字段 `sourceRunId`。

#### Add Deliverable
- **URL:** `POST /api/projects/:id/deliverables`
- **Request Body (JSON):**
  - `stageId` (String, required): 所属 Stage ID
  - `type` (String, required): `document` / `code` / `data` / `review`
  - `title` (String, required): 交付物标题
  - `artifactPath` (String, optional): 产物文件路径

### 10. Operations

#### Audit Log
- **URL:** `GET /api/operations/audit`
- **Query Parameters (Optional):**
  - `kind` / `projectId` / `since` / `until`
  - `page` / `pageSize`
- **Description:** 获取系统审计事件日志（分页 envelope）。

#### System Logs
- **URL:** `GET /api/logs`
- **Description:** 获取系统运行日志。

## Task Lifecycle & Workflow

To programmatically drive tasks using the V3.5 multi-agent system, follow a state-machine lifecycle:

1. **Create a Project:** First, execute `POST /api/projects` to initialize a workspace scope. You will get a `projectId` which ensures unified artifact routing.
2. **Dispatch Runs within the Project:** Fire off an initial task by `POST /api/agent-runs` using `templateId: "development-template-1"` plus `stageId: "product-spec"`, attaching the `projectId`.
3. **Poll Run Status:** Periodically (e.g., every 5-10 seconds) call `GET /api/agent-runs/:id` to check the `status`. Note: Active states are `queued`, `starting`, `running`. When it transitions to one of the terminal status codes (e.g. `completed` or `failed`), stop polling.
4. **Read Results:** Upon a `completed` status:
   - For legacy or simpler tasks, read `result.json` located dynamically parsing the `artifactDir` returned in the task details.
   - You can also read `result` property inside the payload of `GET /api/agent-runs/:id`, which includes `status`, `summary`, and `changedFiles`.
5. **Conflict Governance (Multi-WP):** Before dispatching multiple concurrent runs (parallel Dev Pilot teams), dry-run their targeted writes against `POST /api/scope-check` with their parsed `writeScope` arrays.

## Status Codes Reference
The `RunStatus` type goes through the following states:
- **`queued`**: Run created, waiting to be picked up.
- **`starting`**: Environment preparing.
- **`running`**: Actively executing iterations.
- **`completed`**: Finished successfully.
- **`blocked`**: Needs user intervention or hit limits.
- **`failed`**: Encountered an unrecoverable error.
- **`cancelled`**: Terminated by user or API request.
- **`timeout`**: Reached max duration limit.

## Usage Script Example

Here is a full example illustrating an end-to-end process from spec to architecture to autonomous-dev-pilot using `curl`:

```bash
#!/bin/bash
API_BASE="http://localhost:3000/api"
WORKSPACE="/absolute/path/to/project"

# 1. Create Project
PROJECT_RESP=$(curl -s -X POST $API_BASE/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "Auth Integration", "goal": "Add OAuth support", "workspace": "'$WORKSPACE'"}')
PROJECT_ID=$(echo $PROJECT_RESP | jq -r .projectId)
echo "Created Project: $PROJECT_ID"

# 2. Dispatch Spec Run
SPEC_RESP=$(curl -s -X POST $API_BASE/agent-runs \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "development-template-1",
    "stageId": "product-spec",
    "workspace": "'$WORKSPACE'",
    "projectId": "'$PROJECT_ID'",
    "prompt": "Specify OAuth 2.0 implementation requirements"
  }')
SPEC_RUN_ID=$(echo $SPEC_RESP | jq -r .runId)
echo "Dispatched Spec Run: $SPEC_RUN_ID"

# Wait for Spec to Complete...
# (In scripts, implement a loop here polling GET /agent-runs/$SPEC_RUN_ID until status='\''completed'\'' and reviewOutcome='\''approved'\'')

# 3. Chaining to Architecture Check
ARCH_RESP=$(curl -s -X POST $API_BASE/agent-runs \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "development-template-1",
    "stageId": "architecture-advisory",
    "workspace": "'$WORKSPACE'",
    "projectId": "'$PROJECT_ID'",
    "sourceRunIds": ["'$SPEC_RUN_ID'"],
    "prompt": "Design system integration plan based on the specs"
  }')
ARCH_RUN_ID=$(echo $ARCH_RESP | jq -r .runId)

# ...Wait for Arch Run ID...

# 4. Conflict Check (Assuming extracted scopes)
curl -s -X POST $API_BASE/scope-check \
  -H "Content-Type: application/json" \
  -d '{
    "packages": [
      { "taskId": "WP-1", "writeScope": [{"path": "src/auth/", "type": "directory"}] },
      { "taskId": "WP-2", "writeScope": [{"path": "src/ui/", "type": "directory"}] }
    ]
  }'

# 5. Dispatch Template Pipeline
DEV_RESP=$(curl -s -X POST $API_BASE/agent-runs \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "development-template-1",
    "workspace": "'$WORKSPACE'",
    "projectId": "'$PROJECT_ID'",
    "sourceRunIds": ["'$ARCH_RUN_ID'"],
    "taskEnvelope": {
      "goal": "Implement authentication frontend UI"
    }
  }')
echo "Dispatched Pipeline Run: $(echo $DEV_RESP | jq -r .runId)"

# Note: By passing templateId without a stageId, the system
# automatically starts at the entry stage. Since development-template-1
# uses pipeline autoTrigger rules, it will execute product-spec -> 
# architecture-advisory -> autonomous-dev-pilot sequentially.
```

## Provider Credentials API

The Settings UI now relies on these endpoints to drive the provider matrix:

```bash
# Read current provider routing config
curl -s http://localhost:3000/api/ai-config | jq

# Read key presence + local install/login status
curl -s http://localhost:3000/api/api-keys | jq

# Save provider routing config
curl -sX PUT http://localhost:3000/api/ai-config \
  -H "Content-Type: application/json" \
  -d '{
    "defaultProvider": "claude-api",
    "layers": {
      "executive": { "provider": "antigravity" },
      "management": { "provider": "claude-api" },
      "execution": { "provider": "codex" },
      "utility": { "provider": "antigravity" }
    }
  }'

# Save API-backed provider keys
curl -sX PUT http://localhost:3000/api/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "anthropic": "sk-ant-...",
    "openai": "sk-...",
    "gemini": "AIza...",
    "grok": "xai-..."
  }'

# Test a custom OpenAI-compatible endpoint
curl -sX POST http://localhost:3000/api/api-keys/test \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "custom",
    "apiKey": "sk-...",
    "baseUrl": "https://api.deepseek.com"
  }'
```

Supported test providers:
- `anthropic`
- `openai` / `openai-api`
- `gemini` / `gemini-api`
- `grok` / `grok-api`
- `custom`

Provider routing guardrails:
- `PUT /api/ai-config` now rejects any unconfigured provider with `400`.
- Settings `Provider 配置` / `Scene 覆盖` 下拉只显示当前真实可用的 provider。
- Existing invalid configs remain visible as `(...未配置)` placeholders until the user switches them to a valid provider and saves.
