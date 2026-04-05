# MASFactory 动态图流融合到 Antigravity Gateway — 集成设计方案

> **背景**：[masfactory-comparison.md](./masfactory-comparison.md) 指出 MASFactory 的核心优势在于动态图拓扑（VibeGraph）、Loop 组件和可视化调试器，而 Antigravity 强在持久化、多通道接入和 Supervisor Review 机制。本文档设计如何将 MASFactory 的动态图能力嫁接到 Antigravity Gateway。  
> **审阅调整**：本文档保留为探索性设计草案，不作为当前实现蓝图。基于当前代码，不能按文中的“双运行时 / 新增 MASFactory Graph Engine”直接施工，后续应以 [engine-roadmap.md](./engine-roadmap.md) 的单一 DAG runtime 路线为准。

---

## 架构目标

```
当前：
  用户 → Gateway API → group-runtime (固定 Stage Pipeline) → LS

目标：
  用户 → Gateway API → Stage Router
                           ├─ 固定 Stage Pipeline (现有，保留)
                           └─ MASFactory Graph Engine (新增)
                                ├─ Node/Edge 图执行
                                ├─ Loop + AgentSwitch
                                ├─ VibeGraph (AI 生成图)
                                └─ 每个 Node → 仍调用 LS/Codex 执行
```

关键原则：**不替换 LS 执行引擎**，保留 Antigravity 的黑盒执行能力。MASFactory 的图负责**编排**（决定谁、何时、传什么数据），LS/Codex CLI 负责**执行**（怎么做）。

---

## 审核调整建议

结合当前代码与路线文档，这份集成设计应补充以下修正：

- 不建议直接引入 `Stage Router -> 固定 Pipeline + MASFactory Graph Engine` 的双运行时结构。
- 更合理的目标是：`pipeline` 和未来 `graphTemplate` 都编译到同一个内部 DAG IR。
- `graphPipeline` / 图作者入口应晚于 `V4.4` contract layer 与 `V5.0` compiled DAG IR。
- `Loop / Switch` 不能先于 graph-level execution journal / checkpoint 落地。
- VibeGraph 只能在 draft / lint / publish 闭环成熟后引入，不能直接生成可执行模板。
- 可视化思路可以较早借鉴，但 visualizer 不应成为运行时设计的前置依赖。

如果后续继续使用本文档，请将其视为“能力来源与探索清单”，而不是逐阶段实施计划。

---

## Phase 1：Graph Pipeline — 用图结构替换线性 Stage

### 1.1 当前 Pipeline 的局限

```json
// Template JSON (固定线性):
{
  "pipeline": {
    "stages": [
      { "stageIndex": 0, "groupId": "product-spec" },
      { "stageIndex": 1, "groupId": "architecture-advisory" },
      { "stageIndex": 2, "groupId": "autonomous-dev-pilot" }
    ]
  }
}
```

无法表达：分支（"需要 UI 设计吗？"）、并行（"前后端同时开发"）、条件循环（"测试通过才继续"）。

### 1.2 目标：Graph Pipeline Template

新增 `"graphPipeline"` 字段，与现有 `"pipeline"` 字段兼容共存：

```json
// Template JSON (图结构，新增):
{
  "graphPipeline": {
    "nodes": [
      { "id": "pm",   "type": "stage", "groupId": "product-spec" },
      { "id": "arch", "type": "stage", "groupId": "architecture-advisory" },
      { "id": "dev",  "type": "stage", "groupId": "autonomous-dev-pilot" },
      { "id": "test", "type": "stage", "groupId": "autonomous-dev-pilot",
        "attributes": { "workflowOverride": "test-runner.md" } },
      { "id": "need_ui_check", "type": "agent-switch",
        "condition": { "need_ui": "The product requires a dedicated UI design phase" } },
      { "id": "ui",   "type": "stage", "groupId": "ux-review" },
      { "id": "test_loop", "type": "loop",
        "maxIterations": 3,
        "terminateConditionPrompt": "Are all tests passing?" }
    ],
    "edges": [
      ["pm", "need_ui_check"],
      ["need_ui_check", "ui",   { "gate": "need_ui" }],
      ["need_ui_check", "arch", { "gate": "default" }],
      ["ui", "arch"],
      ["arch", "dev"],
      ["dev", "test_loop"],
      ["test_loop", "test"],
      ["test", "test_loop"]
    ]
  }
}
```

### 1.3 新增文件：`graph-pipeline-runner.ts`

```
src/lib/agents/
├── group-runtime.ts           ← 现有：线性 Pipeline
├── graph-pipeline-runner.ts   ← 新增：图拓扑 Pipeline
└── graph-types.ts             ← 新增：GraphNode / GraphEdge 类型
```

`graph-pipeline-runner.ts` 核心逻辑（伪代码）：

```typescript
export class GraphPipelineRunner {
  private adjacency: Map<string, GraphEdge[]>;
  private nodeStates: Map<string, 'pending' | 'running' | 'done' | 'blocked'>;

  async runGraph(projectId: string, template: GraphPipelineTemplate): Promise<void> {
    const ready = this.findReadyNodes();   // 入度为 0 的节点
    for (const node of ready) {
      await this.runNode(node, projectId);
    }
  }

  private async runNode(node: GraphNode, projectId: string): Promise<void> {
    if (node.type === 'stage') {
      // 复用现有 group-runtime.ts 的 dispatchGroupRun()
      const run = await dispatchGroupRun({ groupId: node.groupId, ... });
      await watchRun(run.runId);
      this.markDone(node.id);
      this.activateDownstream(node.id);
    } else if (node.type === 'agent-switch') {
      // 调用 LLM 决定激活哪条 edge
      const decision = await evaluateSwitch(node, this.getInputContext(node.id));
      this.applyGates(node.id, decision);
    } else if (node.type === 'loop') {
      // 检查终止条件
      const shouldTerminate = await evaluateTermination(node, this.getInputContext(node.id));
      if (!shouldTerminate && node.currentIteration < node.maxIterations) {
        node.currentIteration++;
        // 重新激活 loop 内部节点
        this.activateLoopBody(node.id);
      } else {
        this.markDone(node.id);
        this.activateDownstream(node.id);
      }
    }
  }
}
```

---

## Phase 2：VibeGraph 接入 — AI 自动设计 Pipeline 图

### 2.1 VibeGraph 工作流（参考 MASFactory）

MASFactory 的 `VibeGraph` 机制：
1. 用户用自然语言描述需求："我要做一个游戏，需要设计、编码、测试三个阶段"
2. `VibeWorkflow`（一个 RootGraph）运行，输出 `graph_design: {nodes, edges}` JSON
3. `VibeGraph.build()` 将 JSON 编译为可执行的 Node/Edge 图
4. 编译结果缓存到 `build_cache_path`，下次直接加载

### 2.2 在 Gateway 中复用这个机制

新增 API `POST /api/pipelines/generate`：

```typescript
// 用户输入
{
  "goal": "开发一个电商系统，需要产品规划、前后端分离开发、UI设计和集成测试",
  "constraints": ["不需要 AI 推荐功能", "需要微信小程序版本"],
  "availableGroups": ["product-spec", "architecture-advisory", "autonomous-dev-pilot", "ux-review"]
}

// 调用 LLM 生成 graphPipeline JSON
// → 返回 Template JSON（含 graphPipeline 字段）
// → 用户确认后保存为 Template 文件
```

**可选**：引入 MASFactory 作为 Python 子服务，通过 `codexExec` 或 HTTP 调用其 `VibeGraph`，复用其图生成逻辑。

---

## Phase 3：Loop 组件嵌入 Review Retry

### 当前 Review Retry 的问题

```typescript
// 现有 group-runtime.ts 的 Retry
if (reviewDecision === 'revise') {
  if (roleProgress.round < group.maxRetries) {
    await dispatchGroupRun(...);  // 同组重试
  } else {
    markBlocked(run);
  }
}
```

局限：重试对象固定为**同一 Group**，无法跨 Group 重试或改变重试策略。

### 借鉴 MASFactory 的 Loop 机制

```
Loop(
  maxIterations = 3,
  terminateConditionPrompt = "产品方案是否已经获得批准？",
  body = [pm_agent, pm_supervisor_review]   // review 在 loop 内
)
```

实现方案：在 `graph-pipeline-runner.ts` 中，当 Stage 类型为 Loop 时，将 Review 步骤也纳入 Loop body，终止条件由 LLM 或规则函数决定，而不是简单的 `maxRetries` 计数。

---

## Phase 4：MASFactory Visualizer 集成

MASFactory 有一个独立的 VS Code 扩展（`masfactory-visualizer/`），通过 WebSocket 实时展示节点状态：

```
Node高亮（running/done/blocked）→ 边高亮（已激活的路径）→ 数据检查（节点输入/输出）
```

**融合方案**：

选项 A（轻量）：在现有 Web UI 中新增 `PipelineGraphView` 组件，基于现有 Stage 数据渲染 DAG：
```tsx
// src/components/pipeline-graph-view.tsx
// 用 React Flow 或 d3-dag 渲染 graphPipeline 的节点/边
// 节点颜色：pending灰 → running橙 → done绿 → blocked红
```

选项 B（重量）：将 MASFactory Visualizer 的 WebSocket 协议适配到 Gateway 的 WebSocket，让 VS Code 扩展可以接入 Gateway 的运行状态。

---

## 实施路线

```
Phase 1（2周）：graph-pipeline-runner.ts + Template JSON graphPipeline 格式支持
  - 类型定义（graph-types.ts）
  - 图拓扑执行器（graph-pipeline-runner.ts）
  - API: POST /api/projects 支持 graphPipeline 模板
  - 测试：用线性图验证与现有 Pipeline 等价
  前置条件：无

Phase 2（1周）：VibeGraph API（AI 生成 Pipeline 图）
  - POST /api/pipelines/generate 接口
  - LLM prompt 设计（输出固定 graphPipeline JSON schema）
  - 生成结果的 schema 验证
  前置条件：Phase 1

Phase 3（1周）：Loop 组件 + Review Retry 增强
  - Loop 节点类型支持
  - 终止条件 LLM 评估
  - 现有 maxRetries 迁移到 Loop
  前置条件：Phase 1

Phase 4（2周）：可视化
  - PipelineGraphView 组件（React Flow）
  - 节点状态实时更新（接入现有 WebSocket）
  前置条件：Phase 1

可选改造（Phase 1+ 期间持续推进）：
  - graphPipeline 声明式 YAML/JSON 支持
  - AgentSwitch 节点（LLM 路由决策）
  - 并行节点（多节点同时 dispatch 无序依赖）
```

---

## 关键设计决策

### D1：是否直接引入 MASFactory 作为 Python 依赖？

**结论：Phase 1-3 不引入，Phase 2 的 VibeGraph 可选用 Python 子服务。**

理由：
- MASFactory 的图执行本身不复杂，用 TypeScript 重新实现核心（Node/Edge/Loop/Switch）成本约 1 周
- 减少 Python 进程依赖，Gateway 保持纯 Node.js
- VibeGraph 的 LLM 调用可以直接通过 Gateway 现有的模型 API 实现，不需要 Python

### D2：如何保持与现有 Pipeline 的向后兼容？

```typescript
// project-registry.ts
function getRunner(template: Template): PipelineRunner {
  if (template.graphPipeline) {
    return new GraphPipelineRunner(template.graphPipeline);
  }
  return new LinearPipelineRunner(template.pipeline);  // 现有
}
```

新旧 Template 可以共存，`graphPipeline` 字段的存在切换到图执行引擎。

### D3：节点执行仍然通过 LS/Codex，不嵌入 Python Agent

MASFactory 的 `Agent` 节点直接调用 LLM。我们的 Stage 节点调用 `dispatchGroupRun()`（→ LS/Codex），保留对 Antigravity 工具链的完整依赖，只在编排层引入图结构。

---

## 与 MASFactory 的差别（融合后）

| 能力 | MASFactory | Antigravity (融合后) |
|------|-----------|---------------------|
| 控制流 | 任意有向图 | 有向图（支持分支/循环）+ 原线性 Pipeline |
| 动态图生成 | VibeGraph | `/api/pipelines/generate`（LLM 生成） |
| Agent 执行 | Python 进程内 | LS/Codex CLI 黑盒 |
| Review 机制 | 用户自定义 | 内置 Supervisor（保留） |
| 持久化 | 无（进程内） | JSON 文件（保留） |
| 多通道接入 | 无 | 微信/REST/MCP/CLI（保留） |
| 可视化 | runtime + topo | Timeline + DAG（新增） |
