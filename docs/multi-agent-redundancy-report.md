# Multi-Agent 架构冗余分析报告

> 日期: 2026-04-05  
> 范围: `src/lib/agents/` 目录

---

## 概况

| 指标 | 数值 |
|:-----|:-----|
| 文件总数 | 55 |
| 代码总行数 | 12,870 |
| Types 文件 | 12 个 / 1,187 行 |
| 最大文件 | `group-runtime.ts` (2,257 行) |

---

## 🔴 严重冗余（建议合并）

### 1. Pipeline 编译/查询层：6 个文件太分散

```
pipeline-types.ts (64行) ← 类型定义
pipeline-graph.ts (72行) ← resolveStageId + validate → 被 dag-compiler 调用
dag-compiler.ts (146行) ← pipeline[] 编译到 DagIR，缓存管理
graph-compiler.ts (439行) ← graphPipeline 编译到 DagIR
dag-runtime.ts (292行) ← DagIR 查询引擎
pipeline-registry.ts (94行) ← ⬆ 这 3 个的 thin wrapper（全部转发）
```

**`pipeline-registry.ts` 是纯粹的转发层**——内部只做 `getOrCompileIR()` 然后调 `dag-runtime` 函数。只有 2 个消费者：

```
dispatch-service.ts  →  getDownstreamStages()
group-runtime.ts     →  canActivateStage(), filterSourcesByContract(), getDownstreamStages()
```

这些函数内部全部转发到 `dag-compiler.getOrCompileIR()` + `dag-runtime.getDownstreamNodes()` / `canActivateNode()` / `filterSourcesByNode()`。

**建议**：
- 合并 `pipeline-graph.ts` → `dag-compiler.ts`
- 删除 `pipeline-registry.ts`，消费者直接用 `dag-compiler` + `dag-runtime`
- **净减 ~166 行，消除 2 个文件**

---

### 2. `group-runtime.ts` — God Object (2,257 行)

一个文件包含了 20+ 函数，覆盖 6 个职责域：

| 职责 | 函数 | 行数（估） |
|:-----|:-----|:---------|
| Dispatch 入口 | `dispatchRun`, `resolveSourceContext` | ~300 |
| 执行模式 | `executeSerialEnvelopeRun`, `executeDeliverySinglePass`, `executeReviewLoop`, `executeReviewRound` | ~800 |
| Watcher | `startWatching`, `watchUntilComplete`, `handleCompletion`, `cleanup` | ~400 |
| Pipeline 触发 | `tryAutoTriggerNextStage`, `handleAutoApprove` | ~200 |
| 干预/取消 | `interveneRun`, `cancelRun`, `cancelRunInternal` | ~300 |
| 辅助 | `createAndDispatchChild`, `buildDevelopmentWorkPackage`, `buildRetryPrompt`, `splitWriteScopeForMultiWP` | ~250 |

**建议拆分为 4 个模块**：

```
group-runtime.ts (保留, ~300行)
  ├── re-export 所有公共 API
  ├── interveneRun, cancelRun
  └── buildDevelopmentWorkPackage, splitWriteScopeForMultiWP

dispatch-entry.ts (新建, ~300行)
  ├── dispatchRun
  └── resolveSourceContext

execution-modes.ts (新建, ~800行)
  ├── executeSerialEnvelopeRun
  ├── executeDeliverySinglePass
  ├── executeReviewLoop
  └── executeReviewRound

watcher.ts (新建, ~400行)
  ├── startWatching
  ├── watchUntilComplete
  ├── handleCompletion
  ├── tryAutoTriggerNextStage
  └── handleAutoApprove
```

**净减 0 行代码，但让 2257 行 God Object → 4 个可读模块**。

---

## 🟡 中等冗余（建议精简）

### 3. Types 文件碎片化（12 个文件，7 个低于 80 行）

```
group-types.ts            313行 ← 核心，保留
project-types.ts          113行 ← 保留
dag-ir-types.ts           173行 ← 可并入 dag-types
graph-pipeline-types.ts   101行 ← 可并入 dag-types
pipeline-types.ts          64行 ← 保留
contract-types.ts         120行 ← 保留
resource-policy-types.ts   78行 ← 保留
scheduler-types.ts         53行 ← 保留
development-template-types.ts  65行 ← 可并入 template-types
research-template-types.ts     26行 ← 可并入 template-types
subgraph-types.ts              46行 ← 可并入 template-types
asset-types.ts                 35行 ← 可并入 template-types
```

**建议**：
- 合并 `development-template-types` + `research-template-types` + `subgraph-types` + `asset-types` → `template-types.ts` (~172 行)
- 合并 `graph-pipeline-types` + `dag-ir-types` → `dag-types.ts` (~274 行)
- **12 个 types 文件 → 8 个，消除 4 个碎片文件**

---

### 4. `dispatch-service.ts` vs `group-runtime.dispatchRun` — 命名混淆

两者的职责实际上清晰分层：

```
dispatch-service.executeDispatch()  ← 业务编排层（解析 template → 初始化 pipeline state）
  └── group-runtime.dispatchRun()   ← 执行层（创建子对话 → 启动 watcher）
```

但命名容易混淆。**建议**：`executeDispatch` 改名为 `orchestrateDispatch` 或保持现状但加文档注释。

---

## 🟢 设计合理（无需改动）

| 模块 | 行数 | 说明 |
|:-----|:-----|:-----|
| `ceo-agent` + `ceo-tools` + `ceo-prompts` | 1,192 | 逻辑/工具/prompt 拆分合理 |
| `fan-out-controller` | 489 | Fan-out/Join 独立复杂逻辑 |
| `contract-validator` | 350 | 独立契约校验 |
| `asset-loader` | 350 | 资产加载 + 缓存 |
| `prompt-builder` | 331 | Prompt 构建（独立关注点） |
| `supervisor` | 292 | 独立看护逻辑 |
| `watch-conversation` | 275 | gRPC watcher |
| `finalization` + `result-parser` | 376 | 完成处理 + 结果解析 |
| `project-diagnostics` + `project-reconciler` | 843 | 诊断 vs 修复，职责不同 |
| `review-engine` | 71 | 规则评估器 |
| `flow-condition` | 223 | Switch/Gate 条件评估 |
| `department-sync` + `department-memory` | 369 | 部门同步 + 记忆（独立域） |
| `checkpoint-manager` | 186 | Checkpoint 管理 |
| `execution-journal` | 160 | 执行日志 |

---

## 精简效果预估

| 项目 | 当前 | 精简后 | 减少 |
|:-----|:-----|:-------|:-----|
| 文件数 | 55 | ~47 | -8 |
| 代码行数 | 12,870 | ~12,700 | -170 (wrapper 消除) |
| group-runtime 可读性 | 2,257 行单文件 | 4 个 × ~500 行 | **核心改善** |
| Types 碎片 | 12 个 types 文件 | 8 个 | -4 文件 |
| Pipeline 追踪成本 | 6 层调用链 | 3 层 | **显著改善** |

---

## 优先级排序

| 优先级 | 动作 | 影响 | 风险 |
|:-------|:-----|:-----|:-----|
| P0 | 拆分 `group-runtime.ts` (2257行→4模块) | 可读性 ⬆⬆⬆ | 低（内部重构） |
| P1 | 删除 `pipeline-registry.ts` (转发层) | 复杂度 ⬇ | 低（2 个消费者） |
| P2 | 合并碎片 types (12→8) | 文件数 ⬇ | 极低 |
| P3 | `dispatch-service` 改名 | 清晰度 ⬆ | 极低 |
