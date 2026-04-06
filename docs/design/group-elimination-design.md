# 设计文档：消除 Group 全局中间层

> **版本**: v1.1（审核修订版）  
> **日期**: 2026-04-06  
> **状态**: 审核后修订，建议按“模板内解析 + 渐进迁移”推进，不建议直接按 v1.0 一次性落地

---

## 0. 审核结论

### 0.1 结论摘要

这次代码审阅后的结论很明确：

1. **方向是对的**  
   当前真正的架构问题是 `group-registry.ts` + `AssetLoader.loadAllGroups()` 把本来属于 Template 内部的 `groups{}` 展平成全局 registry，导致 `groupId` 被错误地当成全局唯一标识。

2. **原 v1.0 方案低估了影响面**  
   `groupId` 和 `groups{}` 不是只存在于 runtime 内部，而是贯穿了：
   - 模板加载与校验
   - DAG / graphPipeline 编译
   - 项目状态与 Run 状态
   - 调度器、MCP、API
   - AI 模板生成链路
   - 前端模板浏览器 / 项目工作台 / Stage 详情面板

3. **不建议第一步就“全局清零 groupId”**  
   现在的 `groupId` 仍然是一个对外可见的执行标识：
   - `AgentRunState.groupId`
   - `PipelineStageProgress.groupId`
   - `dispatch-group`
   - MCP 工具参数
   - `/api/agent-runs?groupId=...`
   - 模板编辑器中的 Group 选择与复用

4. **建议修订为两层目标**
   - **P0 目标**：先消除“全局 Group registry”这层错误抽象
   - **P1 目标**：再引入 stage-inline / node-inline 的 normalized execution config
   - **P2 目标**：最后才决定是否删除 persisted `groups{}` 与外部 `groupId`

### 0.2 审核后的推荐结论

**建议推进，但不按 v1.0 原计划直接做。**  

推荐的新路线是：

```text
先解决：Group 被错误做成全局 registry
再解决：Runtime 直接依赖 GroupDefinition
最后决定：Template JSON 是否真的要彻底去掉 groups{}
```

也就是说，**“消除 Group 全局中间层”应该先落在 lookup / runtime 层，而不是第一天就落在所有 public type / API / UI / AI prompt 上。**

---

## 1. 本次审核覆盖范围

本次已对下列关键代码路径完成审阅：

### 1.1 核心类型与加载

- `src/lib/agents/pipeline/pipeline-types.ts`
- `src/lib/agents/group-types.ts`
- `src/lib/agents/group-registry.ts`
- `src/lib/agents/asset-loader.ts`
- `src/lib/agents/project-types.ts`
- `src/lib/types.ts`

### 1.2 运行时与编排

- `src/lib/agents/dispatch-service.ts`
- `src/lib/agents/group-runtime.ts`
- `src/lib/agents/run-registry.ts`
- `src/lib/agents/project-registry.ts`
- `src/lib/agents/project-diagnostics.ts`
- `src/lib/agents/scheduler.ts`
- `src/lib/agents/scheduler-types.ts`
- `src/lib/agents/fan-out-controller.ts`
- `src/app/api/projects/[id]/resume/route.ts`

### 1.3 DAG / Graph / 编译层

- `src/lib/agents/pipeline/graph-pipeline-types.ts`
- `src/lib/agents/pipeline/dag-ir-types.ts`
- `src/lib/agents/pipeline/dag-compiler.ts`
- `src/lib/agents/pipeline/dag-runtime.ts`
- `src/lib/agents/pipeline/graph-compiler.ts`
- `src/lib/agents/pipeline/pipeline-graph.ts`
- `src/lib/agents/pipeline/pipeline-registry.ts`

### 1.4 AI 模板生成链路

- `src/lib/agents/pipeline-generator.ts`
- `src/lib/agents/generation-context.ts`
- `src/lib/agents/risk-assessor.ts`
- `src/app/api/pipelines/generate/[draftId]/confirm/route.ts`
- `src/lib/agents/ceo-prompts.ts`

### 1.5 API / MCP / 前端

- `src/app/api/pipelines/route.ts`
- `src/app/api/pipelines/[id]/route.ts`
- `src/app/api/agent-runs/route.ts`
- `src/mcp/server.ts`
- `src/components/template-browser.tsx`
- `src/components/template-stage-editor.tsx`
- `src/components/template-group-card.tsx`
- `src/components/project-workbench.tsx`
- `src/components/stage-detail-panel.tsx`
- `src/components/scheduler-panel.tsx`
- `src/components/agent-runs-panel.tsx`
- `src/components/deliverables-panel.tsx`

---

## 2. 审核后必须修正的认识

### 2.1 真正的问题不是“Template 内有 groups{}”

当前 Template JSON 里的 `groups{}` 本来就是**模板内局部定义**。  
真正出问题的是下面这一层：

```text
Template.groups{}
  → AssetLoader.loadAllGroups()
  → global flatten
  → getGroup(groupId)
  → runtime / AI / API 误以为 groupId 是全局唯一
```

因此，**先删除全局 registry 的收益最大**，而不是先删除 Template 内部的 `groups{}`。

### 2.2 原 v1.0 里不成立或不完整的判断

| 原判断 | 审核结论 | 原因 |
|:-------|:---------|:-----|
| `Pipeline 可视化无需改` | **不成立** | 前端不仅读 `pipeline[]`，还大量读 `tmpl.groups`、`stage.groupId`、`node.groupId` 来显示标题、编辑 Group、统计角色数 |
| `run.groupId 全局替换为 run.stageId` | **不建议作为 P0/P1** | `groupId` 目前仍是 Run 的执行语义标识；sourceContract、MCP、调度器、查询过滤都直接依赖它 |
| `GraphNode 直接删 groupId` | **影响被低估** | `graph-compiler`、`dag-ir-types`、`risk-assessor`、`generation-context`、`pipeline-generator` 都要求 node 具备 `groupId` |
| `AI 生成会立刻大幅简化` | **方向正确，但不能直接得到** | 当前生成 prompt/schema、风险评估、confirm route 全都围绕“available groups + generated groups”构建 |
| `acceptedSourceGroupIds → acceptedSourceStageIds` | **不能直接硬切** | 当前 source filtering 基于 `run.groupId` 做匹配，若强切 stageId，需要同时调整 run / contract / ad-hoc dispatch 语义 |
| `删除 /api/agent-groups 基本无风险` | **不能只看前端** | 前端确实没直接消费，但 MCP、脚本、外部调用以及文档兼容仍要评估 |
| `group-runtime.ts 改名 stage-runtime.ts 可顺手做` | **应后置** | 当前 import 面非常广，先改语义和解析方式，再改文件名，能避免额外 churn |

### 2.3 `groupId` 当前仍是“对外语义”，不是纯内部实现

当前代码中，`groupId` 不只是旧命名包袱，它还承担了这些职责：

- 作为 ad-hoc 单组派发参数：`dispatch-group`
- 作为 run 过滤条件：`/api/agent-runs?groupId=...`
- 作为 source contract 匹配键：`acceptedSourceGroupIds`
- 作为 MCP 工具输入/展示字段
- 作为模板编辑器和项目工作台的展示标题索引键
- 作为 AI 模板生成时“可选能力单元”的标识

所以它**可以被弱化**，但不应该在第一阶段被粗暴删除。

### 2.4 GraphPipeline 节点类型在原文中写错了

当前真实支持的 graph node kind 是：

```text
stage | fan-out | join | gate | switch | loop-start | loop-end | subgraph-ref
```

不是原文中的：

```text
stage | source | sink | switch | gate | loop
```

这一点必须修正文档，否则迁移计划会低估 graph compiler / subgraph 影响。

---

## 3. 修订后的目标定义

### 3.1 P0 目标：消除全局 Group registry

这一步是必须做的，也是收益最大的。

目标：

- runtime 不再通过 `getGroup(groupId)` 从全局 registry 查配置
- group lookup 必须回到 **template / stage / node 上下文**
- 彻底消除 `loadAllGroups()` 的 `first wins` 行为

### 3.2 P1 目标：引入“resolved execution config”

运行时不应该依赖 `GroupDefinition` 这个独立类型，而应该依赖**解析后的 stage execution config**。

也就是说：

```text
raw template (legacy groups{} / future inline)
  → normalize / resolve
  → runtime consumed shape
```

### 3.3 P2 目标：再决定 persisted schema 是否彻底 inline-only

这一步不要预设为必做。  
在完成 P0/P1 后，再根据以下事实决定：

- 是否接受同一 execution config 在多个节点重复粘贴
- 是否仍需要模板编辑器里的 Group 复用体验
- 是否仍需要 `dispatch-group` 这种外部语义
- AI 生成链路是否已经完成 schema 改造

结论是：

- **必须做**：消除全局 registry、让 runtime 从 template 上下文解析
- **可选再做**：彻底删除 persisted `groups{}`

---

## 4. 修订后的数据模型建议

### 4.1 不建议第一步直接重写所有 public type

推荐新增一个**内部 normalized model**，让 runtime 先切过去：

```typescript
export interface StageExecutionConfig {
  executionMode: 'legacy-single' | 'review-loop' | 'delivery-single-pass' | 'orchestration';
  roles: GroupRoleDefinition[];
  reviewPolicyId?: string;
  capabilities?: GroupCapabilities;
  sourceContract?: {
    acceptedSourceStageIds?: string[];
    acceptedSourceGroupIds?: string[]; // 兼容期保留
    requireReviewOutcome?: ('approved' | 'rejected' | 'revise-exhausted')[];
    autoIncludeUpstreamSourceRuns?: boolean;
    autoBuildInputArtifactsFromSources?: boolean;
  };
  defaultModel?: string;
}

export interface ResolvedStageDefinition {
  stageId: string;
  groupId?: string;          // 兼容字段，对外展示 / 查询 / ad-hoc 调度暂时保留
  title?: string;
  description?: string;
  execution: StageExecutionConfig;
  autoTrigger: boolean;
  triggerOn?: 'approved' | 'completed' | 'any';
  promptTemplate?: string;
  upstreamStageIds?: string[];
  stageType?: 'normal' | 'fan-out' | 'join';
  fanOutSource?: {
    workPackagesPath: string;
    perBranchTemplateId: string;
    maxConcurrency?: number;
  };
  joinFrom?: string;
  joinPolicy?: 'all';
  contract?: StageContract;
  fanOutContract?: FanOutContract;
  joinMergeContract?: JoinMergeContract;
}
```

### 4.2 Runtime 先吃 normalized model，而不是直接吃 raw TemplateDefinition

推荐新增 helper：

- `resolveStageDefinition(template, stageId)`
- `resolveGraphNodeDefinition(template, nodeId)`
- `resolveSourceContract(template, stageId)`
- `normalizeTemplateDefinition(rawTemplate)`

这样做的好处：

1. 旧格式和新格式都能被 runtime 接受
2. `dispatch-service`、`group-runtime`、`dag-runtime` 不需要再依赖全局 `getGroup()`
3. API / UI / AI 仍可保留兼容层，避免一次性爆炸式改动

### 4.3 `AgentRunState` / `PipelineStageProgress` 的建议

**审核建议：保留 `groupId`，新增/继续使用 `pipelineStageId`，而不是立刻删掉 `groupId`。**

建议如下：

```typescript
export interface AgentRunState {
  runId: string;
  groupId: string;          // 兼容与外部语义保留
  pipelineStageId?: string; // 当前真正的 stage 身份
  // ...
}

export interface PipelineStageProgress {
  stageId: string;
  groupId: string;          // 兼容展示与查询保留
  // ...
}
```

直到这些能力全部迁完，才考虑是否移除 `groupId`：

- run 查询 API
- scheduler `dispatch-group`
- MCP dispatch 参数
- sourceContract 过滤
- 前端展示与模板编辑器

---

## 5. 真实影响面

### 5.1 核心运行时

| 模块 | 影响 | 审核结论 |
|:-----|:-----|:---------|
| `group-registry.ts` | 全局 flatten lookup | **必须移除或改成 template-scoped resolver** |
| `asset-loader.ts` | 负责模板加载、校验、fallback、group flatten | **必须引入 normalize 层** |
| `dispatch-service.ts` | 由 template/stage 解析出 `groupId` 并校验 source contract | **P0 核心改动** |
| `group-runtime.ts` | 直接通过 `getGroup()` 获取 roles/executionMode/sourceContract | **P1 核心改动** |
| `run-registry.ts` | run 的外部语义仍基于 `groupId` | **先保留，后迁** |
| `project-registry.ts` | pipeline state 存了 `stageId + groupId` | **先兼容保留** |

### 5.2 DAG / Graph / Compiler

| 模块 | 影响 | 审核结论 |
|:-----|:-----|:---------|
| `pipeline/pipeline-types.ts` | `PipelineStage.groupId` 仍是核心字段 | **不能一刀切删除** |
| `pipeline/graph-pipeline-types.ts` | `GraphPipelineNode.groupId` 当前必填 | **P3 才能改 schema** |
| `pipeline/dag-ir-types.ts` | `DagNode.groupId` 参与 runtime、诊断、图展示 | **不能先删** |
| `pipeline/dag-runtime.ts` | source filtering 依赖 `node.groupId` → `run.groupId` | **需先改 resolver，再改 contract 语义** |
| `pipeline/graph-compiler.ts` | 校验 node 必须有 `groupId` | **P3 才改** |

### 5.3 AI 生成链路

| 模块 | 影响 | 审核结论 |
|:-----|:-----|:---------|
| `generation-context.ts` | 给 LLM 的上下文就是 available groups | **必须重构 prompt/schema** |
| `pipeline-generator.ts` | prompt 明确要求输出 `groupId`；草稿验证也补 `groups{}` | **P3 核心改动** |
| `risk-assessor.ts` | critical risk 是“unknown groupId” | **需改为 execution profile / inline config 校验** |
| `pipelines/generate/.../confirm/route.ts` | 目前会根据 node.groupId 反向生成 groups | **迁移时必须同步重写** |
| `ceo-prompts.ts` | 模板摘要里显式列出 groups | **需要兼容适配** |

### 5.4 API / MCP / 外部接口

| 模块 | 影响 | 审核结论 |
|:-----|:-----|:---------|
| `/api/agent-runs` | POST/GET 都直接暴露 `groupId` | **不能无兼容直接改** |
| `/api/pipelines` | summary 直接返回 `groups` | **前端强依赖** |
| `/api/pipelines/[id]` | detail 直接展开 `template.groups` | **前端强依赖** |
| `/api/projects/[id]/resume` | response 返回 `groupId` | **兼容字段暂保留** |
| `src/mcp/server.ts` | MCP tool 参数和输出显式使用 `groupId` | **外部接口，必须兼容** |
| `/api/agent-groups` | 前端未直接使用，但仍是公开路由 | **先标 deprecated，不要直接删** |

### 5.5 前端与运营体验

| 模块 | 影响 | 审核结论 |
|:-----|:-----|:---------|
| `template-browser.tsx` | 强依赖 `tmpl.groups`、`stage.groupId`、`node.groupId` | **不是“无需改”** |
| `template-stage-editor.tsx` | 通过 Group picker 选 stage.groupId | **P2/P3 需要重做交互** |
| `template-group-card.tsx` | 当前就是 Group 编辑器 | **若 persisted groups 删除，UI 必须改版** |
| `project-workbench.tsx` | 用 `templateGroups[groupId]` 显示标题 | **兼容层必须保留** |
| `stage-detail-panel.tsx` | 显示 `Group ID` | **文案与字段需要兼容处理** |
| `scheduler-panel.tsx` | 支持 `dispatch-group` | **外部能力，不能直接砍** |
| `agent-runs-panel.tsx` | 按 `groupId` 做筛选与快捷操作 | **需要迁移策略** |

---

## 6. 修订后的迁移计划

### Phase 0：建立 normalized resolver（必须先做）

**目标**：先把 runtime 从全局 `getGroup(groupId)` 解耦出来。

动作：

1. 在 `asset-loader.ts` 增加 normalize / resolve helper
2. 新增 template-scoped 解析函数，禁止 runtime 再通过全局 registry 查 Group
3. 保留 raw `groups{}` / `groupId` / 旧模板格式读取能力
4. 新增测试覆盖：
   - legacy template
   - graph template
   - duplicate groupId across templates
   - sourceContract 解析

**这一步完成后，就已经消除了 “first wins” 的核心风险。**

### Phase 1：Runtime 切换到 resolved stage config

**目标**：运行时只消费“解析后的 stage 配置”，不再消费 `GroupDefinition`。

动作：

1. `dispatch-service.ts`
   - 模板解析从 `template.pipeline / template.graphPipeline` 直接拿 stage/node
   - source contract 改为通过 resolved stage config 读取
2. `group-runtime.ts`
   - `getGroup()` 调用全部替换为 template-scoped resolver
   - `group.executionMode / group.roles / group.sourceContract` 替换为 resolved stage config
3. `pipeline/dag-runtime.ts`
   - `filterSourcesByNode()` 改用 node/stage resolver
4. `pipeline/pipeline-registry.ts`
   - 移除对全局 group lookup 的依赖
5. `project-diagnostics.ts`、`fan-out-controller.ts`、`scheduler.ts`
   - 统一通过 template context 获取执行配置

**阶段目标不是删除 `groupId`，而是删除“全局查 Group”的运行时依赖。**

### Phase 2：兼容层收口到 API / 前端

**目标**：保持前端可用，同时逐步把 FE 从 `groups{}` 强依赖迁到 stage/node execution config。

动作：

1. 后端 API 先提供双读/双写兼容：
   - detail API 可以返回 resolved execution fields
   - 同时继续返回 `groups` 供旧前端工作
2. 前端模板编辑器拆分为两步：
   - 先支持 stage/node 上直接查看 resolved execution config
   - 再决定是否删除独立 Group 编辑区域
3. 项目工作台 / Stage 详情 / Deliverables / Agent Runs
   - 所有 `groupId` 展示先改成“显示标题优先，groupId 兼容显示”
4. `dispatch-group`、`groupId` filter、MCP groupId 参数先保留

**这一步结束前，不要删 `/api/agent-groups`，只做 deprecated 标记。**

### Phase 3：AI 生成链路重构

**目标**：让 AI 生成链路真正支持 inline execution config，而不是只改 runtime。

动作：

1. `generation-context.ts`
   - 从 “available groups” 改为 “available workflows / execution building blocks”
2. `pipeline-generator.ts`
   - prompt/schema 改成输出 stage/node execution config
   - 不再要求所有节点必须给 `groupId`
3. `risk-assessor.ts`
   - 风险从 “unknown groupId” 改成 “missing execution config / missing role workflow”
4. `pipelines/generate/[draftId]/confirm/route.ts`
   - 不再反向根据 node.groupId 生成 `groups{}`
   - 改为直接保存 inline config，或在兼容期生成 hybrid template

**只有这一步做完，原文里“AI 生成会明显简化”的收益才会真实出现。**

### Phase 4：模板数据迁移

**目标**：迁移 persisted assets，但只在前 3 个阶段稳定后做。

动作：

1. 迁移所有模板源，而不是只写死“14 个文件”：
   - `GLOBAL_ASSETS_DIR/templates`
   - repo `.agents/assets/templates`
   - 与模板结构相关的测试 fixture / 草稿保存路径
2. 迁移脚本支持双模式：
   - legacy groups → hybrid normalized
   - hybrid → optional inline-only
3. source contract 兼容迁移：
   - `acceptedSourceGroupIds`
   - `acceptedSourceStageIds`
   - 迁移期双写，运行期双读

**注意：是否执行“inline-only 持久化”应在此阶段结束前再做决策，不要预先锁死。**

### Phase 5：清理与命名收尾

满足以下条件后，才进入清理：

- 前端不再依赖 `tmpl.groups`
- AI 生成链路不再要求 `groupId`
- MCP / scheduler / API 的兼容窗口完成
- run 查询与 source contract 已有替代语义

可清理项：

1. 删除 `group-registry.ts`
2. 删除 `loadAllGroups()` 与 `FALLBACK_GROUPS`
3. 评估 `/api/agent-groups` 是否下线
4. 评估 `group-runtime.ts` 是否改名
5. 评估 `groupId` 是否从 public type 中下线

---

## 7. 验证计划

### 7.1 必跑测试

至少覆盖这些测试簇：

- `src/lib/agents/pipeline/dag-runtime.test.ts`
- `src/lib/agents/pipeline/graph-compiler.test.ts`
- `src/lib/agents/pipeline-generator.test.ts`
- `src/app/api/pipelines/[id]/route.test.ts`
- `src/app/api/pipelines/generate/[draftId]/confirm/route.test.ts`
- `src/lib/agents/project-diagnostics.test.ts`
- `src/lib/agents/project-reconciler.test.ts`

### 7.2 必做手工回归

1. 模板列表、模板详情、模板编辑保存
2. graphPipeline 模板生成、确认、再次打开
3. 普通 pipeline 派发
4. source run 驱动的下游自动派发
5. 项目工作台 Stage 展示
6. scheduler 的 `dispatch-pipeline` 与 `dispatch-group`
7. MCP 的 dispatch / run detail 工具

### 7.3 回滚策略

迁移期间必须保证：

- loader 支持 legacy 模板继续读取
- API 可以继续返回 `groups` 与 `groupId`
- persisted 模板迁移前保留原始备份
- runtime 先切 resolver，再切 schema；不要反过来

---

## 8. 风险矩阵（修订版）

| 风险 | 概率 | 影响 | 缓解 |
|:-----|:-----|:-----|:-----|
| 只改 runtime，不改 AI/前端，导致系统“双语义”长期失控 | 高 | 高 | 按阶段推进，但每阶段设完成边界 |
| 过早删除 `groupId`，破坏调度器 / MCP / 查询接口 | 中 | 高 | 保留兼容字段，先迁调用方 |
| source contract 从 groupId 切 stageId 后，ad-hoc run 无法匹配 | 中 | 高 | 迁移期双字段双读 |
| persisted `groups{}` 过早删除，模板编辑器不可用 | 高 | 中 | 先做 API/前端兼容层 |
| graphPipeline / subgraph 节点语义迁移不完整 | 中 | 高 | 单独测试 graph compiler、subgraph、risk assessor |
| 同一 group 在多个节点复用时，inline-only 带来配置重复 | 高 | 中 | 在 Phase 4 前重新评估是否真要 inline-only |

---

## 9. 最终建议

### 9.1 建议审批的版本

**批准 v1.1 的迁移方向，不批准 v1.0 的一次性重写方案。**

### 9.2 推荐实施顺序

```text
第 1 步：去掉全局 group registry
第 2 步：runtime 使用 resolved stage config
第 3 步：补 API / 前端兼容层
第 4 步：重构 AI 生成链路
第 5 步：再决定 persisted groups{} 是否完全删除
```

### 9.3 这份修订版要解决的核心问题

不是“立刻把所有 Group 文本替换成 Stage”，  
而是：

1. **让执行配置回到 template 上下文**
2. **让 runtime 不再依赖全局 registry**
3. **让 schema 迁移与 API/UI/AI 迁移解耦**

这样做，既能解决当前真实 bug，也能避免一次性改穿所有层导致的高风险回归。
