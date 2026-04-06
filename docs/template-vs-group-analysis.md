# Template vs Group 功能重叠深度分析报告

> 日期: 2026-04-05  
> 分析范围: Multi-Agent 系统中的 Template、Group、PipelineStage 三层抽象

---

## 一、当前架构（三层嵌套）

```
TemplateDefinition (模板)
├── id, title, description
├── defaultModel
├── groups: Record<string, GroupDef>     ← Group 内嵌在 Template 中
│   ├── "product-spec": {
│   │     title, description,
│   │     executionMode: "review-loop",    ← 执行模式
│   │     roles: [author, reviewer],       ← 角色列表
│   │     reviewPolicyId: "default-product", ← 审核策略
│   │     sourceContract: { ... },         ← 上游依赖
│   │     capabilities: { ... }            ← 能力声明
│   │   }
│   ├── "architecture-advisory": { ... }
│   └── "autonomous-dev-pilot": { ... }
│
├── pipeline: PipelineStage[]            ← Pipeline 引用 Group
│   ├── { groupId: "product-spec", autoTrigger: false }
│   ├── { groupId: "architecture-advisory", autoTrigger: true }
│   └── { groupId: "autonomous-dev-pilot", autoTrigger: true }
│
└── graphPipeline?: GraphPipeline        ← 或者用 DAG 图
```

### 数据流

```
用户请求 → CEO/team-dispatch 选 templateId
 → dispatch-service 解析 templateId → 找 pipeline 第一个 stage → 取 groupId
   → group-registry.getGroup(groupId) → 从全局 Group 列表查找
     → group-runtime.dispatchRun({ groupId }) → 加载 Group 定义 → 按 executionMode 执行
```

### 关键问题：Group 的身份危机

**Group 在 JSON 中是 Template 的子结构，但在运行时被当作独立实体使用。**

```
设计时（JSON）:                       运行时（代码）:
Template.groups["product-spec"]  →→→  loadAllGroups() 展平  →→→  getGroup("product-spec")
                                                                        ↑
                                                            全局查找，丢失 Template 上下文
```

---

## 二、Group 内各功能的归属分析

### 2.1 审核功能（Review）

| 配置项 | 所在位置 | 本质用途 |
|:------|:--------|:---------|
| `executionMode: "review-loop"` | Group | 决定 run 是否走 author→reviewer 多轮循环 |
| `reviewPolicyId: "default-strict"` | Group | 引用外部审核策略文件（目前**资产目录为空**） |
| `roles[].autoApprove` | Role（Group 内） | 是否自动审批该角色的工具调用 |
| `maxRounds` | Group（非标准字段） | 最大审核轮数 |

**审核逻辑在代码中的分布**：

```
group-runtime.ts
├── executeReviewLoop()      ← 管理 author→reviewer 多轮循环
│   └── executeReviewRound() ← 单轮：author 执行 → reviewer 审查 → decision
│       └── isReviewer = (i === roles.length - 1) && reviewPolicyId !== undefined
│
├── ReviewEngine.evaluate()  ← 基于 reviewPolicy 规则判断 approved/revise/rejected
│   └── 实际数据：review-policies/ 目录为空 → 永远走 fallback
│
└── extractReviewDecision()  ← 从 reviewer 输出文本中解析 decision marker
```

**结论**：审核是 **Group 级功能**，跟 Template 无关。Template 不需要知道某个 Group 是否走 review-loop —— 它只需要知道 Pipeline 的 stage 顺序和触发条件。

**但是**：`reviewPolicyId` 指向的审核策略文件目前为空。这意味着 `ReviewEngine.evaluate()` 永远不会覆盖 reviewer 的 decision —— 审核完全靠 reviewer 角色的 AI 输出中的 `[DECISION: approved]` 标记。Review Policy 本质是一个**未启用的规则引擎**。

### 2.2 执行模式（executionMode）

| 模式 | 语义 | Group 数 |
|:-----|:-----|:---------|
| `legacy-single` | 单角色直接执行，无 review | 10 |
| `review-loop` | author + reviewer 多轮循环 | 14 |
| `delivery-single-pass` | 交付模式（执行 + finalize） | 3 |
| `orchestration` | 编排节点（不直接执行） | 3 |

`executionMode` 是 **Group 最核心的字段**。它决定了 `group-runtime` 走哪条执行路径。

**这个字段应该留在 Group 上，不能提升到 Template** — 因为一个 Template 的不同 stage 可以用不同执行模式（如 `ux-driven-dev-template` 的 4 个 stages 全部是 `review-loop`，但 `large-project-template` 混用了 `orchestration` + `review-loop` + `legacy-single`）。

### 2.3 角色定义（roles[]）

```json
"roles": [
  { "id": "pm-author", "workflow": "/pm-author", "timeoutMs": 600000, "autoApprove": true },
  { "id": "product-lead-reviewer", "workflow": "/product-lead-reviewer", "timeoutMs": 480000, "autoApprove": true }
]
```

角色定义 **只在 Group 中有意义**：
- `workflow` 引用 `~/.gemini/antigravity/gateway/assets/workflows/` 中的角色指令文件
- `timeoutMs` 控制角色执行超时
- `autoApprove` 控制工具调用的审批模式

Template 和 PipelineStage 都不需要知道角色细节。

### 2.4 上游契约（sourceContract）

```json
"sourceContract": {
  "acceptedSourceGroupIds": ["product-spec"],
  "requireReviewOutcome": ["approved"],
  "autoIncludeUpstreamSourceRuns": true,
  "autoBuildInputArtifactsFromSources": true
}
```

`sourceContract` 在 DAG 运行时用于：
1. `filterSourcesByNode()` — 过滤可接入的 source runs
2. `canActivateNode()` — 决定 stage 是否可以激活
3. `dispatch-service` — 校验 source run 的 groupId 是否被接受

**这是 Pipeline 连接层的逻辑**，理论上应该在 PipelineStage 上定义（而不是 Group）。因为同一个 Group 在不同 Pipeline 中的上游可能不同。

**但当前设计把 `sourceContract` 放在 Group 上 + 同一个 groupId 在多个 Template 中的定义完全相同** — 所以实际上没有冲突。

### 2.5 能力声明（capabilities）

```json
"capabilities": {
  "acceptsEnvelope": true,    // 接受 TaskEnvelope 结构化输入
  "emitsManifest": true,      // 完成后输出 ArtifactManifest
  "requiresInputArtifacts": true,  // 需要上游的输出产物
  "advisory": true,           // 是咨询型（不改代码）
  "delivery": false           // 是交付型
}
```

**`capabilities` 只在以下地方使用**：

```
group-runtime.ts:
  if (group.capabilities?.requiresInputArtifacts && !resolvedSource.inputArtifacts.length)
    → throw Error("需要 inputArtifacts")
  
  if (group.capabilities?.advisory)
    → finalizeAdvisoryRun() 而非 finalizeDeliveryRun()
```

这些是 **Group 执行时的行为标记**，跟 Template 无关。

---

## 三、Group 跨模板共享情况

### 共享 Groups（定义完全相同）

| Group ID | 被哪些 Template 使用 |
|:---------|:-------------------|
| `product-spec` | ux-driven-dev, development-1 |
| `architecture-advisory` | ux-driven-dev, development-1 |
| `autonomous-dev-pilot` | ux-driven-dev, development-1 |
| `ux-review` | ux-driven-dev, design-review |
| `brief-composer` | financial-analysis, morning-brief |
| `market-data-collector` | financial-analysis, morning-brief |
| `smoke-planning/fan-out/join/integration` | graph-smoke, v4-smoke |

**10 个 Group 被 2 个模板复用，定义完全一致。**

### 共享带来的问题

当前实现：`loadAllGroups()` 从所有 Template 展平，**`seen` 去重（first wins）**。

```ts
for (const template of templates) {
  for (const [groupId, groupDef] of Object.entries(template.groups)) {
    if (seen.has(groupId)) continue; // first template wins for duplicate groupIds
    ...
  }
}
```

这意味着：
1. 如果两个 Template 对同一个 groupId 有不同定义 → 先加载的 Template 赢
2. 目前所有共享 Group 定义完全相同 → 不会出 bug
3. **但如果以后某模板想微调一个共享 Group → 要么改所有 Template 里的定义，要么改 groupId（破坏共享）**

---

## 四、Group 独立调用场景分析

| 调用方式 | 是否存在 | 详情 |
|:---------|:--------|:-----|
| **前端直接选 Group 派发** | ❌ 不存在 | 前端只能选 Template（通过 team-dispatch）或自然语言（通过 CEO） |
| **API 直接传 groupId 派发** | ⚠️ 理论支持 | `POST /api/agent-runs { groupId }` 可以直传，但实际流程总是先走 `templateId → groupId` |
| **`/api/agent-groups` 被调用** | ❌ 无前端消费者 | API 存在但没有前端组件调用它 |
| **DAG 契约验证** | ✅ 需要 | `sourceContract.acceptedSourceGroupIds` 按 groupId 过滤上游 run |
| **group-runtime 执行** | ✅ 核心 | `getGroup(groupId)` → 获取 roles/executionMode → 执行 |

---

## 五、能否消除 Group 层级？

### 方案 A：合并 Group 进 PipelineStage

```json
// 当前（3 层）
"pipeline": [{ "groupId": "product-spec", "autoTrigger": true }],
"groups": { "product-spec": { roles: [...], executionMode: "review-loop" } }

// 方案 A（2 层）
"pipeline": [
  {
    "stageId": "product-spec",
    "autoTrigger": true,
    "executionMode": "review-loop",
    "roles": [...]，
    "reviewPolicyId": "default-product",
    "sourceContract": { ... }
  }
]
```

**优点**：
- 消除间接层，从 3 层（Template → Group → Role）变为 2 层（Template → Stage/Role）
- 不再需要 `group-registry.ts`、`loadAllGroups()`
- 不存在跨模板 groupId 冲突问题

**缺点**：
- **破坏跨模板 Group 共享**（10 个共享 Group 变成 copy-paste）
- PipelineStage 变得臃肿（目前 PipelineStage 是轻量引用，加上 roles/capabilities 后变成大对象）
- 需要修改所有 14 个 Template JSON + 大量代码

**风险**：高。破坏面太大。

### 方案 B：Group 变为独立引用资产（推荐）

```
~/.gemini/antigravity/gateway/assets/
├── templates/
│   └── ux-driven-dev-template.json    ← groups: { "product-spec": "$ref:groups/product-spec" }
├── groups/              ← 新增！Group 独立文件
│   ├── product-spec.json
│   ├── architecture-advisory.json
│   └── ux-review.json
├── workflows/
└── review-policies/
```

```json
// Template JSON（瘦身）
{
  "id": "ux-driven-dev-template",
  "groups": {
    "product-spec": { "$ref": "groups/product-spec" },
    "architecture-advisory": { "$ref": "groups/architecture-advisory", "sourceContract": { "acceptedSourceGroupIds": ["product-spec"] } }
  },
  "pipeline": [...]
}

// Group JSON（独立资产）
{
  "id": "product-spec",
  "title": "产品规格",
  "executionMode": "review-loop",
  "roles": [...],
  "reviewPolicyId": "default-product"
}
```

**优点**：
- Group 真正变成可复用资产（像 workflow 一样）
- Template 只需引用 + 可选覆盖（如不同 Template 的 sourceContract 不同）
- `loadAllGroups()` 变成直接从 `groups/` 目录加载
- 减少 Template JSON 文件大小

**缺点**：
- 需要实现 `$ref` 解析逻辑
- 多文件管理（Group 和 Template 分离）

### 方案 C：保持现状但精简代码

保持 Group 内嵌在 Template 的 JSON 结构，但在**代码层面**：

1. **删除 `group-registry.ts`** — 只有 18 行转发代码
2. **`getGroup()` 改为参数带 templateId**：`getGroup(templateId, groupId)` 而非全局查找
3. **`loadAllGroups()` 只保留给 `/api/agent-groups`** 向后兼容
4. **Runtime 直接从 Template 获取 Group**：

```ts
// 当前
const group = getGroup(groupId);  // 全局查找

// 优化后
const template = AssetLoader.loadTemplate(run.pipelineId || run.templateId);
const group = { id: groupId, templateId: template.id, ...template.groups[groupId] };
```

**优点**：改动小、不破坏 JSON 结构、保留 Template 上下文
**缺点**：还是 copy-paste 共享

---

## 六、审核（Review）功能的归属评估

| 审核功能 | 应该在哪里 | 理由 |
|:---------|:---------|:-----|
| `executionMode: "review-loop"` | ✅ 留在 Group | 不同 stage 可能有不同执行模式 |
| `reviewPolicyId` | ⚠️ Group 或 Template | 目前 review-policies/ 目录为空，功能未启用 |
| `maxRounds` | ⚠️ 非标准字段 | 只有 1 个 Template 用了，可以提升为 Group 标准字段 |
| `roles[].autoApprove` | ✅ 留在 Role | 角色级配置 |
| `ReviewEngine.evaluate()` | ✅ 保持独立 | 规则引擎，不属于任何特定层 |

**审核逻辑应该留在 Group 级别。Template 不需要知道审核细节。**

如果以后启用 Review Policy：
- 在 `review-policies/` 目录创建 JSON 文件（如 `default-strict.json`）
- Group 的 `reviewPolicyId` 引用它
- `ReviewEngine.evaluate()` 在每轮 review 后自动评估

---

## 七、结论和推荐

### 功能重叠总结

| 维度 | Template | Group | PipelineStage | 重叠？ |
|:-----|:---------|:------|:-------------|:------|
| title/description | ✅ | ✅ | ❌ | ⚠️ 轻微 |
| defaultModel | ✅ | ✅ (覆盖) | ❌ | ⚠️ 层级覆盖 |
| executionMode | ❌ | ✅ | ❌ | ❌ |
| roles[] | ❌ | ✅ | ❌ | ❌ |
| reviewPolicyId | ❌ | ✅ | ❌ | ❌ |
| capabilities | ❌ | ✅ | ❌ | ❌ |
| sourceContract | ❌ | ✅ | ❌ | ⚠️ 应在 Stage 上 |
| pipeline order | ✅ | ❌ | 自身 | ❌ |
| autoTrigger | ❌ | ❌ | ✅ | ❌ |
| contract (StageContract) | ❌ | ❌ | ✅ | ❌ |

**重叠度：低。** `title/description/defaultModel` 的重叠是正常的层级覆盖模式。`sourceContract` 放在 Group 上有轻微设计味道，但因为跨模板 Group 定义完全相同，实际无害。

### 推荐优先级

| 优先级 | 动作 | 收益 | 风险 |
|:------|:-----|:-----|:-----|
| P0 | **方案 C：精简代码** — 删 `group-registry.ts`，runtime 从 Template 获取 Group | 低成本精简 | 极低 |
| P1 | **启用 Review Policy** — 在 `review-policies/` 创建策略文件 | 审核规则可配置化 | 低 |
| P2 | **方案 B：Group 独立资产** — Group 变为独立 JSON 文件 | 真正可复用 | 中 |
| ❌ | ~~方案 A：合并 Group 进 Stage~~ | 破坏太大 | 高 |

### 最终判断

> **Template 和 Group 功能不重叠。Group 是 Template 的必要子结构，负责"执行配置"（怎么执行），Template 负责"流程编排"（按什么顺序执行）。不建议合并。**
>
> 唯一的代码层问题是 **Group 不应该有全局 registry** — 它应该通过 Template 上下文访问，而不是全局展平后按 groupId 查找。

---

## 八、Group 的本质：Workflow Composition Pattern

> **Group = 一个可复用的 Workflow 组合模式**

```
Workflow（原子单位）         → 一个 Agent 角色的完整指令（.md 文件）
Group（组合单位）            → N 个 Workflow + 编排规则 + 审核配置
PipelineStage（编排单位）   → Group 的执行顺序 + 触发条件 + 上游依赖
Template（方案单位）        → N 个 Stage 组成的完整解决方案
```

Group 的三个组成部分：
1. **一组 Workflow 的引用**（`roles[].workflow`）— 指向 `workflows/` 目录的 MD 文件
2. **Workflow 之间的编排规则** — `executionMode`（串行/review-loop/交付）
3. **质量控制配置** — 是否审核、审几轮、用什么策略

Group 可以平铺到 PipelineStage（方案 A），但会破坏复用。也可以作为独立资产（方案 B Stage Preset），支持引用式复用。

### 扁平化可行性

所有 Group 字段都可以移到 PipelineStage：

| Group 字段 | 能否移到 Stage | 分析 |
|:-----------|:-------------|:-----|
| `executionMode` | ✅ | stage 决定"这步怎么执行" |
| `roles[]` | ✅ | "这步需要谁" |
| `reviewPolicyId` | ✅ | 审核策略跟 stage 走 |
| `sourceContract` | ✅ **应该移** | 上游依赖本来就是 Pipeline 连接逻辑 |
| `capabilities` | ✅ | 执行行为标记 |

扁平化的关键是引入 **Stage Preset** 解决复用：

```json
// assets/stage-presets/product-spec.json
{ "executionMode": "review-loop", "roles": [...], "reviewPolicyId": "default-product" }

// Template 引用预设
{ "pipeline": [{ "stageId": "product-spec", "preset": "product-spec", "autoTrigger": true }] }
```

---

## 九、AssetLoader 中 Hardcoded 配置分析

### 写死内容一览

| Hardcoded 内容 | 行数 | 触发条件 | 建议 |
|:-------------|:-----|:---------|:-----|
| `FALLBACK_GROUPS`（5 个 Group 完整定义） | ~80 行 | `templates.length === 0`（磁盘无 Template 文件） | **可删除** — 磁盘已有 14 个 Template |
| `default-strict` review policy | ~5 行 | `review-policies/default-strict.json` 不存在 | **应创建实际策略文件** |
| `MODEL_PLACEHOLDER_M26` 默认模型 | 1 行 | Group 和 Template 都没配 model 时 | **保留** — 合理的最终 fallback |

### FALLBACK_GROUPS 存在原因

首次部署/开发环境保护。如果 Template 目录为空，系统不会崩溃，而是用内置的 5 个基础 Group。

**问题**：这 80 行 hardcoded Group 定义跟磁盘上的 Template JSON 存在**双重来源**，容易不同步。实际上 hardcoded 版本已经落后于磁盘版本。

### Review Policy Fallback 存在原因

`review-policies/` 目录为空，但 `default-strict` 被 4 个 Template 引用。代码中 hardcoded 了一个最基础的策略：
```ts
{ rules: [{ conditions: [{ field: 'round', operator: 'gt', value: 3 }], outcome: 'revise-exhausted' }],
  fallbackDecision: 'approved' }
```
其他 policy ID（`default-product`, `default-architecture`）引用时 `getReviewPolicy()` 返回 `null` → 审核策略不生效。

---

## 十、Group 跨模板复用统计

### 30 个 Group 中有 10 个被复用

| Group ID | 被哪些 Template 共享 | 定义一致？ |
|:---------|:-------------------|:---------|
| `product-spec` | ux-driven-dev, development-1 | ✅ 相同 |
| `architecture-advisory` | ux-driven-dev, development-1 | ✅ 相同 |
| `autonomous-dev-pilot` | ux-driven-dev, development-1 | ✅ 相同 |
| `ux-review` | ux-driven-dev, design-review | ✅ 相同 |
| `brief-composer` | financial-analysis, morning-brief | ✅ 相同 |
| `market-data-collector` | financial-analysis, morning-brief | ✅ 相同 |
| `smoke-planning` | graph-smoke, v4-smoke | ✅ 相同 |
| `smoke-fan-out` | graph-smoke, v4-smoke | ✅ 相同 |
| `smoke-join` | graph-smoke, v4-smoke | ✅ 相同 |
| `smoke-integration` | graph-smoke, v4-smoke | ✅ 相同 |

**复用率：10/30 = 33%。** 所有共享 Group 的定义完全一致（copy-paste 模式）。

### 当前复用机制的风险

`loadAllGroups()` 展平时 "first template wins"。如果以后想让同一 groupId 在不同 Template 中有不同配置（如 `product-spec` 在 A 模板用 2 轮 review，在 B 模板用 3 轮），当前设计不支持。

---

## 十一、Group 独立调用场景

| 调用方式 | 是否存在 | 详情 |
|:---------|:--------|:-----|
| 前端直接选 Group 派发 | ❌ | 前端只能选 Template 或自然语言 |
| API 直接传 groupId | ⚠️ 理论支持 | `POST /api/agent-runs { groupId }` 可以，但实际总走 templateId |
| `/api/agent-groups` 被前端调用 | ❌ | API 存在但无前端消费者 |
| DAG 契约验证 | ✅ | `sourceContract.acceptedSourceGroupIds` 过滤上游 |
| group-runtime 执行 | ✅ | `getGroup(groupId)` → roles + executionMode → 执行 |

---

## 十二、Group 嵌套对 Template 生成的影响

### 当前 Template 生成流程

```
用户: "我想做一个代码评审流程"
  → pipeline-generator.ts 构建 prompt → 给 AI availableGroups 列表 (30 个)
    → AI 输出 graphPipeline: { nodes: [{ groupId: "???" }], edges: [...] }
      → 代码自动创建 stub Group: { executionMode: "review-loop", roles: [] }
        → 生成的 Template 不能直接执行（roles 为空）
```

### 问题分析

1. **AI 必须选择已存在的 groupId** — 但 30 个预定义 Group 无法覆盖所有需求
2. 如果 AI 想设计新组合（如"先 TDD 再 review"），必须创建**完整的 Group 定义**
3. Group 定义需要 `executionMode`、`roles[]`、`sourceContract`、`capabilities` — **这是执行引擎的实现细节，AI 不应关心**
4. 当前代码创建了 `roles: []` 的 stub Group — 生成结果**不可直接执行**

### 复用空间有限

以 34 个 Workflow 角色为例：
- 2 个一组的组合 × 3 种执行模式 = **1683 种可能的 Group**
- 实际只预定义了 **30 个 Group**
- AI 被迫从 30 个中选，覆盖率 < 2%

### 扁平化后的生成流程

```
用户: "我想做一个代码评审流程"
  → AI 只需输出:
    nodes: [{
      id: "code-review",
      kind: "stage",
      executionMode: "review-loop",            ← 直接在 stage 上配
      roles: ["/dev-worker", "/code-reviewer"]  ← 直接选 workflow
    }]
  → 生成结果直接可执行 ✅
```

### 复杂度对比

| 维度 | 当前（Group 嵌套） | 扁平化后 |
|:-----|:------------------|:---------|
| AI 需要输出 | DAG 图 + Group 定义 | DAG 图 + stage 级 workflow 引用 |
| 新组合创建 | 必须设计完整 Group | 直接引用 Workflow |
| 复用 | 从 30 个 Group 选 | 从 34 个 Workflow 自由组合 |
| 生成后可执行 | ❌ roles 为空的 stub | ✅ 直接可执行 |
| 验证复杂度 | 校验 Group + DAG + Contract | 校验 DAG + Workflow 存在性 |

> **Group 嵌套是 Template 生成的最大障碍。** 扁平化让 AI 只关注"选 Workflow + 选执行模式"，生成能力大幅提升。
