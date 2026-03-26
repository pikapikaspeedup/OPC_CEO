# Antigravity Agent System - CLI & API Reference

## Overview
This document provides reference for the REST API exposed by the V3.5 Multi-Agent system. These APIs can be used by external CLI tools, CI/CD pipelines, or other systems to orchestrate and manage autonomous agent tasks.
The API runs on port 3000 by default.

## API Endpoints

### 1. Projects

#### Create a Project
- **URL:** `POST /api/projects`
- **Request Body (JSON):**
  - `name` (String, required): Project name
  - `goal` (String, required): Project goal description
  - `workspace` (String, required): Absolute path to the workspace
  - `templateId` (String, optional): Template identification
- **Example Body:**
  ```json
  {
    "name": "Tetris Game",
    "goal": "Build a simple Tetris game in HTML5",
    "workspace": "/Users/darrel/Documents/Games"
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
- **Description:** Resumes a project from its first failed pipeline stage. The project must have a `pipelineState` (i.e., it was created via template dispatch).
- **Request Body (JSON, all optional):**
  - `stageIndex` (number): Target a specific stage. Defaults to the first failed stage.
  - `action` (string): `"redispatch"` (default), `"retry"`, or `"nudge"`.
    - `redispatch`: Creates a brand new Run for the failed stage.
    - `retry`: Retries the failed role within the existing Run (via `interveneRun`).
    - `nudge`: Sends a follow-up prompt to the failed Run's existing conversation.
  - `prompt` (string): Custom prompt for retry/nudge.
- **Response:** `202 Accepted`
  ```json
  { "status": "resuming", "action": "redispatch", "stageIndex": 0, "groupId": "ux-review", "runId": "..." }
  ```
- **Conflict Response:** `409 Conflict` when a retry/nudge intervention is already active for the target run.
- **Example:**
  ```bash
  # Resume from first failed stage (default: redispatch)
  curl -X POST http://localhost:3000/api/projects/<projectId>/resume

  # Retry the critic role in the failed stage
  curl -X POST http://localhost:3000/api/projects/<projectId>/resume \
    -H "Content-Type: application/json" \
    -d '{ "action": "retry" }'
  ```

### 2. Agent Runs

#### Dispatch a Run
- **URL:** `POST /api/agent-runs`
- **Request Body (JSON):**
  - `groupId` (String, required if not using `templateId`): The ID of the group to execute (`coding-basic`, `product-spec`, `architecture-advisory`, `autonomous-dev-pilot`, `ux-review`). If omitted but `templateId` is provided, the system automatically resolves to the first stage of the template.
  - `workspace` (String, required): Absolute path to the workspace.
  - `prompt` (String): Free-text prompt describing the goal (either `prompt` or `taskEnvelope.goal` is required).
  - `taskEnvelope` (Object): Structured task data (`goal`, `inputArtifacts`, etc.).
  - `projectId` (String, optional): ID of the project to associate this run with.
  - `sourceRunIds` (Array of Strings, optional): Used to chain dependencies (e.g., provide specs to an architecture run).
  - `templateId` (String, optional): Template ID. If provided without a `groupId`, automatically starts the template pipeline from stage 0. Also supports `pipelineId` as an alias.
  - `pipelineStageIndex` (Number, optional): Current stage index within the pipeline (0-based). Default is 0 when expanding templates.
- **Example Body:**
  ```json
  {
    "groupId": "product-spec",
    "workspace": "/Users/user/workspace",
    "prompt": "Draft spec for user authentication",
    "projectId": "proj-1234"
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
  - `groupId`: Filter by group (`product-spec`, etc.)
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
    "artifactDir": "data/projects/proj-1234/runs/run-5678/",
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
- **Response:** `200 OK` Array of `TemplateDefinition` objects. Each template contains inline `groups` and `pipeline` definitions.
- **Example Response:**
  ```json
  [
    {
      "id": "development-template-1",
      "kind": "template",
      "title": "完整产研链",
      "groups": { "product-spec": {...}, "architecture-advisory": {...}, "autonomous-dev-pilot": {...} },
      "pipeline": [
        { "groupId": "product-spec", "autoTrigger": false },
        { "groupId": "architecture-advisory", "autoTrigger": true, "triggerOn": "approved" },
        { "groupId": "autonomous-dev-pilot", "autoTrigger": true, "triggerOn": "approved" }
      ]
    }
  ]
  ```

### Run Intervention

#### Intervene on a Failed Run
- **URL:** `POST /api/agent-runs/:runId/intervene`
- **Request Body (JSON):**
  - `action` (String, required): `"nudge"` or `"retry"`.
    - `nudge`: Sends a follow-up message to the existing child conversation, prompting the AI to correct its output (e.g., output a missing `DECISION:` marker).
    - `retry`: Creates a fresh child conversation for just the failed role, re-executing it from scratch without re-running upstream roles.
  - `prompt` (String, optional): Custom prompt for the intervention. If omitted, a sensible default is generated.
  - `roleId` (String, optional): Target role to intervene on. Defaults to the last role in the run.
- **Response:** `202 Accepted` — intervention runs asynchronously.
  ```json
  { "status": "intervening", "action": "nudge", "runId": "..." }
  ```
- **Conflict Response:** `409 Conflict` when another intervention is already active for the same run.
- **Example:**
  ```bash
  # Nudge a critic that forgot DECISION: marker
  curl -X POST http://localhost:3000/api/agent-runs/<runId>/intervene \
    -H "Content-Type: application/json" \
    -d '{ "action": "nudge" }'

  # Retry the critic role with a fresh conversation
  curl -X POST http://localhost:3000/api/agent-runs/<runId>/intervene \
    -H "Content-Type: application/json" \
    -d '{ "action": "retry", "roleId": "ux-review-critic" }'
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

## Task Lifecycle & Workflow

To programmatically drive tasks using the V3.5 multi-agent system, follow a state-machine lifecycle:

1. **Create a Project:** First, execute `POST /api/projects` to initialize a workspace scope. You will get a `projectId` which ensures unified artifact routing.
2. **Dispatch Runs within the Project:** Fire off an initial task by `POST /api/agent-runs` using `groupId: "product-spec"`, attaching the `projectId`.
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
    "groupId": "product-spec",
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
    "groupId": "architecture-advisory",
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

# Note: By passing templateId without a groupId, the system
# automatically starts at stage 0. Since development-template-1 
# uses pipeline autoTrigger rules, it will execute product-spec -> 
# architecture-advisory -> autonomous-dev-pilot sequentially.
```
