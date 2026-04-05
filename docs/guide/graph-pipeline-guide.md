# GraphPipeline 完整指南

> 适用版本：V5.1+  
> 前置知识：了解 Template、Pipeline、Agent Group 基本概念

---

## 1. 什么是 GraphPipeline

GraphPipeline 是 V5.1 引入的 **显式图定义格式**，用于取代传统 `pipeline[]` 数组来定义 DAG（有向无环图）拓扑。

两种格式的关系：

```
pipeline[]       ──→ compilePipelineToIR()     ──→ DagIR（统一运行时）
graphPipeline    ──→ compileGraphPipelineToIR() ──→ DagIR（统一运行时）
```

它们编译到同一套 **DagIR（V5.0）** 后共享同一个运行时引擎——**不存在第二套 runner**。

### 为什么需要 GraphPipeline

传统 `pipeline[]` 的局限：

| 问题 | 说明 |
|:-----|:-----|
| 依赖关系隐式 | 默认线性假设：第 N 个 stage 依赖第 N-1 个 |
| 边不可见 | 没有显式 edge 定义——边从 `upstreamStageIds` 隐式推导 |
| 复杂拓扑难读 | 多入多出的 DAG 用数组表达可行但可读性差 |
| 控制流受限 | 无法直观定义 gate、switch、loop 等 V5.2 节点 |
| 边上无数据 | 不支持边上的条件或数据映射 |

GraphPipeline 用**显式 nodes + edges** 消除这些问题。

### 何时选用哪种格式

| 场景 | 推荐格式 |
|:-----|:---------|
| 线性的 3~5 个 stage | `pipeline[]` — 简洁够用 |
| 需要并行分支 | `graphPipeline` — 边关系更清晰 |
| 使用 gate / switch / loop | `graphPipeline` — 必须 |
| AI 生成的流程 | `graphPipeline` — V5.3 生成的就是此格式 |
| 引用子图（subgraph-ref） | `graphPipeline` — 必须 |
| 已有旧模板、不想迁移 | `pipeline[]` — 继续支持，不废弃 |

---

## 2. 格式定义

### 2.1 顶层结构

GraphPipeline 由两个数组组成：

```json
{
  "graphPipeline": {
    "nodes": [ ... ],
    "edges": [ ... ]
  }
}
```

它放在 `TemplateDefinition` 的 `graphPipeline` 字段中。一个 template **不能同时使用 `pipeline` 和 `graphPipeline`**——如果两者都提供，系统会使用 `graphPipeline` 并输出警告。

### 2.2 Node（节点）

每个节点代表一个执行步骤：

```json
{
  "id": "planning",
  "kind": "stage",
  "groupId": "project-planning",
  "label": "项目规划",
  "autoTrigger": true,
  "triggerOn": "completed",
  "contract": {
    "outputContract": [
      { "id": "plan", "kind": "report", "pathPattern": "docs/plan.md", "format": "md" }
    ]
  }
}
```

**必填字段**：

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `id` | string | 全局唯一节点 ID |
| `kind` | string | 节点类型（见下） |
| `groupId` | string | 关联的 Agent Group ID |

**可选字段**：

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `label` | string | 显示名称（UI / 诊断） |
| `autoTrigger` | boolean | 是否自动触发（默认 true） |
| `triggerOn` | `'approved' \| 'completed' \| 'any'` | 上游何种状态触发本节点 |
| `promptTemplate` | string | Prompt 模板覆盖 |
| `contract` | StageContract | 输入/输出数据契约（V4.4） |

### 2.3 Node Kind（节点类型）

| Kind | 版本 | 说明 |
|:-----|:-----|:-----|
| `stage` | V5.1 | 普通 Agent 执行节点 |
| `fan-out` | V5.1 | 将工作拆分为多个并行子项目 |
| `join` | V5.1 | 等待所有并行分支完成后汇合 |
| `gate` | V5.2 | 人工审批门——上游完成后等待人工确认 |
| `switch` | V5.2 | 确定性条件分支——根据上游输出选择路径 |
| `loop-start` | V5.2 | 循环入口 |
| `loop-end` | V5.2 | 循环出口——评估终止条件 |
| `subgraph-ref` | V5.4 | 引用可复用子图 |

**Kind 专属配置**：

#### fan-out 节点

```json
{
  "id": "wp-execution",
  "kind": "fan-out",
  "groupId": "wp-executor",
  "fanOut": {
    "workPackagesPath": "docs/work-packages.json",
    "perBranchTemplateId": "wp-dev-template",
    "contract": {
      "workPackageSchema": { "type": "object", "required": ["id", "name"] }
    }
  }
}
```

fan-out 节点读取上游产出的 `workPackagesPath` JSON 文件，为每个 work package 创建一个子 Project。

#### join 节点

```json
{
  "id": "convergence",
  "kind": "join",
  "groupId": "convergence-review",
  "join": {
    "sourceNodeId": "wp-execution",
    "policy": "all"
  }
}
```

join 节点等待 `sourceNodeId` 指定的 fan-out 的所有分支完成后触发。

#### gate 节点（V5.2）

```json
{
  "id": "approval-gate",
  "kind": "gate",
  "groupId": "approval",
  "gate": {
    "autoApprove": false,
    "approvalTimeout": 3600000,
    "approvalPrompt": "请审批此阶段的产出"
  }
}
```

gate 节点在上游完成后进入 `waiting-approval` 状态，必须通过 API 或 MCP 工具手动 approve/reject：

```bash
# API 审批
curl -X POST /api/projects/{projectId}/gate/{nodeId}/approve \
  -d '{"action": "approve", "reason": "产出符合要求"}'
```

```
# MCP 工具
antigravity_gate_approve(projectId, nodeId, decision: "approved", reason: "...")
```

#### switch 节点（V5.2）

```json
{
  "id": "quality-check",
  "kind": "switch",
  "groupId": "router",
  "switch": {
    "branches": [
      {
        "label": "high-quality",
        "condition": { "type": "field-match", "field": "review.score", "value": "pass" },
        "targetNodeId": "deploy"
      },
      {
        "label": "needs-rework",
        "condition": { "type": "field-compare", "field": "review.score", "operator": "lt", "value": 60 },
        "targetNodeId": "rework"
      }
    ],
    "defaultTargetNodeId": "manual-review"
  }
}
```

条件类型（所有条件均为确定性计算，无 LLM 判断）：

| type | 说明 | 必填字段 |
|:-----|:-----|:---------|
| `always` | 始终 true | — |
| `field-exists` | 检查字段是否存在 | `field` |
| `field-match` | 字段值精确匹配 | `field`, `value` |
| `field-compare` | 字段值比较 | `field`, `operator`, `value` |

#### loop-start / loop-end 节点（V5.2）

```json
[
  {
    "id": "review-loop-start",
    "kind": "loop-start",
    "groupId": "loop-control",
    "loop": {
      "maxIterations": 3,
      "terminationCondition": { "type": "field-match", "field": "review.decision", "value": "approved" },
      "pairedNodeId": "review-loop-end",
      "checkpointPerIteration": true
    }
  },
  {
    "id": "review-loop-end",
    "kind": "loop-end",
    "groupId": "loop-control",
    "loop": {
      "maxIterations": 3,
      "terminationCondition": { "type": "field-match", "field": "review.decision", "value": "approved" },
      "pairedNodeId": "review-loop-start",
      "checkpointPerIteration": true
    }
  }
]
```

- loop-start 和 loop-end 必须成对出现
- `maxIterations` 必填——系统不允许无上限循环
- 每次迭代自动创建 checkpoint（可选）
- 达到上限强制退出

#### subgraph-ref 节点（V5.4）

```json
{
  "id": "code-review",
  "kind": "subgraph-ref",
  "groupId": "placeholder",
  "subgraphRef": {
    "subgraphId": "code-review-subgraph"
  }
}
```

引用一个预定义的可复用子图。编译时子图内的节点和边被展开到父 IR 中，节点 ID 自动加前缀避免冲突（如 `code-review.review-stage`）。

### 2.4 Edge（边）

每条边明确声明两个节点之间的依赖关系：

```json
{
  "from": "planning",
  "to": "development",
  "condition": "optional-expression",
  "dataMapping": { "output.planDoc": "input.requirements" }
}
```

**必填字段**：

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `from` | string | 上游节点 ID |
| `to` | string | 下游节点 ID |

**可选字段**：

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `condition` | string | 边上的条件表达式 |
| `dataMapping` | object | 数据映射（上游输出 → 下游输入） |

---

## 3. 完整示例

### 3.1 线性流程

等价于 `pipeline: [{planning}, {development}, {review}]`：

```json
{
  "id": "simple-linear",
  "kind": "template",
  "title": "简单线性流程",
  "graphPipeline": {
    "nodes": [
      { "id": "planning", "kind": "stage", "groupId": "project-planning", "autoTrigger": true },
      { "id": "development", "kind": "stage", "groupId": "development" },
      { "id": "review", "kind": "stage", "groupId": "code-review", "triggerOn": "approved" }
    ],
    "edges": [
      { "from": "planning", "to": "development" },
      { "from": "development", "to": "review" }
    ]
  }
}
```

### 3.2 Fan-out / Join 并行开发

```json
{
  "id": "parallel-dev",
  "kind": "template",
  "title": "并行开发流程",
  "graphPipeline": {
    "nodes": [
      { "id": "planning", "kind": "stage", "groupId": "project-planning", "autoTrigger": true },
      {
        "id": "wp-fanout", "kind": "fan-out", "groupId": "wp-executor",
        "fanOut": {
          "workPackagesPath": "docs/work-packages.json",
          "perBranchTemplateId": "wp-dev-template"
        }
      },
      {
        "id": "convergence", "kind": "join", "groupId": "convergence-review",
        "join": { "sourceNodeId": "wp-fanout", "policy": "all" }
      },
      { "id": "integration", "kind": "stage", "groupId": "integration-testing" }
    ],
    "edges": [
      { "from": "planning", "to": "wp-fanout" },
      { "from": "wp-fanout", "to": "convergence" },
      { "from": "convergence", "to": "integration" }
    ]
  }
}
```

### 3.3 带 Gate + Switch 的复杂流程

```json
{
  "id": "gated-switch",
  "kind": "template",
  "title": "审批 + 条件分支流程",
  "graphPipeline": {
    "nodes": [
      { "id": "planning", "kind": "stage", "groupId": "project-planning", "autoTrigger": true },
      { "id": "gate1", "kind": "gate", "groupId": "approval", "gate": { "autoApprove": false } },
      {
        "id": "router", "kind": "switch", "groupId": "router",
        "switch": {
          "branches": [
            { "label": "large", "condition": { "type": "field-compare", "field": "plan.stageCount", "operator": "gt", "value": 5 }, "targetNodeId": "wp-fanout" },
            { "label": "small", "condition": { "type": "field-compare", "field": "plan.stageCount", "operator": "lte", "value": 5 }, "targetNodeId": "simple-dev" }
          ],
          "defaultTargetNodeId": "simple-dev"
        }
      },
      { "id": "simple-dev", "kind": "stage", "groupId": "development" },
      {
        "id": "wp-fanout", "kind": "fan-out", "groupId": "wp-executor",
        "fanOut": { "workPackagesPath": "docs/work-packages.json", "perBranchTemplateId": "wp-dev-template" }
      },
      { "id": "wp-join", "kind": "join", "groupId": "convergence-review", "join": { "sourceNodeId": "wp-fanout", "policy": "all" } },
      { "id": "final-review", "kind": "stage", "groupId": "code-review" }
    ],
    "edges": [
      { "from": "planning", "to": "gate1" },
      { "from": "gate1", "to": "router" },
      { "from": "router", "to": "simple-dev" },
      { "from": "router", "to": "wp-fanout" },
      { "from": "simple-dev", "to": "final-review" },
      { "from": "wp-fanout", "to": "wp-join" },
      { "from": "wp-join", "to": "final-review" }
    ]
  }
}
```

### 3.4 循环审查流程

```json
{
  "id": "review-loop",
  "kind": "template",
  "title": "循环审查流程",
  "graphPipeline": {
    "nodes": [
      { "id": "dev", "kind": "stage", "groupId": "development", "autoTrigger": true },
      {
        "id": "loop-start", "kind": "loop-start", "groupId": "loop-control",
        "loop": { "maxIterations": 3, "terminationCondition": { "type": "field-match", "field": "review.decision", "value": "approved" }, "pairedNodeId": "loop-end", "checkpointPerIteration": true }
      },
      { "id": "review", "kind": "stage", "groupId": "code-review" },
      { "id": "fix", "kind": "stage", "groupId": "development" },
      {
        "id": "loop-end", "kind": "loop-end", "groupId": "loop-control",
        "loop": { "maxIterations": 3, "terminationCondition": { "type": "field-match", "field": "review.decision", "value": "approved" }, "pairedNodeId": "loop-start", "checkpointPerIteration": true }
      },
      { "id": "deploy", "kind": "stage", "groupId": "deployment" }
    ],
    "edges": [
      { "from": "dev", "to": "loop-start" },
      { "from": "loop-start", "to": "review" },
      { "from": "review", "to": "fix" },
      { "from": "fix", "to": "loop-end" },
      { "from": "loop-end", "to": "deploy" }
    ]
  }
}
```

---

## 4. 格式转换

系统提供了 `pipeline[]` 和 `graphPipeline` 之间的双向转换工具。

### 4.1 API 转换

```bash
# pipeline[] → graphPipeline
curl -X POST /api/pipelines/convert \
  -d '{"direction": "pipeline-to-graph", "pipeline": [...]}'

# graphPipeline → pipeline[]（拓扑排序后转线性格式）
curl -X POST /api/pipelines/convert \
  -d '{"direction": "graph-to-pipeline", "graphPipeline": {...}}'
```

### 4.2 MCP 转换

```
antigravity_convert_template(direction: "pipeline-to-graph", ...)
```

### 4.3 Round-trip 保证

`pipeline → graphPipeline → pipeline` 的转换经过 round-trip 测试验证，结构信息不丢失。

---

## 5. 校验

### 5.1 自动校验

GraphPipeline 在 template 加载时自动执行以下校验：

| 检查项 | 说明 |
|:-------|:-----|
| 节点 ID 唯一 | 不允许重复 ID |
| 必填字段 | `id`、`kind`、`groupId` |
| 边引用完整 | `from` 和 `to` 必须引用存在的节点 |
| 环检测 | 不允许循环依赖（loop-start/loop-end 除外） |
| Kind 配置一致 | fan-out 必须有 `fanOut`，join 必须有 `join` 等 |
| 契约校验 | 上下游 inputContract / outputContract 兼容性 |
| Loop 配对 | loop-start 和 loop-end 的 `pairedNodeId` 必须互相指向 |

### 5.2 手动校验

```bash
# API
curl -X POST /api/pipelines/validate \
  -d '{"template": {"id": "test", "graphPipeline": {...}}}'

# MCP
antigravity_validate_template(templateId: "test")
```

---

## 6. 数据契约（V4.4）

每个节点可以声明输入/输出数据契约，让系统在 template 加载时校验上下游数据兼容性：

```json
{
  "id": "planning",
  "kind": "stage",
  "groupId": "project-planning",
  "contract": {
    "outputContract": [
      {
        "id": "project-plan",
        "kind": "report",
        "pathPattern": "docs/project-plan.md",
        "format": "md",
        "description": "项目规划文档"
      },
      {
        "id": "work-packages",
        "kind": "data",
        "pathPattern": "docs/work-packages.json",
        "format": "json",
        "contentSchema": {
          "type": "array",
          "items": { "type": "object", "required": ["id", "name", "description"] }
        }
      }
    ]
  }
}
```

---

## 7. AI 生成（V5.3）

可以用自然语言描述项目目标，让 AI 自动生成 graphPipeline 草案：

```bash
# 生成
curl -X POST /api/pipelines/generate \
  -d '{"goal": "构建一个电商平台的全栈开发流程", "constraints": {"maxStages": 8, "allowFanOut": true}}'

# 查看草案
curl /api/pipelines/generate/{draftId}

# 确认保存
curl -X POST /api/pipelines/generate/{draftId}/confirm \
  -d '{"templateMeta": {"title": "电商开发模板"}}'
```

**重要约束**：AI 生成的是 **草案**，必须经过人工确认才能保存为正式模板。含 critical 级别风险的草案无法保存。

---

## 8. Checkpoint 与 Replay（V5.2）

在使用 loop 节点时，系统可以在每次迭代开始时自动创建 checkpoint。

```bash
# 查看项目所有 checkpoint
curl /api/projects/{projectId}/checkpoints

# 从某个 checkpoint 恢复
curl -X POST /api/projects/{projectId}/checkpoints/{checkpointId}/restore

# 从最近 checkpoint 继续
curl -X POST /api/projects/{projectId}/resume

# 从指定 checkpoint 重播
curl -X POST /api/projects/{projectId}/replay \
  -d '{"checkpointId": "xxx"}'
```

---

## 9. Execution Journal（V5.2）

所有控制流决策（节点激活、条件评估、gate 审批、loop 迭代、checkpoint 创建）都会记录到执行日志：

```bash
curl /api/projects/{projectId}/journal
```

日志事件类型：

| 事件 | 说明 |
|:-----|:-----|
| `node:activated` | 节点被激活 |
| `node:completed` | 节点完成 |
| `node:failed` | 节点失败 |
| `condition:evaluated` | 条件被评估 |
| `gate:decided` | Gate 审批决策 |
| `switch:routed` | Switch 路由决策 |
| `loop:iteration` | Loop 迭代 |
| `loop:terminated` | Loop 终止 |
| `checkpoint:created` | Checkpoint 创建 |
| `checkpoint:restored` | Checkpoint 恢复 |

---

## 10. 资源配额（V5.4）

可以为 workspace / template / project 配置资源限制：

```bash
# 检查是否超限
curl -X POST /api/pipelines/policies/check \
  -d '{"projectId": "xxx", "usage": {"runs": 15, "branches": 8}}'

# 查看已配置的策略
curl /api/pipelines/policies
```

超限时的动作：

| 动作 | 说明 |
|:-----|:-----|
| `warn` | 记录审计日志，继续执行 |
| `block` | 拒绝 dispatch |
| `pause` | 暂停项目 |
