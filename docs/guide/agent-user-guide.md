# Agent System 使用指南

> Antigravity Gateway Multi-Agent 自治交付系统 (V6)
>
> V6.1 Stage-Centric Migration:
> 对外语义已统一为 `templateId + stageId`。
> 模板持久化改为 inline-only，不再保存 `groups{}`。
> `/api/agent-groups` 与 scheduler `dispatch-group` 已移除；文中剩余 Group 表述如果出现，均指历史概念或角色集合，不再是公共 API 对象。

---

## 目录

1. [快速上手](#1-快速上手)
2. [CEO Agent（核心入口）](#2-ceo-agent核心入口)
3. [Template 模板体系](#3-template-模板体系)
4. [API 参考](#4-api-参考)
5. [部门与组织](#5-部门与组织)
6. [Pipeline 编排详解](#6-pipeline-编排详解)
7. [高级功能](#7-高级功能)
8. [常见问题](#8-常见问题)

---

## 1. 快速上手

### 30 秒上手

启动服务后，可以在 CEO Office 仪表盘里直接输入一句自然语言创建定时任务，或者通过标准 API 进行状态查询与 schedule 创建：

```
每天工作日上午 9 点让超级 IT 研发部创建一个日报任务项目，目标是汇总当前进行中的项目与风险
```

或者用 API：

```bash
curl -X POST http://localhost:3000/api/ceo/command \
  -H "Content-Type: application/json" \
  -d '{"command": "每天工作日上午 9 点让超级 IT 研发部创建一个日报任务项目，目标是汇总当前进行中的项目与风险"}'
```

### 三种使用方式

| 方式 | 入口 | 适合 |
|:-----|:-----|:-----|
| **CEO 调度命令** | CEO Office Dashboard / `POST /api/ceo/command` | 状态查询、自然语言定时任务创建 |
| **手动派发** | 创建项目 → 选模板 → 派发 / `POST /api/agent-runs` | 高级控制，指定模板和参数 |
| **MCP / Workflow** | CEO Workspace Workflow / MCP Tools | 自动化、批量化和外部 AI 调度 |

### 系统架构一句话

```
CEO 命令 → 状态查询 / 解析 schedule intent → 生成 Scheduler Job → 回流到 CEO 事件与审计链路
```

所有 Agent Worker 在**独立隐藏对话**中运行，与主界面完全隔离。任务完成后产出结构化结果 `result.json`。

---

## 2. CEO Agent（核心入口）

### 2.1 工作原理

当前版本中，`/api/ceo/command` 主要承担三类能力：

```
"公司状态如何"
  └─ 汇总当前项目状态

"让 AI情报工作室提炼今天的 AI 大事件并上报"
  └─ 先创建 Ad-hoc Project → 再派发 template run 或 prompt run

"每天工作日上午 9 点让市场部创建一个日报任务项目"
  └─ 解析 schedule intent → 创建 Scheduler Job
```

说明：

- `/api/ceo/command` 的决策层现在会动态加载 CEO workspace 中的 `ceo-playbook.md` 和 `ceo-scheduler-playbook.md`
- 也就是说，它不再完全依赖 TS 手写规则，而是由 playbook 驱动 LLM 解析，再由后端执行
- 当 LLM / playbook 解析不可用时，后端不再用 regex fallback 自动决定部门、`Template` 或 `Prompt`；只保留状态查询 fallback，其余场景会明确返回 `report_to_human`

### 2.2 CEO 命令 API

```bash
POST /api/ceo/command
Content-Type: application/json

{
  "command": "每天工作日上午 9 点让研发部创建一个日报任务项目，目标是汇总当前进行中的项目与风险",
  "model": "MODEL_PLACEHOLDER_M47"
}
```

**返回值**：

```json
{
  "success": true,
  "action": "create_scheduler_job",
  "message": "已创建定时任务“研发部 定时任务 · 工作日 09:00”。触发时会自动创建一个 Ad-hoc 项目，并派发模板「Universal Batch Research (Fan-out)」。下一次执行时间：2026-04-09T01:00:00.000Z。当前系统共有 3 个定时任务。",
  "jobId": "xxx",
  "nextRunAt": "2026-04-09T01:00:00.000Z"
}
```

### 2.3 CEO 支持的操作

| Action | 触发示例 | 说明 |
|:-------|:---------|:-----|
| `info` | "公司状态如何" | 汇总当前项目状态 |
| `create_project` | "让 AI 情报工作室分析最近一周的关键信号" | 先创建一个 `Ad-hoc Project`，再在其中发起即时执行 |
| `create_scheduler_job` | "每天 9 点让研发部创建一个日报任务项目" | 创建定时任务 |
| `needs_decision` | 目标部门 / 项目 / 模板有歧义时 | 返回建议列表让 CEO 进一步澄清 |
| `report_to_human` | 超出当前兼容层支持范围 | 提示转到 CEO Office 会话或手动派发 |

### 2.4 CEO 调度意图映射

当前 `/api/ceo/command` 的业务路由原则是：

1. **部门分配**
2. **`dispatch-pipeline / dispatch-prompt / create-project` 的选择**
3. **是否附带 `templateId`**

都应由 CEO playbook + scheduler playbook 驱动的 LLM 结构化结果来决定，而不是由 TS fallback 再猜一次。

如果这是 `create-project` 类调度，系统会在创建 job 时直接写入最终选中的 `opcAction.templateId`；后续触发时不再重新猜模板。

周期表达默认映射：

1. `每天 9 点` → `0 9 * * *`
2. `工作日 9 点` → `0 9 * * 1-5`
3. `每周一 10 点` → `0 10 * * 1`
4. `明天上午 9 点` → `once + scheduledAt`

---

## 3. Template 模板体系

### 3.1 核心概念

**Template = 完整的解决方案包**，定义了：

| 组成 | 说明 |
|:-----|:-----|
| `pipeline` stages / `graphPipeline` nodes | 每个 stage/node 直接内联执行配置（`executionMode`、`roles`、`sourceContract`） |
| `pipeline` / `graphPipeline` | 执行顺序（线性 or DAG 图） |
| `format` | `pipeline`（线性）或 `graphPipeline`（DAG 图） |

### 3.2 可用模板列表

#### 软件开发类

| 模板 ID | 名称 | Pipeline | 说明 |
|:--------|:-----|:---------|:-----|
| `coding-basic-template` | ⚡ 简单编码 | 1 stage: coding-basic | 修 bug、小功能、重构。单 Agent 直接执行 |
| `design-review-template` | 🔍 产品体验评审 | 1 stage: ux-review | UX 审计 + 改进方案（5 维度评审 + 3 轮收敛） |
| `development-template-1` | 🏭 完整产研链 | 3 stages: product-spec → architecture → dev | 从需求到代码全自动。PM 写需求 → 架构设计 → 自治开发 |
| `ux-driven-dev-template` | 🎨 交互驱动产研 | 4 stages: ux-review → product-spec → arch → dev | 先 UX 审计再进入产研链 |
| `large-project-template` | 📦 大型项目分解 | 4 stages: planning → fan-out → join → integration | 自动拆分为多个子项目并行开发，最后集成 |
| `template-factory` | 🏭 模板工厂 | 2 stages: requirements → design | 用 AI 生成新的 Template 定义 |

#### 研究调研类

| 模板 ID | 名称 | Pipeline | 说明 |
|:--------|:-----|:---------|:-----|
| `universal-batch-template` | 🔬 通用批量研究 | 3 stages: planning → fan-out → join | 自动拆分为多个并行研究分支，最终汇总 |
| `research-branch-template` | 📚 研究分支 | 1 stage: research-task | 单个研究任务执行 |

#### 金融分析类

| 模板 ID | 名称 | Pipeline | 说明 |
|:--------|:-----|:---------|:-----|
| `financial-analysis-template` | 📊 A股盘前分析 | 3 stages: data → analysis → brief | 数据采集 → 策略分析 → 简报撰写 |
| `morning-brief-template` | 📰 盘前简报(Multi-Agent) | 8 nodes (graph) | 宏观/地缘/科技/A股/资金面并行分析 → 策略综合 → 简报 |

#### 通用

| 模板 ID | 名称 | Pipeline | 说明 |
|:--------|:-----|:---------|:-----|
| `adhoc-universal` | 🔧 通用兜底 | 1 stage: adhoc-general | 单阶段模板，作为 CEO 的最后回退选项 |

### 3.3 Template JSON 关键参数

完整的模板文件位于 `~/.gemini/antigravity/gateway/assets/templates/*.json`。

```json
{
  "id": "development-template-1",
  "kind": "template",
  "title": "完整产研链",
  "description": "从需求到代码的完整产研流水线",

  "pipeline": [
    {
      "stageId": "product-spec",
      "autoTrigger": false,
      "title": "产品规格",
      "executionMode": "review-loop",
      "roles": [
        { "id": "pm-author", "workflow": "/pm-author", "timeoutMs": 600000 },
        { "id": "product-lead-reviewer", "workflow": "/product-lead-reviewer", "timeoutMs": 480000 }
      ],
      "sourceContract": { "acceptedSourceStageIds": [] }
    },
    {
      "stageId": "architecture-advisory",
      "autoTrigger": true,
      "upstreamStageIds": ["product-spec"],
      "title": "架构顾问",
      "executionMode": "review-loop",
      "roles": [
        { "id": "architect-author", "workflow": "/architect-author", "timeoutMs": 720000 },
        { "id": "architecture-reviewer", "workflow": "/architecture-reviewer", "timeoutMs": 600000 }
      ],
      "sourceContract": { "acceptedSourceStageIds": ["product-spec"] }
    },
    {
      "stageId": "autonomous-dev-pilot",
      "autoTrigger": true,
      "upstreamStageIds": ["architecture-advisory"],
      "title": "自主开发（含交付审核）",
      "executionMode": "review-loop",
      "roles": [
        { "id": "autonomous-dev", "workflow": "/autonomous-dev", "timeoutMs": 1800000, "autoApprove": true }
      ],
      "sourceContract": { "acceptedSourceStageIds": ["architecture-advisory"] }
    }
  ]
}
```

#### Stage / Node 执行配置参数

| 参数 | 类型 | 说明 |
|:-----|:-----|:-----|
| `executionMode` | string | 执行模式（见下） |
| `roles[]` | array | 角色列表 |
| `sourceContract.acceptedSourceStageIds` | string[] | 上游依赖（空 = 入口 stage） |

#### 执行模式

| 模式 | 说明 | 适用 |
|:-----|:-----|:-----|
| `legacy-single` | 单 Agent 执行一次 | coding-basic, adhoc |
| `review-loop` | Author 写 → Reviewer 审 → 循环至通过 | product-spec, architecture |
| `delivery-single-pass` | 单次交付执行 | data-collector, brief-composer |

#### Role 参数

| 参数 | 类型 | 说明 |
|:-----|:-----|:-----|
| `id` | string | 角色标识 |
| `workflow` | string | 绑定的工作流文件路径 |
| `timeoutMs` | number | 超时时间（毫秒） |
| `autoApprove` | boolean | 是否自动批准（跳过人工审批） |
| `maxRetries` | number | 失败重试次数（默认 0） |
| `staleThresholdMs` | number | Agent 长时间无操作判定为 stale |

#### Pipeline Stage 参数

| 参数 | 类型 | 说明 |
|:-----|:-----|:-----|
| `stageId` | string | 阶段标识，模板内唯一 |
| `autoTrigger` | boolean | 前一阶段完成后是否自动触发 |
| `stageType` | string? | `task` / `fan-out` / `join` / `gate` / `switch` / `loop-start` / `loop-end` |
| `upstreamStageIds` | string[]? | 显式上游依赖 |

#### Fan-out 参数

| 参数 | 类型 | 说明 |
|:-----|:-----|:-----|
| `fanOutSource.workPackagesPath` | string | 工作包 JSON 文件路径 |
| `fanOutSource.perBranchTemplateId` | string | 每个分支使用的模板 |
| `fanOutSource.maxConcurrency` | number | 最大并行分支数（0=无限） |

### 3.4 GraphPipeline（DAG 图格式）

用于复杂编排（并行分支、条件路由、循环）：

```json
{
  "graphPipeline": {
    "nodes": [
      { "id": "plan", "kind": "stage", "title": "项目规划", "executionMode": "review-loop", "roles": [], "autoTrigger": true },
      { "id": "dev", "kind": "stage", "title": "开发执行", "executionMode": "review-loop", "roles": [] },
      { "id": "review", "kind": "stage", "title": "代码评审", "executionMode": "review-loop", "roles": [] }
    ],
    "edges": [
      { "from": "plan", "to": "dev" },
      { "from": "dev", "to": "review" }
    ]
  }
}
```

节点 `kind`：`stage` | `fan-out` | `join` | `gate` | `switch` | `loop-start` | `loop-end` | `subgraph-ref`

---

## 4. API 参考

### 4.1 CEO 命令

```bash
POST /api/ceo/command
Body: { "command": string, "options"?: { "model"?: string } }
```

### 4.2 手动派发 Run

```bash
POST /api/agent-runs
Body: {
  "templateId": "development-template-1",    # 推荐！只传 templateId，自动解析第一个 stage
  "workspace": "file:///Users/you/project",
  "prompt": "实现用户登录功能",
  "projectId": "xxx",                        # 可选，归属到已有项目
  "model": "gemini-3-flash",                 # 可选
  "templateOverrides": { "maxConcurrency": 5 }  # 可选，运行时覆写模板参数
}
```

> **重要**：推荐只传 `templateId`，系统自动从第一个 stage 开始；如需从中间阶段恢复或定向派发，再显式传 `stageId`。

如果要把“部门边界”显式下发给 runtime，可以额外传：

```bash
POST /api/agent-runs
Body: {
  "templateId": "development-template-1",
  "workspace": "file:///Users/you/project",
  "prompt": "输出研发日报",
  "executionProfile": {
    "kind": "workflow-run",
    "workflowRef": "/daily-report"
  },
  "departmentRuntimeContract": {
    "workspaceRoot": "/Users/you/project",
    "additionalWorkingDirectories": [
      "/Users/you/shared-materials"
    ],
    "readRoots": [
      "/Users/you/project",
      "/Users/you/shared-materials"
    ],
    "writeRoots": [
      "/Users/you/project/docs",
      "/Users/you/project/demolong"
    ],
    "artifactRoot": "/Users/you/project/demolong/runs/run-123",
    "executionClass": "delivery",
    "toolset": "coding",
    "permissionMode": "acceptEdits",
    "requiredArtifacts": [
      { "path": "daily-report.md", "required": true, "format": "md" }
    ]
  }
}
```

#### Department runtime 扩展字段

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `executionProfile` | object | 执行画像。路由层会先归一化，再下传到 prompt/template runtime |
| `departmentRuntimeContract.workspaceRoot` | string | Department 主工作目录 |
| `departmentRuntimeContract.additionalWorkingDirectories` | string[] | 额外挂载目录 |
| `departmentRuntimeContract.readRoots` | string[] | 允许读取的路径根 |
| `departmentRuntimeContract.writeRoots` | string[] | 允许写入的路径根 |
| `departmentRuntimeContract.artifactRoot` | string | 产物根目录 |
| `departmentRuntimeContract.executionClass` | string | `light` / `artifact-heavy` / `review-loop` / `delivery` |
| `departmentRuntimeContract.toolset` | string | `research` / `coding` / `safe` / `full` |
| `departmentRuntimeContract.permissionMode` | string | `default` / `dontAsk` / `acceptEdits` / `bypassPermissions` |
| `departmentRuntimeContract.requiredArtifacts[]` | array | 每个产物包含 `path`、`required`、可选 `format`、`description` |

#### 当前实现边界

`POST /api/agent-runs` 现在会把 `executionProfile + departmentRuntimeContract` 写入 `taskEnvelope` carrier，再由 `group-runtime` / `prompt-executor` 合并到 `BackendRunConfig`。

当前真正消费这套合同的是 `ClaudeEngineAgentBackend`，覆盖：

1. `claude-api`
2. `openai-api`
3. `gemini-api`
4. `grok-api`
5. `custom`
6. `native-codex`

当前需要明确区分的是：

1. Department / `agent-runs` 主链：
   - `native-codex` 已经走 Claude Engine Department runtime
2. 本地 conversation / chat shell：
   - 仍可继续走旧 `NativeCodexExecutor`
3. `codex`：
   - 仍然属于 light/local runtime，高约束任务会被 capability-aware routing 回退

### 4.3 查看 Run / 项目

```bash
GET /api/agent-runs                        # 所有 Run 列表
GET /api/agent-runs/:id                    # Run 详情
GET /api/projects                          # 所有项目
GET /api/projects/:id                      # 项目详情（含 pipelineState、runs）
```

### 4.4 Pipeline 控制

```bash
POST /api/projects/:id/resume              # 恢复/推进 Pipeline
Body: { "action": "force-complete", "stageId": "planning" }
# action: recover | nudge | restart_role | cancel | skip | force-complete
```

### 4.5 模板管理

```bash
GET  /api/pipelines                        # 所有模板列表
GET  /api/pipelines/:id                    # 模板详情
POST /api/pipelines/validate               # 校验模板
POST /api/pipelines/lint                   # 契约校验
POST /api/pipelines/convert                # pipeline[] ↔ graphPipeline 互转
```

### 4.6 AI 生成模板

```bash
POST /api/pipelines/generate               # 用自然语言生成模板草案
Body: { "goal": "构建微服务开发流程", "constraints": { "maxStages": 8 } }

GET  /api/pipelines/generate/:draftId      # 查看草案
POST /api/pipelines/generate/:draftId/confirm  # 确认保存为正式模板
```

### 4.7 Stage 元数据查看

```bash
GET /api/pipelines                         # 所有模板摘要（含 stages）
GET /api/pipelines/:id                     # 模板详情（含每个 stage/node 的执行配置）
```

### 4.8 CEO 干预 Run

```bash
POST /api/agent-runs/:id/intervene
Body: { "action": "retry" | "cancel" | "skip" | "nudge" }
```

### 4.9 审批

```bash
GET    /api/approval                       # 待审批列表
PATCH  /api/approval/:id                   # 批准/拒绝
POST   /api/approval/:id/feedback          # 提交反馈
```

### 4.10 定时任务

```bash
GET    /api/scheduler/jobs                 # 任务列表
POST   /api/scheduler/jobs                 # 创建定时任务
POST   /api/scheduler/jobs/:id/trigger     # 手动触发
```

### 4.11 Conversation 错误 Step 字段

Conversation 时间线里的 `CORTEX_STEP_TYPE_ERROR_MESSAGE` 现在支持结构化错误字段，不再只是一条 `errorMessage.message`。

前端展示优先级：

1. `errorMessage.error.userErrorMessage`
2. `errorMessage.message` / `errorMessage.errorMessage`
3. `errorMessage.error.shortError`

如果存在更完整的原始错误文本，聊天界面会提供可展开的技术细节区。

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `errorMessage.message` | `string?` | 旧版纯文本错误，兼容保留 |
| `errorMessage.errorMessage` | `string?` | 旧版字段别名，兼容保留 |
| `errorMessage.error.userErrorMessage` | `string?` | 用户可直接理解的失败原因 |
| `errorMessage.error.shortError` | `string?` | 简短技术原因 |
| `errorMessage.error.errorCode` | `number \| string?` | HTTP / RPC 错误码 |
| `errorMessage.error.fullError` | `string?` | 完整错误文本，可展开查看 |
| `errorMessage.error.rpcErrorDetails` | `unknown[]?` | RPC 结构化细节 |

---

## 5. 部门与组织

### 5.1 OPC 映射

| 物理概念 | OPC 映射 |
|:---------|:---------|
| 电脑 | 总部（一个组织） |
| 文件夹(workspace) | 部门 |
| 用户 | CEO |
| AI Agent | 员工 |

### 5.2 部门配置

每个 workspace 根目录下 `.department/config.json`：

```json
{
  "name": "超级 IT 研发部",
  "type": "build",
  "description": "主要产品研发部门",
  "templateIds": [
    "coding-basic-template",
    "development-template-1",
    "large-project-template"
  ],
  "skills": [
    {
      "skillId": "frontend",
      "name": "前端开发",
      "category": "frontend",
      "workflowRef": "/frontend-delivery",
      "skillRefs": ["frontend-ui", "browser-testing"],
      "difficulty": "mid"
    }
  ],
  "provider": "antigravity",
  "tokenQuota": {
    "daily": 500000,
    "monthly": 10000000,
    "canRequestMore": true
  }
}
```

**关键字段**：

| 字段 | 说明 |
|:-----|:-----|
| `name` | 部门名（CEO 用来匹配"让XX部做..."） |
| `type` | `build` / `research` / `operations` / `ceo` |
| `templateIds` | 该部门可用的模板列表（CEO 优先从这里选） |
| `skills` | 技能清单（部门能力声明；支持 `skill -> workflowRef -> skillRefs`） |
| `provider` | 默认执行 Provider（`antigravity` / `codex` / `claude-code` / `claude-api`） |

`skills[]` 常用字段：

| 字段 | 说明 |
|:-----|:-----|
| `skillId` | 技能稳定标识 |
| `name` | 技能显示名 |
| `category` | 技能分类 |
| `workflowRef` | 优先命中的 canonical workflow |
| `skillRefs` | workflow 不可用时的 canonical skill fallback 列表 |

可选私有配置文件：

- `<workspace>/.department/private.json`

适用：

- 不应进入 repo 的部门私有密钥 / token

当前已使用字段示例：

```json
{
  "dailyEventsAdminToken": "..."
}
```

### 5.4 Workflow Runtime Manifest

canonical workflow frontmatter 现在可以声明运行时 hook 元数据：

```md
---
description: ...
trigger: always_on
runtimeProfile: daily-events
runtimeSkill: baogaoai-ai-bigevent-generator
---
```

字段说明：

| 字段 | 说明 |
|:-----|:-----|
| `runtimeProfile` | 共享 runtime 应使用的 hook profile |
| `runtimeSkill` | 该 profile 依赖的 canonical skill 名称 |

### 5.4 Prompt Mode / Run 结果中的 workflow 验证字段

`GET /api/agent-runs/:id` 的返回中，Prompt Mode 相关字段包括：

| 字段 | 说明 |
|:-----|:-----|
| `resolvedWorkflowRef` | 本次实际命中的 canonical workflow |
| `resolvedSkillRefs` | 本次注入的 skill fallback |
| `promptResolution` | Prompt Mode 的解析证据与原因 |
| `reportedEventDate` | 需要真实上报时，最终写入的业务日期 |
| `reportedEventCount` | 最终上报的事件数 |
| `verificationPassed` | 是否通过 post-run 回读验证 |
| `reportApiResponse` | 上报验证的摘要信息（例如 report URL） |

### 5.3 部门 API

```bash
GET /api/departments?workspace=<uri>       # 获取部门配置
PUT /api/departments?workspace=<uri>       # 更新部门配置
GET /api/departments/quota                 # 配额查询
```

---

## 6. Pipeline 编排详解

### 6.1 自动链式触发

使用 Template 派发时（只传 `templateId`），系统自动管理 Pipeline：

```
Stage 0: product-spec → RUNNING → approved ✅
                                      ↓ autoTrigger
Stage 1: architecture → RUNNING → approved ✅
                                      ↓ autoTrigger
Stage 2: dev-pilot   → RUNNING → completed ✅
                                      ↓
Project status → completed ✅
```

### 6.2 Fan-out / Join 并行编排

```
planning (产出 work-packages.json)
    ↓
fan-out (自动创建 N 个子 Project 并行执行)
    ├── 子 Project 0
    ├── 子 Project 1
    └── 子 Project N
    ↓ (所有完成后)
join (汇总)
    ↓
integration (集成)
```

### 6.3 Gate 人工审批门

```bash
# 审批通过
POST /api/projects/{pid}/gate/{nodeId}/approve
Body: { "action": "approve", "reason": "产出符合要求" }
```

### 6.4 Pipeline 恢复动作

| 动作 | 适用场景 |
|:-----|:---------|
| `recover` | 从已有产物恢复 Run 完成态 |
| `nudge` | 继续 stale 的 Run |
| `restart_role` | 创建新会话接管角色 |
| `cancel` | 终止 Run |
| `skip` | 跳过当前 stage |
| `force-complete` | 强制标记 stage 完成并触发下游 |

> 迁移边界：`recover` 仅适用于当前 stage-centric 持久化数据。旧的 `groupId`-only run/project 状态不会再被加载。

### 6.5 Checkpoint / Replay

```bash
GET  /api/projects/:id/checkpoints         # 查看快照
POST /api/projects/:id/checkpoints/:cpId/restore  # 恢复到快照
POST /api/projects/:id/resume              # 从最近快照继续
```

---

## 7. 高级功能

### 7.1 运行时模板覆写 (`templateOverrides`)

在 dispatch 时动态覆盖模板参数，不修改源文件：

```json
{
  "templateId": "universal-batch-template",
  "templateOverrides": {
    "maxConcurrency": 10,
    "defaultModel": "gemini-3-flash"
  }
}
```

### 7.2 共享对话模式

review-loop 中 author 复用同一对话，节约 ~73% input tokens：

```json
{ "conversationMode": "shared" }
```

或全局：`AG_SHARED_CONVERSATION=true`

### 7.3 多 Provider 支持

| Provider | 协议 | 特点 |
|:---------|:-----|:-----|
| `antigravity` | gRPC → IDE | 流式步骤、多轮对话、IDE 技能 |
| `codex` | MCP → Codex CLI | 沙盒隔离、同步执行 |
| `native-codex` | OAuth → Codex Responses API | 不依赖外部 IDE runtime，transcript 由 Gateway 持久化 |
| `claude-code` | Claude Code CLI | Workspace 编码，支持 resume/append |
| `claude-api` | 进程内 → Anthropic API | 无需外部 Runtime，内置工具执行，API Key 即可用 |

配置优先级：Scene覆盖 > 部门覆盖 > Layer默认 > 组织默认

#### 执行历史保真度

- **cutover 后的新 run**：统一写入 `run-history.jsonl`，可看到 provider 事件、user/assistant 内容、产物与校验。
- **cutover 前的老 run**：迁移后通常能看到 transcript/result/artifact/verification，但不保证恢复出完整 step-by-step provider 过程。
- `antigravity` 的强项是 IDE 原生 step stream，所以新 run 能看到 `provider.step`。
- `codex / native-codex / claude-code / API providers` 的强项是 Gateway 自管 transcript，所以新 run 能稳定回放对话与工具事件。

### 7.4 数据契约系统

Stage 间的输入/输出可以声明类型化契约，template 加载时自动校验兼容性：

```bash
POST /api/pipelines/lint -d '{"templateId": "my-template"}'
```

### 7.5 可复用子图

把一组节点封装为可复用模块，在多个模板中引用：

```bash
GET /api/pipelines/subgraphs
```

### 7.6 资源配额策略

限制 workspace/template/project 的 Run 数、分支数、迭代次数：

```bash
POST /api/pipelines/policies/check
Body: { "projectId": "xxx", "usage": { "runs": 15 } }
```

### 7.7 安全框架

4 层检查：Bash Safety → Permission Engine → Hook Runner → Sandbox Manager

策略文件：`workspace/.security/policy.json`

权限模式：`bypass` / `strict` / `permissive` / `default`

---

## 8. 常见问题

### Q: "No approved runs available" 怎么办？

上游 Stage 必须先通过审批。例如 `autonomous-dev-pilot` 需要 `architecture-advisory` 已 approved。

### Q: CEO 说"负载过高"怎么办？

部门活跃项目 ≥ 5 时触发。可以：
1. 等现有项目完成
2. 取消不需要的项目：`取消XX项目`
3. 直接通过 `POST /api/agent-runs` 手动派发（绕过 CEO 负载检查）

### Q: CEO 匹配不到部门？

- 确保部门名称和命令中的名称一致（空格无关）
- 指定完整部门名：`让研发部做...` 而不是 `帮我做...`
- 或选择部门后通过快速任务派发

### Q: Pipeline 卡住了怎么办？

```bash
# 查看 stage 状态
GET /api/projects/:id

# 强制推进（Watcher 断连等场景）
POST /api/projects/:id/resume
Body: { "action": "force-complete", "stageId": "planning" }
```

### Q: 产物文件在哪里？

```
demolong/projects/{projectId}/runs/{runId}/
├── result.json              ← Agent 执行结果
├── specs/                   ← 需求文档
├── architecture/            ← 技术方案
├── delivery/                ← 开发交付产物
└── review/                  ← 审查记录
```

### Q: 配置文件在哪里？

| 内容 | 路径 |
|:-----|:-----|
| 模板 | `~/.gemini/antigravity/gateway/assets/templates/*.json` |
| 工作流 | `~/.gemini/antigravity/gateway/assets/workflows/*.md` |
| 部门配置 | `workspace/.department/config.json` |
| 主数据库 | `~/.gemini/antigravity/gateway/storage.sqlite` |
| Run 执行历史 | `~/.gemini/antigravity/gateway/runs/{runId}/run-history.jsonl` |
| AI Provider 配置 | `~/.gemini/antigravity/ai-config.json` |
| 安全策略 | `workspace/.security/policy.json` |

### Q: Run 状态有哪些？

```
queued → starting → running → completed ✅
                             → failed ❌
                             → blocked ⚠️
                             → cancelled 🚫
                             → timeout ⏰
```
# Agent System 使用指南

> Multi-Agent 自治交付系统完整文档（V5.4）

---

## 目录

1. [系统简介](#1-系统简介)
2. [核心概念](#2-核心概念)
3. [Stage Execution Profiles 详解](#3-stage-execution-profiles-详解)
4. [Workflows 输入/输出约定](#4-workflows-输入输出约定)
5. [推荐交付生命周期](#5-推荐交付生命周期)
6. [Web UI 操作指南](#6-web-ui-操作指南)
7. [API 完整参考](#7-api-完整参考)
8. [Run 状态与生命周期](#8-run-状态与生命周期)
9. [产物体系](#9-产物体系)
10. [平台协议：Envelope 与 Manifest](#10-平台协议envelope-与-manifest)
11. [模型选择策略](#11-模型选择策略)
12. [常见问题与故障排查](#12-常见问题与故障排查)
13. [Fan-out / Join 并行编排](#13-fan-out--join-并行编排)
14. [GraphPipeline 显式图格式](#14-graphpipeline-显式图格式)
15. [数据契约系统（V4.4）](#15-数据契约系统v44)
16. [高级控制流（V5.2）](#16-高级控制流v52)
17. [AI 辅助流程生成（V5.3）](#17-ai-辅助流程生成v53)
18. [可复用子图与资源配额（V5.4）](#18-可复用子图与资源配额v54)
19. [共享对话模式（V5.5）](#19-共享对话模式v55)
20. [多 Provider 支持（V6）](#20-多-provider-支持v6)
21. [OPC 组织治理（V6）](#21-opc-组织治理v6)
22. [Security Framework（V6）](#22-security-frameworkv6)
23. [定时任务调度（V6）](#23-定时任务调度v6)

---

## 1. 系统简介

### 这是什么

本系统是一个内置于 Antigravity Gateway 的 **Workspace-Centric Multi-Agent Delivery System**。它不是简单的"聊天 + 代码"，而是一套完整的项目治理框架：

- **主控 AI（Governor）** 担任项目治理者，负责需求审批、任务分发、质量门禁
- **顾问团（Advisory Groups）** 产出获批的产品需求和技术方案
- **自治开发团队（Delivery Groups）** 接收结构化 Work Package，自主研究、实现、测试、交付
- **所有协作通过结构化产物包进行**，而非依赖对话上下文传递

### 设计理念

> 主控 AI 应该是项目治理者，而不是亲自承担所有执行细节的超级个体。多 Agent 的价值来自自治与并行，而非把同一份微操工作拆给更多 worker。

### 基本运行原理

```
用户提需求 → 主会话 dispatch → Stage Runtime 创建 Hidden Child Conversation
           → Child 执行 Workflow → 产出结构化结果 → 主会话只看最终报告
```

所有 Agent Worker 都在**独立的隐藏对话**中运行，与主会话上下文完全隔离。

---

## 2. 核心概念

### Stage Execution Profile（阶段执行配置）

一个 stage / node 的执行配置定义了：
- 包含哪些角色（roles）
- 执行模式（单次执行 / 多轮审查 / 交付通过）
- 需要哪些上游输入（source contract）
- 超时与重试策略

### Template（模板 - V3.5 核心）

**Template = 零件目录 + 装配说明。** 一个模板是一个完整的解决方案包，自包含地定义了：

- **Stage / Node 执行配置**：每个 stage/node 直接内联携带 `executionMode`、`roles`、`sourceContract`
- **Pipeline**：执行顺序与自动链式触发规则
- **Review 配置**：审查策略

当前可用的 4 个模板：

| 模板 ID | 标题 | Groups | 文件 |
|:--------|:-----|:-------|:-----|
| `development-template-1` | 完整产研链 | product-spec → architecture → dev | `~/.gemini/antigravity/gateway/assets/templates/development-template-1.json` |
| `design-review-template` | 产品体验评审 | ux-review | `~/.gemini/antigravity/gateway/assets/templates/design-review-template.json` |
| `ux-driven-dev-template` | 交互驱动产研 | ux-review → product-spec → arch → dev | `~/.gemini/antigravity/gateway/assets/templates/ux-driven-dev-template.json` |
| `coding-basic-template` | 简单编码 | coding-basic | `~/.gemini/antigravity/gateway/assets/templates/coding-basic-template.json` |

Workflow（角色指令文件）是**全局可复用资产**，存储在 `~/.gemini/antigravity/gateway/assets/workflows/*.md`，可被多个模板或多个 stage/node 的执行配置跨项目引用。模板本身互不继承；需要新的编排方式时，应新建模板而不是隐式修改已有模板语义。

### Role（角色）

Stage / node 内部的一个具体执行单元。每个 role 绑定一个 workflow 文件，如 `pm-author` 绑定 `/pm-author` workflow。

### Run（运行实例）

一次具体的任务执行。Run 状态与完整生命周期见 [§8.1 状态流转](#81-状态流转)。

### Workflow（工作流）

定义在全局目录 `~/.gemini/antigravity/gateway/assets/workflows/` 下的 Markdown 文件，是 Agent Worker 的"执行脑"——告诉 AI 该做什么、按什么顺序做、最终输出什么。Workflow 是全局配置，跨项目共享，确保所有 workspace 使用一致的角色指令。

### Source Contract（来源合同）

声明一个 stage 需要消费哪个上游 stage 的产物。比如 `architecture-advisory` 要求上游必须是一个 `approved` 的 `product-spec` run。

### Envelope Protocol（信封协议）

平台级的输入/输出外壳。`TaskEnvelope` 是输入外壳（目标、约束、产物引用），`ResultEnvelope` 是输出外壳（状态、决策、风险、产出清单）。

### Project

一次完整的交付链路的容器。可以跨越多个 Run。所有相关的 run 会归属于同一个 project 目录下（而不是散落在孤立的 run 目录中）：

```
demolong/projects/{projectId}/
├── project.json       ← 项目元数据（目标、状态等）
├── runs/              ← 该项目的所有 run（例如 demolong/projects/{projectId}/runs/{runId}/）
└── integration/       ← 集成产物
```

### result.json（结构化输出协议 - V3 核心）

平台级强制协议。所有 Agent Worker（不管属于哪个角色）完成任务时，必须在其分配到的 artifact 目录根下写入 `result.json`。这个文件是与主控 AI 和后续环节通信的强制握手协议：

```json
{
  "status": "completed", 
  "summary": "详细的任务执行总结摘要",
  "changedFiles": ["src/app.tsx", "demolong/projects/xxx/runs/yyy/specs/draft-spec.md"],
  "outputArtifacts": ["specs/draft-spec.md"],
  "risks": ["由于依赖项 M 没有升级，可能存在兼容性风险"],
  "nextAction": "Ready for Review"
}
```

> **重点要求**：如果 `status` 为 `blocked`，还应当在该对象中补充 `blockedReason` 字段。Runtime 优先读取 `result.json` 以提取 Worker 的工作成果，如果不合规或缺失，Run 会被标记为 failed。对于 review-loop reviewer，还必须额外写 `review/result-round-{N}.json`，其中包含结构化 `decision` 字段。

---

## 3. Stage Execution Profiles 详解

### 3.1 Coding Worker (`coding-basic`)

**用途**：最简单的单任务开发模式——修 bug、做功能、重构。

| 属性 | 值 |
|------|-----|
| 执行模式 | `legacy-single` |
| 角色 | `dev-worker` |
| Workflow | `/dev-worker` |
| 超时 | 20 分钟 |
| 需要上游 | ❌ |
| 输出 Envelope | ❌ |

**适用场景**：
- 快速修复单个 bug
- 执行明确的代码重构
- 简单的功能添加

---

### 3.2 Product Specification (`product-spec`)

**用途**：产品需求定义。PM Author 起草产品需求文档，Lead Reviewer 多轮审查，最终输出获批的 Product Packet。

| 属性 | 值 |
|------|-----|
| 执行模式 | `review-loop` |
| 角色 | `pm-author` + `product-lead-reviewer` |
| 最大审查轮数 | 3 轮 |
| 超时 | Author 10 分钟, Reviewer 8 分钟 |
| 需要上游 | ❌ |
| 输出 Envelope | ✅ |

**工作流程**：
```
pm-author 起草 specs/
    ↓
product-lead-reviewer 审查
    ↓
approved → 完成 ✅
revise   → pm-author 修改 → reviewer 再次审查 (最多 3 轮)
rejected → Run 以 rejected 结束
```

**产出目录**：`specs/`

---

### 3.3 Architecture Advisory (`architecture-advisory`)

**用途**：技术方案设计。Architect Author 基于产品需求起草技术方案，Reviewer 多轮审查。

| 属性 | 值 |
|------|-----|
| 执行模式 | `review-loop` |
| 角色 | `architect-author` + `architecture-reviewer` |
| 最大审查轮数 | 3 轮 |
| 超时 | Author 12 分钟, Reviewer 10 分钟 |
| 需要上游 | ✅ 必须有一个 `approved` 的 `product-spec` run |
| 输出 Envelope | ✅ |

**产出目录**：`architecture/`（含 `write-scope-plan.json`，这是 V3 防护体系的关键）

---

### 3.4 Autonomous Dev Pilot (`autonomous-dev-pilot`)

**用途**：自治开发交付。接收一个 Work Package，自主研究代码、实现功能、运行测试、输出 Delivery Packet。

| 属性 | 值 |
|------|-----|
| 执行模式 | `delivery-single-pass` |
| 角色 | `autonomous-dev` |
| 超时 | 30 分钟 |
| 需要上游 | ✅ 必须有一个 `approved` 的 `architecture-advisory` run |
| 输出 Envelope | ✅ |
| 自动追溯 | ✅ 自动把 architecture 的上游 product-spec 需求文档也纳入输入 |

**Workflow 执行步骤**：
1. 读取 `work-package/work-package.json`
2. 读取 `input/` 下的上游产物（产品需求 + 技术方案）
3. 自行研究代码库
4. 遵守 `write-scope-plan.json` 中配置的防越权边界，实现代码变更
5. 运行 `npx tsc --noEmit` 和其他测试验证
6. 产出 `delivery/delivery-packet.json`（**强约束**）
7. 产出 `delivery/implementation-summary.md` 和 `delivery/test-results.md`

**强约束规则**：
- 如果 workflow 未在 `delivery/` 中产出 `delivery-packet.json` → Run 标记为 `failed`
- 如果 JSON 无法解析，或者 `taskId` 错误 → Run 标记为 `failed`
- **所有产出必须结合目录根下的 `result.json`** 交差。

---

### 3.5 UX Review (`ux-review`)

**用途**：产品体验评审。UX Review Author 从 5 个维度审计交互设计，Critic 进行对抗性挑战。3 轮收敛后产出改进方案。

| 属性 | 值 |
|------|-----|
| 执行模式 | `review-loop` |
| 角色 | `ux-review-author` + `ux-review-critic` |
| 最大审查轮数 | 3 轮 |
| 超时 | Author 12 分钟, Critic 10 分钟 |
| 需要上游 | ❌ |
| 输出 Envelope | ✅ |

**产出**：`audit-report.md`、`interaction-proposals.md`、`priority-matrix.md`

> 这是平台验证的第一个**非软件开发类模板**，证明了 review-loop 引擎可以承载开发以外的场景。

---

### 3.6 Supervisor 看护机制（V3.5 新增）

所有角色执行都受 Supervisor Runtime 看护：

| 机制 | 说明 | 配置字段 |
|:-----|:-----|:--------|
| **Stale 检测** | Agent 长时间无新步骤 → 强制判定失败 | `staleThresholdMs`（默认 3 分钟） |
| **失败重试** | 角色执行失败后创建新子对话重试 | `maxRetries`（默认 0 = 不重试） |

配置示例（在 Template JSON 的 roles 中）：
```json
{ "id": "autonomous-dev", "workflow": "/autonomous-dev", "timeoutMs": 1800000, "autoApprove": true, "maxRetries": 1, "staleThresholdMs": 120000 }
```

---

## 4. Workflows 输入/输出约定

各个 Workflow (工作流) 是实际驱动执行的提示词集，下面列出所有角色 Workflow 约定的详细输入输出结构。
所有 Workflow 都必须通过写出相应的业务文件，并在结束时汇报到根目录的 `result.json`。如果角色是 review-loop reviewer，还必须额外写 `review/result-round-{N}.json` 作为结构化 decision 文件。

| 工作流 Workflow | 所属 Group | 依赖的输入信息 | 核心产出约束 |
|-----------------|------------|---------------|-------------|
| **`/dev-worker`** | `coding-basic` | 用户传给主会话的 Prompt 目标 | 1. 源码修改 <br>2. 根目录的 `result.json` |
| **`/pm-author`** | `product-spec` | 用户 Prompt, 或者是修订轮次的 `review/review-round-{N-1}.md` | 1. `specs/requirement-brief.md`<br>2. `specs/implementation-reality.md`<br>3. `specs/draft-spec.md` |
| **`/product-lead-reviewer`** | `product-spec` | 同一 Run 下的 `specs/` 草案文档 | 1. `review/review-round-{N}.md`<br>2. `review/result-round-{N}.json` |
| **`/architect-author`** | `architecture-advisory` | `input/`（来自 product-spec 复制的关联需求），以及前轮反馈 | 1. `architecture/architecture-overview.md`<br>2. `architecture/module-impact-map.md`<br>3. `architecture/interface-change-plan.md`<br>4. `architecture/write-scope-plan.json`<br>5. `architecture/test-strategy.md` |
| **`/architecture-reviewer`** | `architecture-advisory` | 同一 Run 下的 `architecture/` 设计草案 | 1. `review/architecture-review-round-{N}.md`<br>2. `review/result-round-{N}.json` |
| **`/autonomous-dev`** | `autonomous-dev-pilot` | 1. `work-package/work-package.json`<br>2. `input/` 复制来的所有架构设计和产品需求 | 1. 源码修改<br>2. **强约束**: `delivery/delivery-packet.json`<br>3. `delivery/implementation-summary.md`<br>4. `delivery/test-results.md` |
| **`/ux-review-author`** | `ux-review` | 用户 Prompt（页面/功能描述），或来自 UI 截图的上下文 | 1. `specs/audit-report.md`<br>2. `specs/interaction-proposals.md`<br>3. `specs/priority-matrix.md` |
| **`/ux-review-critic`** | `ux-review` | 同一 Run 下 UX Review Author 的 `specs/` 审计产出 | 1. `review/review-round-{N}.md`<br>2. `review/result-round-{N}.json` |

---

## 5. 推荐交付生命周期

完整的端到端开发交付流程遵循经典的三阶段递进模型，即**产品 → 架构 → 开发**（product-spec → architecture → dev pilot）：

```mermaid
flowchart LR
    PS["📋 Product Spec\n(pm-author) \nApproved"] --> AA["🏗️ Architecture Advisory\n(architect-author)\nApproved & Scoped"]
    AA --> AD["⚡ Autonomous Dev Pilot\n(autonomous-dev)\nDelivered Packet"]
    AD --> GR["✅ Governor Review\n(主控 AI 最终集成与审阅)"]
```

### 步骤说明

| 步骤 | Group | 你/主控AI 需要做什么 | Runtime 平台自动做什么 |
|------|-------|--------------------|-----------------------|
| **① 定产品** | `product-spec` | 发起 Project 并输入需求目标 | PM Author 起草 → Reviewer 审查 → 循环至获批 → 产出 Product Packet |
| **② 定架构** | `architecture-advisory` | 选择 ① 关联的获批源 Run | 拉取产品产物 → Architect 起草包含 scope 约束的方案 → 审查并获得 Architecture Packet |
| **③ 派发开发** | `autonomous-dev-pilot` | 选择 ② 关联的技术方案 | 自动级联并带入 ①/② 信息，打包成 Work Package 发送 → 自治执行 → 进行范围收缩检测 (Scope Audit) → 提交交付报告 |
| **④ 最终集成** | 主会话 (Governor) | 接收、审阅所有 Deliveries | 汇总 tasks、展示 scope warnings 与 risks、整合进主分支。 |

> **V3.5 Pipeline 自动链式触发**：如果使用 Template dispatch（传入 `pipelineId`），阶段 ②③ 会在前序阶段 approved/completed 后**自动触发**，无需手动逐个 dispatch。

> **提示**：完整的 `Project` 将贯穿整个生命周期。对于小型任务，允许跳离复杂链路，直接调用 `coding-basic` 或通过 UI 手动发起简单 Run。

---

## 6. Web UI 操作指南

### 6.1 主界面入口（OPC Dashboard）

打开应用后默认进入 **OPC（组织治理）** 视图，这是完整的操作中心：

- **Header 主导航** — 一级入口固定在顶部：**CEO Office** / **OPC** / **对话** / **知识** / **Ops**
- **左侧上下文栏** — 不再承担一级菜单；只显示当前模块的二级列表与当前上下文（如项目树、对话分组、知识条目、Ops 资产）
- **Settings** — 从一级导航移到 Header 右侧工具区，通过齿轮入口打开
- **Header 右侧** — 三个通知指示器：🔔 审批 / ⚡ 事件 / ▶ 运行中的任务（点击展开侧滑抽屉）
- **移动端** — 汉堡菜单打开一级主菜单，独立的上下文按钮打开左侧上下文栏，避免主菜单和二级内容挤在同一个抽屉里

### 6.2 方式一：CEO Office 自然语言调度（推荐）

进入 CEO Office → Dashboard，在“用一句话创建定时任务”卡片中直接输入：

```
每天工作日上午 9 点让市场部创建一个日报任务项目
每周一上午 10 点巡检项目 Alpha 的健康度
明天上午 9 点让设计部创建一个 ad-hoc 项目，目标是整理 backlog
```

如果 CEO 找不到唯一匹配的部门、项目或模板，会返回 `needs_decision` 建议按钮，点击后会自动把澄清项回填到输入框。

### 6.3 方式二：项目与流水线手动派发

点击 OPC 页右上角 **`+ 创建项目`** 按钮 → 填写名称/目标/工作区 → 创建**空容器**（不启动执行）。

创建后在项目详情中点击 **「派发流水线」** 按钮，选择 Template（如 `development-template-1`），才会启动完整的 `product-spec → architecture → dev` 三段流水线。

### 6.4 方式三：Scheduler Panel / MCP / REST

如果需要精确控制定时任务参数：

1. 切到 **Ops** 标签，直接使用 `SchedulerPanel`
2. 或调用 MCP：`antigravity_create_scheduler_job` / `antigravity_update_scheduler_job`
3. 或直接调用 REST：`/api/scheduler/jobs*`

补充：

- **OPC / Projects** 现在会显示一个“循环任务”概览卡，专门暴露 interval / loop job 的本体状态
- **Ops / SchedulerPanel** 会把 interval job 直接渲染成人类可读 cadence（例如“每 5 秒”），不再只显示原始 `intervalMs`

### 6.5 查看运行进展

- **Header ▶ 抽屉**：展示所有活跃 Run，点击可查看详情
- **项目详情 Workbench**：点击左侧 Sidebar 项目 → 右侧显示 Pipeline DAG 进度 + 各 Stage 状态
- **Open Conversation**：每个 Run 详情页有「打开对话」按钮，查看 Agent 隐藏子对话的实时步骤
- **CEO Dashboard**：部门 + 项目总览 + 近期交付 + Token 配额

### 6.6 添加第三方 Provider（DeepSeek / Groq / Ollama / OpenAI Compatible）

当前前端已经提供完整的第三方 Provider onboarding：

- **入口 1：Ops 快捷入口** — 进入 **Ops** 后，顶部会看到 **「添加第三方 Provider」** 卡片，点击可直接跳到 Settings 的第三方 Provider 区块
- **入口 2：Header Settings** — 点击 Header 右上角齿轮，进入 **Provider 配置** Tab，首屏就是第三方 Provider 主区块

接入流程：

1. 选择预设卡片：`DeepSeek` / `Groq` / `Ollama` / `OpenAI Compatible` / `高级自定义`
2. 填写连接信息：
   - 显示名称
   - API Base URL
   - API Key
   - 默认模型
3. 点击 **「测试连接」** 做真实接口校验
4. 点击 **「保存 Provider 配置」** 保存当前第三方 profile
5. 视需要点击：
   - **「设为组织默认 Provider」**
   - **「应用到 Executive / Management / Execution / Utility」**

补充说明：

- 当前所有第三方厂商在执行层统一映射到 **`custom` provider**
- v1 只维护 **一个活动中的第三方 Provider profile**
- 若某个 layer 已选 `custom`，需要回到上方第三方 Provider 区块修改端点、key 和默认模型
- `Provider 配置` 与 `Scene 覆盖` 下拉只显示**当前已配置/已登录/已安装**的 Provider；未配置项不会再出现在可选列表中
- 如果历史配置里残留了失效 Provider，界面会保留一个 `(...未配置)` 占位，提醒你切换到可用 Provider 后再保存

### 6.7 Claude / Codex / API Provider 支持矩阵

Settings 的 **Provider 配置** 里现在有统一的 Provider 支持矩阵，可直接看到这些状态：

- **Claude API** — 依赖 Anthropic API Key
- **Claude Code** — 依赖本地 Claude Code CLI / profile 检测
- **Codex Native** — 依赖 `~/.codex/auth.json`，复用本机 Codex 登录
- **Codex (MCP)** — 依赖 `codex` CLI
- **OpenAI API** — 依赖 OpenAI Key
- **Gemini API** — 依赖 Gemini Key
- **Grok API** — 依赖 xAI / Grok Key
- **OpenAI Compatible** — 依赖第三方 profile（DeepSeek / Ollama / Groq / 自定义端点）

在 **API Keys** 页中，除了 Anthropic / OpenAI 之外，也可以直接配置：

- `Gemini API Key`
- `Grok API Key`
- 本地登录态展示：`Codex Native` / `Claude Code`
- Settings 保存组织配置时，后端也会再次校验：任何未配置 Provider 都会被 `/api/ai-config` 以 `400` 拒绝，避免手工请求绕过前端限制

---

## 7. API 完整参考

*(节选核心部分，使用方式与此前一致)*

```http
POST /api/agent-runs
Content-Type: application/json

{
  "projectId": "xxx",
  "templateId": "development-template-1",
  "stageId": "architecture-advisory",
  "workspace": "file:///Users/you/project",
  "prompt": "设计任务系统技术方案",
  "sourceRunIds": ["<approved-product-spec-runId>"],
  "templateOverrides": { "maxConcurrency": 5, "defaultModel": "gemini-flash" },
  "conversationMode": "shared"
}
```

> `templateId + stageId` 是新的统一派发语义。如果 dispatch 时未显式提供 `stageId`，系统仅允许入口 stage 启动。
>
> `templateOverrides`（V5.3，可选）：运行时覆写 Template JSON 中的任意参数。通过 deep-merge 注入到 template 副本中，不会修改原始模板文件。覆写持久化到 Project 状态，在 Fan-out 等后续阶段自动生效。
>
> `conversationMode`（V5.5，可选）：控制 review-loop 中的对话复用策略。`"shared"` = author 在后续轮次复用同一个 conversation（节约 ~73% Token），`"isolated"` = 每个 role 创建独立 conversation（默认行为）。仅对 `review-loop` 执行模式的 stage 有效（如 `product-spec`、`architecture-advisory`）。也可通过环境变量 `AG_SHARED_CONVERSATION=true` 全局启用。

```http
GET /api/pipelines
```

> 返回所有可用的 Template 定义（每个 Template 自包含 groups + pipeline）。

---

## 8. Run 状态与生命周期

### 8.1 状态流转

```
queued → starting → running → completed ✅
                             → blocked   ⚠️  (受阻，例如等待 API 密钥或被平台拒绝)
                             → failed    ❌  (执行失败/必需协议文件缺失)
                             → cancelled 🚫  (用户终止)
                             → timeout   ⏰  
```

对于 Architecture 审查通过是 `approved`，而对于 Dev Pilot 提交成功是 `delivered`。如果不符合 scope 限定，会引发 `delivered-with-scope-warnings` 警告状态。

在 Project Pipeline 视角上，Stage 还会额外体现：

- `blocked`：等待人工输入或外部条件解除，不会自动 fork 新 run
- `cancelled`：由操作员终止；保留 pipeline 关联，但不会自动推进下游 stage

### 8.2 Pipeline 恢复动作

Project Pipeline 的标准恢复动作有 6 个：

- `recover`：从现有 artifact / resultEnvelope 恢复同一个 run 的完成态
- `nudge`：继续当前 `activeConversationId`，只适用于 stale-active run（`starting/running` 且已出现 `liveState.staleSince`）
- `restart_role`：在同一个 run 内新建 Conversation 接管某个 role/process
- `cancel`：终止 canonical run，并把 stage 标记为 `cancelled`
- `skip`：跳过当前 stage，不执行也不触发下游 dispatch。适用于 `pending`/`failed`/`blocked`/`cancelled` 状态的 stage
- `force-complete`：标记 stage 为 `completed` 并触发下游 dispatch（fan-out、join 等）。适用于 Watcher 断连等异常场景。适用于 `running`/`failed`/`blocked`/`cancelled`/`pending` 状态的 stage

补充说明：pre-migration 的 `groupId`-only persisted run/project 状态不再进入恢复流程；如果需要继续执行，应该重新派发当前模板的目标 stage。

关键约束：

- 正常恢复流程不会新建第二个 run
- superseded / cancelled 的旧 Conversation 即使迟到返回，也不会再写状态
- `redispatch` 不属于标准恢复动作

---

## 9. 产物体系

V3 系统产物彻底通过文件进行传递。由于引入了 Project 概念，产物存储目录会基于属于是否挂载在 Project 下有所不同。
正确的文件路径请认准 **`demolong/runs/`** 和 **`demolong/projects/`**。这些文件不在 `.agents/` 下面。

### 9.1 Advisory Run 产物目录

如果你使用的是独立 Run，路径为 `demolong/runs/<runId>/`。如果在 Project 中，则是 `demolong/projects/<projectId>/runs/<runId>/`：

```
demolong/runs/<runId>/ (或者 demolong/projects/<projectId>/runs/<runId>/)
├── task-envelope.json           ← 平台输入外壳
├── result-envelope.json         ← 平台输出外壳（含 decision / artifacts）
├── artifacts.manifest.json      ← 所有产出文件清单
├── result.json                  ← Agent Worker 执行完毕主动填写的最终结论 (必需)
├── input/
│   └── <sourceRunId>/...        ← 上游来源产物副本
├── specs/                       ← product-spec / ux-review author 的主要产出
│   ├── requirement-brief.md
│   ├── implementation-reality.md
│   ├── draft-spec.md
│   ├── audit-report.md
│   ├── interaction-proposals.md
│   └── priority-matrix.md
├── architecture/                ← architecture-advisory Workflow 的主要产出
│   ├── architecture-overview.md
│   ├── module-impact-map.md
│   ├── interface-change-plan.md
│   ├── write-scope-plan.json
│   └── test-strategy.md
└── review/
    ├── review-round-{N}.md
    ├── architecture-review-round-{N}.md
    └── result-round-{N}.json
```

### 9.2 Delivery Run 产物目录

同样使用 `demolong/runs/` 或 `demolong/projects/.../runs/` 前缀：

```
demolong/projects/<projectId>/runs/<runId>/
├── task-envelope.json
├── result-envelope.json
├── artifacts.manifest.json
├── result.json
├── work-package/
│   └── work-package.json        ← Runtime 自动拼装下发的 Work Package 约束凭证
├── input/
│   ├── <archRunId>/architecture/...
│   └── <prodRunId>/specs/...
└── delivery/
    ├── implementation-summary.md ← Workflow 产出：该节点实现说明
    ├── test-results.md           ← Workflow 产出：验证结果
    ├── delivery-packet.json      ← Workflow 产出：结构化交付报告（包含 changedFiles, tests等。强约束）
    └── scope-audit.json          ← Runtime 后台程序自动分析并生成：实际修改范围 vs 获批 scope 的审计报告
```

### 9.3 Scope Audit (范围防越权机制)

系统会自动计算并比较代码到底改了什么，以此来决定 run 是否真正被接纳。

```json
{
  "taskId": "wp_xxx",
  "withinScope": false,
  "declaredScopeCount": 1,
  "observedChangedFiles": ["src/settings.ts", "package.json"],
  "outOfScopeFiles": ["package.json"]
}
```
此时 Run 虽然能够保存结果，但由于安全问题会提示警告。

---

## 10. 平台协议：Envelope 与 Manifest

- `TaskEnvelope`: V3 中定义目标、约束、以及治理参数（reviewRequired, maxRounds 等）
- `ResultEnvelope`: V3 中包含 Run 执行后的最终裁决 `decision`，对上游的警告 `risks` 等。
- `ArtifactManifest`: Runtime 在每步结束后自动生成的快照清单，追踪 `specs/`、`architecture/`、`review/` 甚至 `delivery/` 目录下每一个产出的文件。

---

## 11. 模型选择策略

通常，请选择 `Group Recommended` (每个组会绑定表现最好、成功率最高的预设模型配置)。当你执行复杂且涉及 Project 维度的规划任务时，系统可能会强制应用一些具有更强推理能力的大模型。

---

## 12. 常见问题与故障排查

### Q: "No approved runs available" 怎么办？
确保当前 Project/Workspace 中已经存在成功流转上游前置的 Run。如果没有一个经过 Reviewer 审批批准（`approved`）的技术方案，你无法直接派发 `autonomous-dev-pilot`。这种机制保护了代码质量不会向更复杂的混乱情况坍塌。

### Q: Delivery Packet 缺失导致 Run failed？
`autonomous-dev-pilot` 角色受工作流引擎验证。AI 必须写入 `delivery/delivery-packet.json`。如未执行到这一步意外终止，会导致 Run Failed。您可以通过点击界面的 **Open Conversation** 进去看隐藏子对话中的执行报错卡点。

### Q: 所有相关的数据存放位置在哪里？
当前版本：
- **主数据**：记录在全局目录 `~/.gemini/antigravity/gateway/storage.sqlite` 中，包含 `projects / runs / conversation_sessions / scheduled_jobs / deliverables`。
- **Run 级执行历史**：每次执行都有一份 `~/.gemini/antigravity/gateway/runs/{runId}/run-history.jsonl`，统一记录 provider session、消息、步骤、结果、交付物和校验事件。
- **运行时数据与产物目录**：项目内由 Runtime 管理至 `demolong/runs/<runId>/` 或 `demolong/projects/<projectId>/runs/<runId>/` 下。
- **Prompt/指令工作流存储**：全局存储在 `~/.gemini/antigravity/gateway/assets/workflows/` 下，跨项目共享。
- **模板配置**：`~/.gemini/antigravity/gateway/assets/templates/*.json` — 每个文件是一个完整的 Template（groups + pipeline 或 graphPipeline）。
- **子图定义**：`~/.gemini/antigravity/gateway/assets/templates/*.json`（`kind: 'subgraph'` 的文件）。
- **审查策略**：`~/.gemini/antigravity/gateway/assets/review-policies/*.json`。
- **Checkpoint 数据**：`~/.gemini/antigravity/gateway/projects/{projectId}/checkpoints/` 目录下。
- **执行日志**：`~/.gemini/antigravity/gateway/projects/{projectId}/journal.jsonl`。
- **旧 JSON registry 备份**：迁移后保留在 `~/.gemini/antigravity/gateway/legacy-backup/<timestamp>/`，运行时不再读写。

### Q: 为什么有些历史 Run 只能看到 transcript，不是完整过程？

因为完整的 `run-history.jsonl` 是在 SQLite + Jsonl cutover 后才成为统一真相源。

- **新 run**：会把 provider 过程、对话、产物、校验都写进 `run-history.jsonl`。
- **老 run**：只能从历史产物、旧 conversation、结果文件里补导入，所以通常只能恢复：
  - `conversation.message.user`
  - `conversation.message.assistant`
  - `result.discovered`
  - `artifact.discovered`
  - `verification.discovered`

如果你看到某条老 run 只有 transcript + 结果摘要，这是当前设计边界，不是读取失败。

---

## 13. Fan-out / Join 并行编排

### 13.1 什么是 Fan-out / Join

Fan-out / Join 是系统支持**并行工作拆分与汇合**的核心编排能力。它允许一个 Project 在某个 stage 处将工作拆分为多个并行子 Project，各自独立执行后再汇合到下一个 stage。

```
父 Project
  ├── planning stage （产出 work-packages.json）
  ├── fan-out stage  （读取 work-packages.json，为每个 package 创建子 Project）
  │     ├── 子 Project 0 ──→ 按 perBranchTemplateId 执行
  │     ├── 子 Project 1 ──→ 按 perBranchTemplateId 执行
  │     └── 子 Project N ──→ 按 perBranchTemplateId 执行
  ├── join stage     （等所有子 Project 完成后触发）
  └── integration stage （汇合后的集成工作）
```

### 13.2 Fan-out 工作机制

1. 上游 stage 完成后产出一个 JSON 文件（如 `docs/work-packages.json`），内含 work package 数组
2. fan-out stage 读取该文件
3. 为数组中的**每一项**创建一个独立的子 Project
4. 每个子 Project 使用 `perBranchTemplateId` 指定的模板独立运行
5. 每个子 Project 有自己的 `projectId`、`parentProjectId`、`branchIndex`

### 13.3 Join 工作机制

1. join stage 关联一个 fan-out stage（通过 `joinFrom` / `sourceNodeId`）
2. 当 `joinPolicy: 'all'` 时，所有分支子 Project 都 completed 后 join stage 才激活
3. join stage 被激活后执行汇合逻辑，然后触发下游 stage

### 13.4 在 pipeline[] 中的配置

```json
{
  "pipeline": [
    { "stageId": "project-planning", "title": "项目规划", "executionMode": "review-loop", "roles": [{ "id": "planner", "workflow": "/planner", "timeoutMs": 600000 }], "autoTrigger": true },
    {
      "stageId": "wp-execution",
      "title": "分发执行",
      "executionMode": "orchestration",
      "roles": [],
      "stageType": "fan-out",
      "upstreamStageIds": ["project-planning"],
      "fanOutSource": {
        "workPackagesPath": "docs/work-packages.json",
        "perBranchTemplateId": "wp-dev-template",
        "maxConcurrency": 3
      }
    },
    {
      "stageId": "convergence",
      "title": "汇合评估",
      "executionMode": "orchestration",
      "roles": [],
      "stageType": "join",
      "joinFrom": "wp-execution",
      "joinPolicy": "all"
    }
  ]
}
```

### 13.5 在 graphPipeline 中的配置

```json
{
  "graphPipeline": {
    "nodes": [
      { "id": "planning", "kind": "stage", "title": "项目规划", "executionMode": "review-loop", "roles": [{ "id": "planner", "workflow": "/planner", "timeoutMs": 600000 }], "autoTrigger": true },
      { "id": "wp-fanout", "kind": "fan-out", "executionMode": "orchestration", "roles": [],
        "fanOut": { "workPackagesPath": "docs/work-packages.json", "perBranchTemplateId": "wp-dev-template", "maxConcurrency": 3 } },
      { "id": "convergence", "kind": "join", "executionMode": "orchestration", "roles": [],
        "join": { "sourceNodeId": "wp-fanout", "policy": "all" } }
    ],
    "edges": [
      { "from": "planning", "to": "wp-fanout" },
      { "from": "wp-fanout", "to": "convergence" }
    ]
  }
}
```

### 13.6 子 Project 的数据结构

每个 fan-out 产生的子 Project 会包含以下关联信息：

| 字段 | 说明 |
|:-----|:-----|
| `parentProjectId` | 父 Project ID |
| `parentStageId` | 父 Project 的 fan-out stage ID |
| `branchIndex` | 在 fan-out 中的序号（0-based） |
| `templateId` | fan-out 配置中的 `perBranchTemplateId` |

### 13.7 并发控制 (`maxConcurrency`)

`maxConcurrency` 限制同时运行的分支数。超出限额的分支标记为 `queued`，前序分支完成后自动派发：

| 值 | 行为 |
|:---|:-----|
| 省略 / `0` | 全部分支同时派发（无限制） |
| `1` | 串行执行，一个接一个 |
| `N` | 最多 N 个分支同时运行 |

该值可以在 Template JSON 中静态配置，也可以通过 `templateOverrides` 在 dispatch 时动态覆写（见 13.9）。

### 13.9 运行时模板覆写 (`templateOverrides`)

V5.3 新增。在调用 `POST /api/agent-runs` 时，可通过 `templateOverrides` 字段动态覆写 Template JSON 中的**任意参数**，无需修改源文件：

```json
{
  "templateId": "universal-batch-template",
  "projectId": "proj-xxx",
  "workspace": "file:///Users/you/project",
  "prompt": "批量研究 10 个竞品",
  "templateOverrides": {
    "maxConcurrency": 10,
    "defaultModel": "MODEL_PLACEHOLDER_M47"
  }
}
```

**机制**：覆写通过 `structuredClone` + deep-merge 注入到 template 副本中，原始 asset 不受影响。覆写值持久化到 `project.pipelineState.templateOverrides`，在 Fan-out 初始派发和后续排队分支调度时均自动生效。

### 13.8 Join 汇总报告 (`fan-out-summary.json`)

Join 完成后，引擎在父 Project 目录自动生成 `fan-out-summary.json`：

```json
{
  "completedAt": "2026-03-29T10:00:00Z",
  "totalBranches": 5,
  "succeeded": 4,
  "failed": 1,
  "branches": [
    { "index": 0, "name": "模块 A", "status": "completed", "subProjectId": "...", "duration": "120s" },
    { "index": 1, "name": "模块 B", "status": "failed", "subProjectId": "...", "duration": "45s" }
  ]
}
```

> Integration 节点是可选的。如果模板中 join 后没有下游节点，Project 在 join 完成后即结束。

### 13.9 Universal Fan-out 与 Dual-Write 架构

对于大部分并行的批量调研、爬取或分析任务，无需再创建特定功能的模板，系统推荐使用内置的 `universal-batch-template` 结合通用打工人 (`research-worker`)，并遵循**双写 (Dual-Write) 隔离架构**。

**工作结构**：
1. **沙盒隔离区 (Sandbox)**：
   并行产生的所有引擎通信文件（例如底层强约束的 `result.json`）会被系统强制沙盒化，写入各自独立的 `ARTIFACT_ROOT_DIR`（例如 `demolong/projects/<projectId>/runs/<runId>/`）。深层 UUID 的物理隔离 100% 规避了高并发下 Worker 相互覆写状态文件导致的系统崩溃。
2. **人类阅览区 (Shared Deliverable)**：
   为了人类体验，`research-worker` 不仅会将底层协议写入沙盒，还会将**最终用于阅读的 Markdown 研究产物**，根据任务主题动态命名（如 `vue3-reactivity.md`），直接输出到工作区根目录的公共 `/research/` 文件夹。

**核心优势**：
- **永远拒绝模板膨胀**：一个 `universal-batch-template` 即可包打所有轻量级并行任务，零配置成本。
- **极简派发体验**：只需提供一个包含数据长列表的 Prompt，系统自动切片下发。
- **完美的验收体验**：40 个高并发任务结束后，人类用户无需钻进 40 个难以辨认的 UUID 沙盒抽屉，直接打开根目录 `/research/` 即可像阅读文件库一样集中审阅全部成果。
- **深层研究能力 (GitHub)**：`research-worker` 已内置专门的优化逻辑——如果遇到 GitHub 仓库的调研，它会主动使用终端命令把代码 `git clone` 到当前运行环境的临时目录（如 `/tmp` 或Artifacts文件夹），进而利用 `grep`、AST 解析等能力阅读底层源码，而不仅是浮于表面地检索在线 `README`。

### 13.10 Fan-out 场景下的 Pipeline 恢复

全部 6 个标准恢复动作（`recover` / `nudge` / `restart_role` / `cancel` / `skip` / `force-complete`）说明见 [§8.2 Pipeline 恢复动作](#82-pipeline-恢复动作)。

**Fan-out 特有场景**：Planner stage 的子会话已在 IDE 中完成工作，但 Watcher 断连导致 Pipeline 卡在 `planning: running`，无法自动触发 fan-out 分支。此时用 `force-complete` 手动推进：

```bash
curl -X POST http://localhost:3000/api/projects/<projectId>/resume \
  -H "Content-Type: application/json" \
  -d '{ "action": "force-complete", "stageId": "planning" }'
```

在前端 UI 中，每个 Stage 详情面板都有 **Force Complete** 按钮（橙色）可直接操作。

---

## 14. GraphPipeline 显式图格式

GraphPipeline 是 V5.1 引入的显式 DAG 定义格式，允许直接声明 `nodes[]` 和 `edges[]`，取代传统 `pipeline[]` 的线性隐式约定。

完整的 GraphPipeline 使用指南请参阅 **[GraphPipeline 完整指南](graph-pipeline-guide.md)**。

### 14.1 核心区别

| 特性 | `pipeline[]` | `graphPipeline` |
|:-----|:------------|:----------------|
| 依赖关系 | 隐式线性（前一个 → 后一个） | 显式 edge 声明 |
| 并行分支 | 通过 `upstreamStageIds` | 通过多条 from → to edge |
| 控制流节点 | 不支持 | 支持 gate / switch / loop |
| 可视化友好度 | 一般 | 好（有显式图结构） |
| AI 生成 | 不适合 | 适合（V5.3 生成的就是此格式） |
| 子图引用 | 不支持 | 支持 subgraph-ref |
| 边上条件 | 不支持 | 支持 |

### 14.2 格式共存

- 一个 template 要么用 `pipeline`，要么用 `graphPipeline`
- 如果两者都有，`graphPipeline` 优先，系统输出 warn
- 两者编译为**同一个 DagIR**，共享同一个运行时
- `pipeline[]` 不会被废弃，简单场景继续推荐使用
- 可通过 `POST /api/pipelines/convert` 在两种格式之间互转

### 14.3 快速入门

```json
{
  "id": "my-template",
  "kind": "template",
  "title": "示例模板",
  "graphPipeline": {
    "nodes": [
      { "id": "plan", "kind": "stage", "title": "规划", "executionMode": "review-loop", "roles": [{ "id": "planner", "workflow": "/planner", "timeoutMs": 600000 }], "autoTrigger": true },
      { "id": "dev", "kind": "stage", "title": "开发", "executionMode": "delivery-single-pass", "roles": [{ "id": "dev", "workflow": "/dev-worker", "timeoutMs": 1800000 }] },
      { "id": "review", "kind": "stage", "title": "评审", "executionMode": "review-loop", "roles": [{ "id": "reviewer", "workflow": "/code-reviewer", "timeoutMs": 600000 }] }
    ],
    "edges": [
      { "from": "plan", "to": "dev" },
      { "from": "dev", "to": "review" }
    ]
  }
}
```

---

## 15. 数据契约系统（V4.4）

V4.4 引入了类型化契约系统（Typed Contracts），让 stage 之间的数据传递从"约定 + 祈祷"升级为"定义 + 校验"。

### 15.1 核心概念

每个 stage 可以声明：

- **inputContract** — 期望从上游获得哪些 artifact
- **outputContract** — 承诺向下游提供哪些 artifact

系统在 **template 加载时**自动校验上下游契约兼容性，而不是等到运行时才暴露问题。

### 15.2 示例

```json
{
  "stageId": "project-planning",
  "executionMode": "review-loop",
  "roles": [{ "id": "planner", "workflow": "/planner", "timeoutMs": 600000 }],
  "contract": {
    "outputContract": [
      { "id": "plan", "kind": "report", "pathPattern": "docs/plan.md", "format": "md" },
      { "id": "work-packages", "kind": "data", "pathPattern": "docs/work-packages.json", "format": "json",
        "contentSchema": { "type": "array", "items": { "type": "object", "required": ["id", "name"] } } }
    ]
  }
}
```

### 15.3 校验规则

| 规则 | 说明 |
|:-----|:-----|
| Output→Input 兼容性 | 下游的每个 required inputContract 必须被上游 outputContract 满足 |
| Fan-out 契约对齐 | workPackageSchema 与 branch template 入口 inputContract 兼容 |
| Join merge 契约对齐 | branchOutputContract 与 join 下游 inputContract 兼容 |
| Artifact 路径冲突 | 同一 template 内不同 stage 的 pathPattern 不重叠 |
| stageType 一致性 | 非 fan-out stage 不应有 fanOutContract |

### 15.4 Lint API

```bash
# 校验特定 template 的契约
curl -X POST /api/pipelines/lint -d '{"templateId": "my-template"}'

# MCP
antigravity_lint_template(templateId: "my-template")
```

---

## 16. 高级控制流（V5.2）

V5.2 引入了受控的动态控制流原语——Gate、Switch、Loop，让编排引擎支持条件分支和有限循环。

### 16.1 Gate — 人工审批门

Gate 节点在上游完成后进入等待状态，必须有人工 approve/reject 才能继续：

```
上游 stage → [Gate] → 下游 stage
                ↑
          人工确认 API / MCP
```

操作方式：

```bash
# API
curl -X POST /api/projects/{pid}/gate/{nodeId}/approve \
  -d '{"action": "approve", "reason": "产出符合要求"}'

# MCP
antigravity_gate_approve(projectId, nodeId, decision: "approved")
```

`autoApprove: true` 可在开发调试时跳过人工确认。

### 16.2 Switch — 确定性条件分支

Switch 节点根据上游输出选择不同的下游路径。条件是**确定性表达式**（字段比较），不是 LLM 判断：

```
上游 → [Switch] ──条件A──→ Path A
                 ──条件B──→ Path B
                 ──default──→ Path C
```

条件类型：`always`、`field-exists`、`field-match`、`field-compare`。所有条件评估结果都记录到审计日志。

### 16.3 Loop — 有限循环

Loop 用 `loop-start` + `loop-end` 成对节点实现，必须有 `maxIterations` 上限：

```
[loop-start] → review → fix → [loop-end]
     ↑                           │
     └── 条件不满足 + 未达上限 ───┘
```

- 终止条件满足 → 跳出循环
- 达到上限 → 强制退出
- 每次迭代可自动创建 checkpoint

### 16.4 Checkpoint / Replay / Resume

系统在 loop 迭代和关键节点自动创建 checkpoint（项目状态快照）：

```bash
# 查看 checkpoint
curl /api/projects/{pid}/checkpoints

# 从 checkpoint 恢复
curl -X POST /api/projects/{pid}/checkpoints/{cpId}/restore

# 从最近 checkpoint 继续
curl -X POST /api/projects/{pid}/resume
```

每个项目最多保留 10 个 checkpoint，超出后最旧的自动清理。

### 16.5 Execution Journal

所有控制流决策都记录到 JSONL 格式的执行日志，支持查询和审计：

```bash
curl /api/projects/{pid}/journal
```

---

## 17. AI 辅助流程生成（V5.3）

V5.3 支持用自然语言描述项目目标，让 AI 生成 graphPipeline 草案。

### 17.1 核心原则

> AI 是建议者，不是执行者。所有 AI 生成的草案**必须人工确认**后才能保存为正式模板。

### 17.2 使用流程

```bash
# 1. 生成草案
curl -X POST /api/pipelines/generate \
  -d '{"goal": "构建微服务后端开发流程", "constraints": {"maxStages": 8}}'

# 返回：graphPipeline 草案 + 校验结果 + 风险评估 + draftId

# 2. 查看草案
curl /api/pipelines/generate/{draftId}

# 3. 确认保存（可选修改）
curl -X POST /api/pipelines/generate/{draftId}/confirm \
  -d '{"templateMeta": {"title": "微服务开发模板"}}'
```

### 17.3 风险评估

AI 生成后自动执行风险评估：

| 检查项 | 级别 | 说明 |
|:-------|:-----|:-----|
| stage 数 > 20 | critical | 过度复杂 |
| stage 数 > 10 | warning | 可能过度 |
| 缺失 `executionMode` / `roles` | critical | 不可执行 |
| `acceptedSourceStageIds` 引用不存在的 stage | critical | 不可执行 |
| fan-out 嵌套 | warning | 复杂度高 |
| loop > 3 次 | warning | 成本高 |
| switch 无 default | warning | 可能走不通 |

**critical 级别风险的草案无法保存。**

### 17.4 草案管理

- 草案存储在内存中，30 分钟过期
- 不得重复确认同一个草案
- MCP 工具 `antigravity_generate_pipeline`（readOnly）+ `antigravity_confirm_pipeline_draft`（destructive）

---

## 18. 可复用子图与资源配额（V5.4）

### 18.1 可复用子图

子图（Subgraph）允许把一组节点和边封装为可复用的模块，在多个模板中引用：

```json
// 子图定义
{
  "id": "code-review-subgraph",
  "kind": "subgraph",
  "title": "代码审查子图",
  "graphPipeline": {
    "nodes": [
      { "id": "review", "kind": "stage", "title": "代码评审", "executionMode": "review-loop", "roles": [{ "id": "reviewer", "workflow": "/code-reviewer", "timeoutMs": 600000 }] },
      { "id": "fix", "kind": "stage", "title": "返修", "executionMode": "delivery-single-pass", "roles": [{ "id": "dev", "workflow": "/dev-worker", "timeoutMs": 1800000 }] }
    ],
    "edges": [{ "from": "review", "to": "fix" }]
  },
  "inputs": [{ "id": "code-input", "nodeId": "review" }],
  "outputs": [{ "id": "review-output", "nodeId": "fix" }]
}
```

```json
// 在模板中引用
{
  "id": "my-review-ref",
  "kind": "subgraph-ref",
  "executionMode": "orchestration",
  "roles": [],
  "subgraphRef": { "subgraphId": "code-review-subgraph" }
}
```

子图在**编译时展开**为 IR 节点，节点 ID 自动加前缀避免冲突。

```bash
# 查看所有可用子图
curl /api/pipelines/subgraphs
```

### 18.2 资源配额策略

可以为 workspace / template / project 配置资源限制，防止 LLM 调用和 Agent 执行消耗失控：

```json
{
  "id": "project-limit",
  "kind": "resource-policy",
  "name": "项目级限制",
  "scope": "project",
  "targetId": "my-project-id",
  "rules": [
    { "resource": "runs", "limit": 50, "action": "block" },
    { "resource": "branches", "limit": 20, "action": "warn" },
    { "resource": "iterations", "limit": 15, "action": "block" }
  ]
}
```

```bash
# 检查当前 usage 是否超限
curl -X POST /api/pipelines/policies/check \
  -d '{"projectId": "xxx", "usage": {"runs": 15, "branches": 8, "iterations": 3, "stages": 10, "concurrentRuns": 2}}'

# MCP
antigravity_check_policy(projectId: "xxx", ...)
```

超限动作：`warn`（记录 + 继续）、`block`（拒绝 dispatch）、`pause`（暂停项目）。

---

## 19. 共享对话模式（V5.5）

### 19.1 概述

V5.5 引入了 **Shared Conversation Mode**，允许 review-loop 中的 author 角色在后续轮次复用已有的 conversation（cascade），而不是每次都新建独立对话。这大幅减少了重复的 system prompt + 代码上下文 + 上游产物注入，**预计节约 ~73% 的 input tokens**。

### 19.2 工作原理

```
Round 1:
  Author → createAndDispatchChild() → 新建 cascade-1  ← 正常行为
  Reviewer → createAndDispatchChild() → 新建 cascade-2  ← 始终独立

Round 2:
  Author → grpc.sendMessage(cascade-1, roleSwitchPrompt) ← 复用 cascade-1！
  Reviewer → createAndDispatchChild() → 新建 cascade-3  ← 始终独立

Round 3:
  Author → grpc.sendMessage(cascade-1, roleSwitchPrompt) ← 再次复用
  Reviewer → createAndDispatchChild() → 新建 cascade-4
```

**关键设计**：
- **Author 角色复用**：第 2 轮起 author 角色复用 Round 1 创建的 cascade，通过 `sendMessage` 追加角色切换 prompt
- **Reviewer 始终独立**：确保审查视角不受 author 上下文污染
- **Token 安全阀**：当单对话累计 token 估值超过阈值（默认 100K）时，自动回退到 isolated 模式

### 19.3 启用方式

**方式一：Per-Run API 参数**（推荐）

```json
POST /api/agent-runs
{
  "templateId": "development-template-1",
  "stageId": "product-spec",
  "workspace": "file:///Users/you/project",
  "prompt": "设计一个任务管理系统",
  "conversationMode": "shared"
}
```

**方式二：全局环境变量**

```bash
AG_SHARED_CONVERSATION=true        # 全局启用
AG_SHARED_CONVERSATION_TOKEN_RESET=100000  # Token 阈值（可选，默认 100000）
```

**方式三：Web UI**

在 Dispatch 面板中，当选择 `product-spec` 或 `architecture-advisory` stage 时，底部会出现 **Conversation Mode** 切换：
- **Isolated**（默认）：每个 role 独立 conversation，与当前行为一致
- **Shared (Beta)**：author 角色跨轮次复用 conversation

### 19.4 优先级

```
Per-Run API 参数 > 全局环境变量 > 默认 (isolated)
```

- `conversationMode: "shared"` → 即使环境变量未设，也使用 shared 模式
- `conversationMode: "isolated"` → 即使环境变量设了 `true`，也强制 isolated
- 省略 `conversationMode` → 看环境变量 `AG_SHARED_CONVERSATION`，如果也没设则 isolated

### 19.5 Token 节约量化

| 场景（3 轮审查 × 2 role） | Isolated | Shared | 节约 |
|:--------------------------|:---------|:-------|:-----|
| 子对话数 | 6 | 1 author + 3 reviewer = 4 | -33% |
| System prompt 注入 | ~30K tokens | ~20K | -33% |
| 代码上下文注入 | ~120K | ~40K | -67% |
| 上游产物注入 | ~90K | ~30K | -67% |
| **总 input tokens** | **~240K** | **~65K** | **~73%** |

### 19.6 适用范围

| Group 类型 | 适用？ | 说明 |
|:-----------|:-------|:-----|
| `review-loop`（product-spec, architecture-advisory） | ✅ | 核心生效场景 |
| `legacy-single`（coding-basic） | ❌ | 无多轮，无效果 |
| `delivery-single-pass`（autonomous-dev-pilot） | ❌ | 无 review loop |
| `orchestration` | ❌ | 由 DAG 编排，不经过 review loop |

### 19.7 限制与注意事项

1. **Gemini system instruction 不可更改**：shared 模式下角色切换依赖 user-turn prompt 中的显式指令分隔符，而非 system prompt 变更
2. **Token 安全阀**：超过 `AG_SHARED_CONVERSATION_TOKEN_RESET` 阈值后自动 fallback 到 isolated
3. **Beta 状态**：该功能标记为 Beta，建议先在非关键任务上验证

---

## 20. 多 Provider 支持（V6）

### 20.1 概述

V6 引入了 Provider Abstraction Layer，所有 AI 交互通过统一的 `TaskExecutor` 接口进行。`group-runtime` 在执行角色时调用 `resolveProvider()` 动态选择 Provider，不再硬编码 Antigravity gRPC。

### 20.2 支持的 Provider

| Provider ID | 执行器 | 协议 | 适用场景 |
|:-----------|:-------|:-----|:---------|
| `antigravity` | `AntigravityExecutor` | gRPC → Language Server | IDE 级任务，需要丰富工具和流式步骤 |
| `codex` | `CodexExecutor` | MCP → Codex CLI | 沙盒执行，无需 IDE，安全隔离 |
| `claude-code` | `ClaudeCodeExecutor` | Claude Code CLI → stream-json | Workspace 编码任务，支持 resume/append |
| `claude-api` | `ClaudeEngineAgentBackend` | 进程内 → Anthropic API | 无需外部 Runtime，API Key 即可用，内置工具执行 |
| `openai-api` | （预留） | — | 直接调用 OpenAI API |
| `custom` | （预留） | — | 自定义 Provider |

### 20.3 Provider 解析优先级

`resolveProvider(sceneOrLayer, workspacePath?)` 按以下顺序依次匹配：

| 优先级 | 来源 | 配置位置 | 示例 |
|:-------|:-----|:---------|:-----|
| 1 (最高) | Scene 覆盖 | `ai-config.json` → `scenes.{sceneId}` | `supervisor` 场景固定用 Antigravity |
| 2 | Department 覆盖 | `workspace/.department/config.json` → `provider` | 某部门统一用 Codex |
| 3 | Layer 默认 | `ai-config.json` → `layers.{layer}` | `execution` 层用 Codex |
| 4 (兜底) | 组织默认 | `ai-config.json` → `defaultProvider` | 默认 `antigravity` |

### 20.4 AI Layer 体系

| Layer | 场景 | 说明 |
|:------|:-----|:-----|
| `executive` | CEO AI 决策（预留） | 最高级别 |
| `management` | Supervisor 巡检、Evaluate 干预、记忆提取 | 管理层 |
| `execution` | Pipeline 任务执行（角色执行） | 实际干活 |
| `utility` | Review 决策解析、代码摘要 | 辅助功能 |

### 20.5 组织级配置

存放于 `~/.gemini/antigravity/ai-config.json`：

```json
{
  "defaultProvider": "antigravity",
  "defaultModel": null,
  "layers": {
    "executive": { "provider": "antigravity" },
    "management": { "provider": "antigravity" },
    "execution": { "provider": "antigravity" },
    "utility": { "provider": "antigravity" }
  },
  "scenes": {
    "supervisor": { "provider": "antigravity", "model": "MODEL_PLACEHOLDER_M47" },
    "nudge": {
      "provider": "codex",
      "constraints": { "timeout": 60000 }
    }
  }
}
```

### 20.6 部门级覆盖

在 `workspace/.department/config.json` 中设置 `provider` 字段即可覆盖：

```json
{
  "name": "后端研发",
  "type": "build",
  "provider": "codex",
  "tokenQuota": { "daily": 500000, "monthly": 10000000, "used": { "daily": 0, "monthly": 0 }, "canRequestMore": true }
}
```

### 20.7 Capability 差异

| 能力 | Antigravity | Codex | Claude Code | Claude API |
|:-----|:------------|:------|:------------|:-----------|
| 流式步骤数据 | ✅ | ❌ | ❌ | ❌ |
| 流式文本输出 | ✅ | ❌ | ❌ | ✅ |
| 多轮对话 | ✅ | ✅ | ✅ | ✅ |
| IDE 技能（重构/导航） | ✅ | ❌ | ❌ | ❌ |
| 沙盒执行 | ❌ | ✅ | ❌ | ❌ |
| 取消运行 | ✅ | ❌ | ✅ | ✅ |
| 实时步骤监听 | ✅ | ❌ | ❌ | ❌ |
| 无需外部 Runtime | ❌ | ❌ | ❌ | ✅ |
| 内置工具执行 | ❌ | ❌ | ❌ | ✅ |

> **注意**：
> - Codex 任务是同步执行的（`startSession` 阻塞直到完成），不支持实时步骤监听和取消。
> - Antigravity 是异步的（dispatch 后通过 `watchConversation` 监听完成）。
> - Claude API（`claude-api`）是进程内执行，不依赖外部 CLI 或 IDE，只需 `ANTHROPIC_API_KEY` 即可运行。

### 20.8 Claude Engine 内嵌基础层（M1-M8）

`src/lib/claude-engine/` 是 Claude Code 内嵌迁移的新子系统。当前已经落了八层基础能力，供后续把 Claude Code 的工具、上下文、权限、MCP 和 query loop 逐步迁入本仓库。

当前范围：

1. `types/message.ts`：消息块、StreamEvent、TokenUsage。
2. `types/permissions.ts`：权限模式、规则、决策。
3. `types/tool.ts`：Tool 接口、ToolContext、运行时 lookup helper。
4. `context/git-context.ts`：通过注入的 `exec` 提取 Git 仓库摘要。
5. `context/claudemd-loader.ts`：分层发现并加载 User / Project / Rules / Local 四类 CLAUDE.md 文件。
6. `context/context-builder.ts`：聚合日期、Git 摘要与 CLAUDE.md 内容，并格式化为 prompt 上下文。
7. `memory/memory-types.ts` + `memory/memory-paths.ts`：定义 4 种记忆类型、MEMORY.md 入口、per-project memory 目录与路径安全校验。
8. `memory/memory-scanner.ts` + `memory/memory-age.ts`：扫描 memory 目录中的 Markdown 记忆文件、解析 frontmatter，并生成 age / freshness 提示。
9. `memory/memory-store.ts`：封装 memory 目录创建、单文件读写删除、MEMORY.md 读写与 200 行 / 25KB 截断。
10. `memory/memory-prompt-builder.ts`：生成记忆系统提示，包含类型指导、禁止保存清单和 MEMORY.md 内容注入。
11. `memory/__tests__/memory.test.ts`：25 条 TDD 用例，锁定 M3 记忆层核心行为。
12. `context/__tests__/context.test.ts`：18 条 TDD 用例，锁定上下文层核心行为。
13. `tools/registry.ts`：提供独立 `ToolRegistry`、默认 registry、按 enabled/read-only 过滤的工具访问 helper。
14. `tools/file-read.ts`：读取文本文件，支持 `offset` / `limit` 截取、行号前缀和文件元数据返回。
15. `tools/file-write.ts`：整文件写入，自动创建父目录，并返回 create/update 类型与简单 diff 统计。
16. `tools/file-edit.ts`：按 `old_string` / `new_string` 做精确替换，默认拒绝多匹配未确认编辑。
17. `tools/bash.ts`：统一走 `ToolContext.exec()` 执行 shell，内置 timeout、输出截断、只读/破坏性命令分析。
18. `tools/glob.ts`：递归扫描目录并按 glob 模式返回相对文件列表，默认最多返回 200 条结果。
19. `tools/grep.ts`：通过 grep 搜索目录内容，支持大小写开关、上下文行和结果数限制。
20. `tools/index.ts`：统一导出 M4 工具层公共 API。
21. `tools/__tests__/tools.test.ts`：36 条 TDD 用例，锁定工具注册、文件读写编辑、bash、glob、grep 行为。
22. `permissions/types.ts`：定义权限行为、规则来源、规则值、裁决结构和来源优先级。
23. `permissions/rule-parser.ts`：解析 `Tool(content)` 规则字符串，提供 `parse / format / escape / unescape`。
24. `permissions/mcp-matching.ts`：解析 `mcp__server__tool` 名称，支持 server 级、`*` 通配和精确匹配。
25. `permissions/checker.ts`：提供内存态 `PermissionChecker`，支持 deny > ask > bypass/mode > allow > ask 顺序、session 规则和 mode 语义。
26. `permissions/index.ts`：统一导出 M5 权限层公共 API。
27. `permissions/__tests__/permissions.test.ts`：25 条 TDD 用例，锁定规则解析、MCP 匹配、mode 行为和 rule source priority。
28. `api/types.ts`：定义 `APIProvider`、`ModelConfig`、`QueryOptions`、`StreamEvent`、`APIResponse` 等 M6 API 合同。
29. `api/client.ts`：使用原生 `fetch` 直接调用 Anthropic Messages API，负责 headers/body 构建、SSE 解析，以及 `streamQuery()` / `query()` 两个入口。
30. `api/retry.ts`：提供指数退避 + jitter 的 `streamQueryWithRetry()` 包装器，并向上层暴露 retry event。
31. `api/tool-schema.ts`：把内部 `Tool` 定义转换成 Anthropic API `tools` 所需的 JSON Schema，优先复用 `inputJSONSchema`，否则做最小手动 zod 转换。
32. `api/usage.ts`：提供 `UsageTracker` 与模型定价表，用于 token usage 累加和 USD 成本估算。
33. `api/index.ts`：统一导出 M6 API 层公共 API。
34. `api/__tests__/api.test.ts`：37 条 TDD 用例，锁定 headers/body、SSE、`query()`、retry、tool schema 和 usage 行为。
35. `mcp/types.ts`：定义 `McpServerConfig`、`McpServerState`、`McpTool`、`McpResource`、`McpToolResult` 等 M7 合同。
36. `mcp/json-rpc.ts`：提供 JSON-RPC 2.0 helper，负责自增 ID、请求序列化、响应解析与通知识别。
37. `mcp/stdio-transport.ts`：提供 line-delimited JSON-RPC over stdio helper transport，单独锁定 `spawn()`、buffer splitting 与 pending request 行为。
38. `mcp/client.ts`：使用 `@modelcontextprotocol/sdk` 的 `Client` 和 `StdioClientTransport` 封装 stdio-only MCP client，自动完成 connect、工具/资源列表和工具调用。
39. `mcp/manager.ts`：管理多 server 连接，把 `McpTool` 转换为 `mcp__server__tool` 形式的 Claude Engine Tool，并代理实际调用。
40. `mcp/index.ts`：统一导出 M7 MCP 层公共 API。
41. `mcp/__tests__/mcp.test.ts`：25 条 TDD 用例，锁定 JSON-RPC helper、stdio transport、SDK-backed client 和 manager 路由行为。
42. `engine/types.ts`：定义 `EngineConfig`、`EngineEvent`、`TurnResult`、`ToolCallResult` 和 `StopReason` 等 M8 合同。
43. `engine/tool-executor.ts`：执行 `tool_use` 块，按并发安全性区分顺序执行与 `Promise.all` 并行执行，并将工具异常包装为 `isError=true` 的结果。
44. `engine/query-loop.ts`：实现核心 query loop，负责多 turn API 调用、流式内容块累积、工具执行、`tool_result` 回填到 user 消息和 token budget 检查。
45. `engine/claude-engine.ts`：提供维护对话历史和累计 usage 的高层封装，暴露 `chat()`、`chatSimple()`、`getMessages()`、`clearMessages()` 和 `getUsage()`。
46. `engine/index.ts`：统一导出 M8 查询引擎公共 API。
47. `engine/__tests__/engine.test.ts`：18 条 TDD 用例，锁定 ToolExecutor、queryLoop 和 ClaudeEngine 的核心行为。

当前边界：

1. 不依赖 React 或 AppState。
2. 不依赖 `bun:bundle` 或 Claude Code 仓库内部模块。
3. Git 操作通过注入 `exec` 完成，文件系统访问通过 loader options 注入，便于测试 mock。
4. M3 当前只覆盖本地文件型记忆 primitives，不包含 Claude Code 中的 LLM relevance selection 或 extraction agent。
5. M5 当前只覆盖内存态权限规则、MCP 前缀匹配和 mode 判定，不包含权限 UI、磁盘持久化、classifier 或 denial tracking。
6. M6 当前只覆盖 Anthropic 直连，不依赖 `@anthropic-ai/sdk`；`openai` / `bedrock` / `vertex` 仅保留 provider 接口和类型，未实现实际调用。
7. M6 当前不实现 OAuth、Bedrock/Vertex 鉴权适配，也不包含 provider 级 fallback。
8. M7 当前运行时主链优先使用 `@modelcontextprotocol/sdk` 的 `Client` 与 `StdioClientTransport`，只实现 stdio transport；SSE/HTTP 仅保留配置字段，未落地。
9. M7 当前不实现 OAuth、远程认证或真实 MCP server 端到端联调；`json-rpc.ts` 与 `stdio-transport.ts` 主要作为 repo 内轻量 helper / fallback primitive 保留并测试。
10. M8 当前只覆盖核心 query loop、tool execution loop 和高层 `ClaudeEngine` 封装；不实现消息压缩、streaming tool execution、UI/React 集成或默认执行器接管。
11. 当前基础层仍未迁入 LLM 侧记忆提取和非核心工具族。
12. M4 本地核心工具当前仅覆盖文本文件工具、bash、glob 和 grep；MCP 工具通过 M7 管理器桥接，不属于本地内建工具集。

---

## 21. OPC 组织治理（V6）

### 21.1 核心概念

OPC（One Person Company）将 Antigravity Gateway 从"代码工具"升级为"组织治理平台"：

| 物理概念 | OPC 映射 | 说明 |
|:---------|:---------|:-----|
| 电脑 | 总部 | 一台电脑 = 一个组织 |
| 文件夹 | 部门 | 每个 workspace = 一个部门 |
| 用户 | CEO | 最高决策者 |
| AI Agent | 员工 | 在部门内自主工作 |

### 21.2 Department（部门）

每个 workspace 可配置为一个部门。配置文件位于 `workspace/.department/config.json`。

#### 部门配置字段

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `name` | string | 部门名称 |
| `type` | string | 类型（`build`/`research`/`operations`/`ceo`） |
| `description` | string? | 部门定位（CEO 用于任务路由） |
| `skills` | DepartmentSkill[] | 技能清单 |
| `okr` | DepartmentOKR? | OKR 目标 |
| `templateIds` | string[]? | 可用 Pipeline 模板 |
| `provider` | `'antigravity' \| 'codex' \| 'claude-code'`? | 默认 Provider |
| `tokenQuota` | TokenQuota? | Token 配额 |
| `roster` | DepartmentRoster[]? | 角色花名册（UI 人格化） |

#### 部门记忆目录

```
workspace/.department/
├── config.json      ← 结构化配置
├── rules/           ← 部门规则（Source of Truth）
├── workflows/       ← 部门工作流
└── memory/          ← 持久记忆
    ├── knowledge.md ← 技术知识
    ├── decisions.md ← 决策日志
    └── patterns.md  ← 最佳实践
```

### 21.3 CEO Agent

CEO Agent 是用户与整个组织之间的桥梁。当前 API 入口主要用于状态查询与自然语言定时调度；更复杂的项目派发与跨部门协作，建议通过 CEO Workspace Workflow、MCP 或标准 `agent-runs` API 进行。

#### API 入口

```bash
curl -X POST http://localhost:3000/api/ceo/command \
  -H "Content-Type: application/json" \
  -d '{"command": "每天工作日上午 9 点让后端团队创建一个日报任务项目，目标是汇总当前进行中的项目与风险"}'
```

#### 支持的操作

| Action | 说明 |
|:-------|:-----|
| `info` | 汇总各部门 / 项目状态 |
| `create_scheduler_job` | 通过自然语言创建 Scheduler Job |
| `needs_decision` | 目标对象存在歧义，需要进一步澄清 |
| `report_to_human` | 当前兼容层不支持，提示转到 CEO Office 会话 |

### 21.4 Approval Framework（CEO 审批框架）

Agent 在需要超出权限的操作时，自动生成审批请求，通过 Web/Webhook/IM 通知 CEO。

#### 审批类型

| 类型 | 触发场景 |
|:-----|:---------|
| `token_increase` | 部门 Token 配额不足 |
| `tool_access` | 请求使用受限工具 |
| `provider_change` | 请求切换 Provider |
| `scope_extension` | 请求扩大写入范围 |
| `pipeline_approval` | Pipeline gate 节点卡点 |
| `proposal_publish` | Evolution proposal 发布审批 |

#### 通知通道

| 通道 | 交互方式 |
|:-----|:---------|
| Web UI | Dashboard 审批页面，一键批准/拒绝 |
| Webhook (Slack/Discord) | Block Kit 按钮，一键操作 |
| IM (WeChat ACP) | 微信消息 + 审批链接 |

#### API

```bash
# 查看待审批列表
curl http://localhost:3000/api/approval

# 批准审批
curl -X PATCH "http://localhost:3000/api/approval/{id}" \
  -H "Content-Type: application/json" \
  -d '{"action": "approved", "message": "同意"}'

# 提交反馈
curl -X POST "http://localhost:3000/api/approval/{id}/feedback" \
  -H "Content-Type: application/json" \
  -d '{"message": "请附上成本估算"}'
```

### 21.5 Token 配额

每个部门可配置 Token 使用上限：

| 字段 | 说明 |
|:-----|:-----|
| `daily` | 每日 Token 上限 |
| `monthly` | 每月 Token 上限 |
| `used.daily` / `used.monthly` | 当前已使用量 |
| `canRequestMore` | 是否允许向 CEO 申请增额 |

Gateway 在 dispatch 任务前自动检查配额。配额不足时：
- 如果 `canRequestMore = true`，自动生成 `token_increase` 审批请求
- 如果 `canRequestMore = false`，任务直接标记为 `blocked`

### 21.6 Department API 参考

| 端点 | 方法 | 说明 |
|:-----|:-----|:-----|
| `/api/departments?workspace=<uri>` | GET | 获取部门配置 |
| `/api/departments?workspace=<uri>` | PUT | 更新部门配置 |
| `/api/departments/sync` | POST | 同步部门状态 |
| `/api/departments/digest` | GET | 部门摘要 |
| `/api/departments/quota` | GET | 配额查询 |
| `/api/departments/memory` | GET / POST | 部门记忆读写 |

---

## 22. Security Framework（V6）

### 22.1 概述

V6 引入了 4 层安全机制，保护 Agent 工具执行的安全性。所有工具调用经过统一入口 `checkToolSafety()` 串行检查，任一层失败即拒绝执行。

### 22.2 安全层级

| 层级 | 模块 | 职责 |
|:-----|:-----|:-----|
| L1 | Bash Safety | 命令模式匹配，阻止危险命令（`rm -rf /`、`curl \| bash`），检测注入（`$()` 嵌套、控制字符） |
| L2 | Permission Engine | 权限规则评估：`allow` / `deny` / `ask`，4 种策略模式叠加 |
| L3 | Hook Runner | `PreToolUse` / `PostToolUse` 拦截器，支持注册自定义 Hook |
| L4 | Sandbox Manager | 文件系统读写控制 + 网络访问控制 + 路径遍历防护 |

### 22.3 权限模式

| 模式 | 行为 | 适用场景 |
|:-----|:-----|:---------|
| `bypass` | 跳过所有检查 | 开发/调试环境 |
| `strict` | 只允许明确 `allow` 的工具 | 生产环境、高安全需求 |
| `permissive` | 只阻止明确 `deny` 的工具 | 一般使用 |
| `default` | 按规则评估，未匹配时询问 | 标准模式 |

> **OPC 特殊规则**：在 OPC 自动化上下文中，`ask`（询问用户）等同于 `deny`（拒绝），因为无人交互。

### 22.4 Hook 系统

Hook 允许在工具执行前后注入自定义逻辑：

```typescript
// 注册 Hook
registerHook({
  event: 'PreToolUse',
  toolName: 'BashTool',
  priority: 10,
  handler: async (context) => {
    // 自定义检查逻辑
    return { allow: true };  // 或 { allow: false, reason: '...' }
  }
});
```

**设计决策**：Hook 执行失败时采用 **fail-open** 策略 — 不阻塞工具执行，仅记录日志。

### 22.5 Sandbox 控制

| 控制维度 | 说明 |
|:---------|:-----|
| 文件写入 | 限制写入范围到 workspace 内 |
| 文件读取 | 可配置允许/禁止读取特定路径 |
| 网络访问 | 可配置允许/禁止的域名列表 |
| 路径遍历 | 规范化路径后检查是否在允许范围内 |

### 22.6 安全策略配置

策略文件位于 `workspace/.security/policy.json` 或组织级 `~/.gemini/antigravity/security-policy.json`：

```json
{
  "mode": "default",
  "rules": [
    { "tool": "BashTool", "action": "ask", "conditions": { "command": "rm *" } },
    { "tool": "FileWriteTool", "action": "allow", "conditions": { "path": "src/**" } }
  ],
  "sandbox": {
    "writableRoots": ["src/", "tests/"],
    "blockedDomains": ["*.evil.com"]
  }
}
```

---

## 23. 定时任务调度（V6）

### 23.1 概述

Scheduler 支持 cron 风格的定时任务，可自动触发 Pipeline / Stage 执行或项目健康检查。

当前 UI 可见性分层：

1. **OPC / Projects**：循环任务概览
2. **CEO Dashboard**：最近 scheduler activity
3. **Ops / SchedulerPanel**：完整任务列表与编辑入口

### 23.2 任务类型

| 类型 | 说明 | 触发方式 |
|:-----|:-----|:---------|
| `cron` | 按 cron 表达式周期触发 | `cronExpression: "0 9 * * 1-5"` |
| `interval` | 按固定间隔触发 | `intervalMs: 3600000` |
| `once` | 一次性执行 | `scheduledAt: "2026-04-05T10:00:00Z"` |

### 23.3 Action 类型

| Action Kind | 说明 | 参数 |
|:-----------|:-----|:-----|
| `dispatch-pipeline` | 派发 Pipeline 模板或指定 Stage | `templateId`, `workspace`, `prompt`，可选 `stageId` |
| `dispatch-prompt` | 定时 Prompt Mode 执行 | `workspace`, `prompt`，可选 `promptAssetRefs`, `skillHints`, `projectId` |
| `dispatch-execution-profile` | 按统一 `ExecutionProfile` 触发 | `workspace`, `prompt`, `executionProfile`，可选 `projectId` |
| `health-check` | 项目健康检查 | `projectId` |
| `create-project` | 定时创建 Ad-hoc Project | `departmentWorkspaceUri`, `opcAction.goal`，可选 `opcAction.skillHint`, `opcAction.templateId` |

说明：

- `dispatch-execution-profile` 的目标，是让 scheduler 和后续 UI 不必继续只围绕 `dispatch-prompt / dispatch-pipeline` 说话。
- 当前支持：
  - `workflow-run`
  - `review-flow`
  - `dag-orchestration`

### 23.4 OPC 集成

Scheduler 任务可关联 OPC 部门：

```json
{
  "name": "每日代码审查",
  "type": "cron",
  "cronExpression": "0 9 * * 1-5",
  "action": { "kind": "create-project" },
  "departmentWorkspaceUri": "file:///Users/darrel/Projects/backend",
  "opcAction": {
    "type": "create_project",
    "projectType": "adhoc",
    "goal": "审查昨日提交的代码",
    "skillHint": "code-review",
    "templateId": "coding-basic-template"
  }
}
```

### 23.5 API 参考

| 端点 | 方法 | 说明 |
|:-----|:-----|:-----|
| `/api/scheduler/jobs` | GET | 定时任务列表 |
| `/api/scheduler/jobs` | POST | 创建定时任务 |
| `/api/scheduler/jobs/:id` | GET / PATCH / DELETE | 任务 CRUD |
| `/api/scheduler/jobs/:id/trigger` | POST | 手动触发执行 |

### 23.6 MCP 工具

在 MCP Server 中，Scheduler 相关工具现在包括：

1. `antigravity_list_scheduler_jobs`
2. `antigravity_create_scheduler_job`
3. `antigravity_update_scheduler_job`
4. `antigravity_trigger_scheduler_job`
5. `antigravity_delete_scheduler_job`

### 23.7 CEO Office 自然语言创建

CEO Dashboard 中新增了“用一句话创建定时任务”入口，推荐直接输入：

1. `每天工作日上午 9 点让市场部创建一个日报任务项目，目标是汇总当前进行中的项目与风险`
2. `每周一上午 10 点巡检项目 Alpha 的健康度`
3. `明天上午 9 点让设计部创建一个 ad-hoc 项目，目标是整理 backlog`

Web UI 会调用 `POST /api/ceo/command`，后端自动翻译成标准 Scheduler Job。

如果这是 `create-project` 类调度，系统会尽量在创建时就把 auto-dispatch 模板写入 `opcAction.templateId`；后续触发时不再临时猜模板。

### 23.8 CEO Workflow

CEO Workspace 现在有两份定时调度相关 workflow：

1. `ceo-playbook.md`：主决策入口
2. `ceo-scheduler-playbook.md`：定时任务专用分支

当用户提到“每天 / 每周 / 明天 / 定时 / cron / 自动执行”时，CEO 应优先使用 `ceo-scheduler-playbook.md`，而不是让用户手填原始 cron 表达式、workspace 或 prompt。
如果 playbook / LLM 解析当前不可用，系统不会自动退回到业务 regex 路由层替 CEO 做部门 / template / prompt 决策。

### 23.9 CEOProfile 与 Routine Summary

当前系统已经新增最小 `CEOProfile` 持久状态能力，主要包括：

1. `priorities`
2. `activeFocus`
3. `communicationStyle`
4. `recentDecisions`
5. `feedbackSignals`

对应接口：

1. `GET /api/ceo/profile`
2. `PATCH /api/ceo/profile`
3. `POST /api/ceo/profile/feedback`
4. `GET /api/ceo/routine`
5. `GET /api/ceo/events`

说明：

- `ceo-agent.ts` 在处理命令后会把最近决策和当前关注点写回 `CEOProfile`
- `routine summary` 会汇总：
  - active projects
  - pending approvals
  - active schedulers
  - recent knowledge
- `ceo events` 会聚合：
  - project lifecycle 事件
  - approval 事件
  - scheduler 事件
  - knowledge 沉淀事件

### 23.9.1 Management Overview

当前还新增了一个最小经营概览 API：

1. `GET /api/management/overview`
2. `GET /api/management/overview?workspace=<workspaceUri>`

作用：

- 组织级总览
- 部门级指标概览

当前 `CEO Dashboard` 与部门详情面板已开始展示：

- active/completed/failed/blocked
- pending approvals
- active schedulers
- recent knowledge
- throughput 30d
- workflow hit rate

### 23.10 结构化 Knowledge Assets

当前知识系统已从“只有 Markdown 文件”升级为：

1. **结构化主存储**：`storage.sqlite` 的 `knowledge_assets`
2. **兼容镜像目录**：`~/.gemini/antigravity/knowledge/`

这意味着现在存在两层语义：

1. `/api/departments/memory`
   - 面向传统 Markdown 部门记忆
2. `/api/knowledge*`
   - 面向结构化知识资产与文件镜像兼容视图

当前 `Department Memory` 页面已经开始显示：

- `Recent Knowledge Assets`

用于展示最近自动沉淀出的结构化知识资产。

### 23.11 Evolution Pipeline v1

当前系统已经新增最小 `Evolution Pipeline` 主链，用于把知识沉淀进一步升级为受控演化：

1. `Proposal Generator`
   - 从 `KnowledgeAsset(status=proposal)` 与 repeated prompt runs 生成 workflow/skill proposal
2. `Replay Evaluator`
   - 用历史 runs 做样本匹配、成功率与阻塞率评估
3. `Approval Publish Flow`
   - proposal 不会直接上线，而是先创建 `proposal_publish` 审批请求
4. `Rollout Observe`
   - 发布后回看 adoption runs、命中率与最近使用时间

#### API

1. `GET /api/evolution/proposals`
2. `POST /api/evolution/proposals/generate`
3. `GET /api/evolution/proposals/:id`
4. `POST /api/evolution/proposals/:id/evaluate`
5. `POST /api/evolution/proposals/:id/publish`
6. `POST /api/evolution/proposals/:id/observe`

#### Proposal 核心字段

| 字段 | 说明 |
|:-----|:-----|
| `kind` | `workflow` / `skill` |
| `status` | `draft` / `evaluated` / `pending-approval` / `published` / `rejected` |
| `targetName` | 要发布的 canonical 资产名 |
| `targetRef` | workflow 为 `/name`，skill 为 `name` |
| `evidence` | knowledge signal 或 repeated runs 证据 |
| `evaluation` | 历史 run 评估结果 |
| `approvalRequestId` | 发布审批请求 ID |
| `rollout` | 发布后的 adoption observe |

#### UI 入口

当前以下前端入口已接入：

1. `CEO Dashboard`
   - 可直接 `Generate Proposals`
   - 对 `draft` proposal 执行 `Evaluate`
   - 对 `evaluated` proposal 发起 `Request Publish`
   - 对 `published` proposal 手动刷新 observe
2. `Knowledge Console`
   - 新增 `Proposal Signals` 卡片，用来观察待演化知识信号
