# Antigravity Agent System - CLI & API Reference

## Overview
This document provides reference for the REST API exposed by the V3.5 Multi-Agent system. These APIs can be used by external CLI tools, CI/CD pipelines, or other systems to orchestrate and manage autonomous agent tasks.
The API runs on port 3000 by default.

> V6.1 Stage-Centric Migration:
> Public dispatch now uses `templateId + stageId`.
> Persisted templates are inline-only (`pipeline[]` / `graphPipeline.nodes[]` carry execution config directly).
> `groupId`, `/api/agent-groups`, and scheduler `dispatch-group` are removed from the public contract.

## API Endpoints

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
- **Response:** `200 OK` Array of Project objects.

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
- **Request Body (JSON):**
  - `templateId` (String, required): Template ID. Also supports `pipelineId` as an alias.
  - `stageId` (String, optional): Target stage ID inside the template. If omitted, the API dispatches the template entry stage.
  - `workspace` (String, required): Absolute path to the workspace.
  - `prompt` (String): Free-text prompt describing the goal (either `prompt` or `taskEnvelope.goal` is required).
  - `taskEnvelope` (Object): Structured task data (`goal`, `inputArtifacts`, etc.).
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
    "templateOverrides": { "maxConcurrency": 5 },
    "conversationMode": "shared"
  }
  ```
- **Response:** `201 Created`
  ```json
  {
    "runId": "run-5678",
    "status": "starting"
  }
  ```

#### List Runs
- **URL:** `GET /api/agent-runs`
- **Query Parameters (Optional):**
  - `status`: Filter by status (`queued`, `completed`, etc.)
  - `stageId`: Filter by stage (`product-spec`, `planning`, etc.)
  - `projectId`: Filter by project association
  - `reviewOutcome`: Filter by outcome (`approved`, `rejected`, etc.)
- **Response:** `200 OK` Array of `AgentRunState` objects.

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
- **Description:** CEO 自然语言命令入口。当前兼容层主要支持状态查询与自然语言定时任务创建。
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

### 6. Approval

#### List Approval Requests
- **URL:** `GET /api/approval`
- **Response:** `200 OK` Array of `ApprovalRequest` objects.

#### Submit Approval Request
- **URL:** `POST /api/approval`
- **Request Body (JSON):**
  - `type` (String, required): `token_increase` / `tool_access` / `provider_change` / `scope_extension` / `pipeline_approval` / `other`
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
- **URL:** `POST /api/approval/:id/feedback`
- **Request Body (JSON):**
  - `message` (String, required): 反馈内容

### 7. Departments

#### Get Department Config
- **URL:** `GET /api/departments?workspace=<absolute_path>`
- **Description:** 获取部门配置。workspace 参数为绝对路径（不含 `file://`）。
- **Response:** `200 OK` `DepartmentConfig` object.
- **Error:** `403` if workspace is not registered (path traversal protection).

#### Update Department Config
- **URL:** `PUT /api/departments?workspace=<absolute_path>`
- **Request Body:** Full `DepartmentConfig` JSON object.

#### Sync Department State
- **URL:** `POST /api/departments/sync`

#### Get Department Digest
- **URL:** `GET /api/departments/digest`

#### Get Department Quota
- **URL:** `GET /api/departments/quota`

#### Read/Write Department Memory
- **URL:** `GET /api/departments/memory` / `POST /api/departments/memory`

### 8. Scheduler

#### List Scheduled Jobs
- **URL:** `GET /api/scheduler/jobs`
- **Response:** `200 OK` Array of `ScheduledJob` objects (including `lastRunAt`, `lastRunResult`, `enabled`).

#### Create Scheduled Job
- **URL:** `POST /api/scheduler/jobs`
- **Request Body (JSON):**
  - `name` (String, required): 任务名称
  - `type` (String, required): `cron` / `interval` / `once`
  - `cronExpression` (String, conditional): cron 表达式
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

#### Trigger Scheduled Job
- **URL:** `POST /api/scheduler/jobs/:id/trigger`
- **Description:** 立即触发一次执行（不影响 cron 下次触发）。

### 9. Deliverables

#### List Deliverables
- **URL:** `GET /api/projects/:id/deliverables`
- **Response:** `200 OK` Array of deliverable objects.

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
- **Description:** 获取系统审计事件日志。

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
