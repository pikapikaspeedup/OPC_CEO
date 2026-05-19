# Prompt 拼装机制的系统性架构考古报告

> 日期: 2026-05-11
> 作者: Claude (架构审查 / 考古组)
> 关联现象: 同一份 workflow MD 在单条 prompt 中被注入两次（已观测）；
>           多类资产存在双重/多重注入风险（已确认）。
> 调查范围: `src/lib/agents/*`、`src/lib/knowledge/*`、`src/lib/company-kernel/*`、`ARCHITECTURE.md`、`docs/research/*`、完整 git history（55 个 commit）。

---

## TL;DR

不是设计失误，是**地壳式叠层**：三代 prompt 拼装机制按时间顺序被叠加上去，新一代从来没有把旧一代拆掉。
- 第一代（2026-03-26，commit `50f7db7`）：`group-runtime + AssetLoader.resolveWorkflowContent` 把 workflow MD 直接拼到 role prompt 里。
- 第二代（2026-04-08，commit `5077270`）：`PromptExecutor` 独立诞生，复用了 `AssetLoader`，但走自己的拼装路径，绕过 group-runtime。
- 第三代（2026-04-20，commit `9966720`）：`Department Capability Pack` 通过 `applyProviderExecutionContext` **包在外面**，又一次性把 workflow content 注入到 preamble。
- 第三代被加进去时，**没有任何一处把第一代的 `AssetLoader.resolveWorkflowContent(...)` 调用拿掉**。从那一刻起，每一条经过 group-runtime 的 prompt 都包含两份 workflow MD（一份在 preamble、一份在 buildRolePrompt/buildDeliveryPrompt 中段），PromptExecutor 路径则同时拥有 preamble + Playbook context + workflow runtime appendix 三层。
- 真正的系统性根因：**这个项目从来没有一个"全局唯一的 PromptComposer"**。`applyProviderExecutionContext` 只是个 prepend helper，不是 funnel；每条执行路径自己持有 builder，自己拼。Capability Pack 是一次"在不动既有 prompt 的前提下补丁式注入部门上下文"的工程权衡，副作用是把"职责重叠"显式化成了"内容重复"。

---

## 一、问题陈述

观测到的 prompt 三层结构（任意一条 group-runtime 派发的 run）：

```
┌─────────────────────────────────────────────────────────┐
│ Layer A: <department-capability-pack> … workflow MD … │ ← applyProviderExecutionContext / promptPreamble
│   …identity rule + local rules + Department Workflows  │
│   (### <workflow.name> + 完整 workflow.content)        │
├─────────────────────────────────────────────────────────┤
│ Layer B: AssetLoader.resolveWorkflowContent(role.wf)   │ ← buildRolePrompt / buildDeliveryPrompt
│   workflow MD 第二次出现（按 role.workflow 路径读盘）   │
│   后跟 Stage context / Canonical upstream inputs / …   │
├─────────────────────────────────────────────────────────┤
│ Layer C: Original goal: <user prompt>                  │
└─────────────────────────────────────────────────────────┘
```

PromptExecutor 路径还会额外多一个 Layer：

```
Layer A (capability-pack, 含 effectiveWorkflows.content) →
Layer A': buildPromptExecutionPrompt → "Playbook context" → AssetLoader.resolveWorkflowContent (再读一次) →
Layer B': preparedWorkflowContext.promptAppendix (workflow-runtime-hooks 又读一次 runtime helper context) →
Layer C': retrievedKnowledgeSection (knowledge module 独立召回) →
Layer D : Primary task / Original goal
```

同一份 workflow markdown 在 group-runtime 路径里实测出现 **2 次**，在 PromptExecutor 路径里若 `promptAssetRefs` 命中同一个 workflow，**最多出现 3 次**（capability-pack 内 1 次 + Playbook context 1 次 + 若 runtime appendix 又内嵌 1 次）。

---

## 二、Prompt 拼装入口全景

下表穷举了**所有最终向 LLM backend 提交字符串字段（`prompt` / `system`）的拼装点**。文件路径均为仓库相对路径。

| # | 文件:行 | 触发场景 | 拼装方式 | 资产入口 |
|---|--------|---------|---------|---------|
| 1 | `src/lib/agents/prompt-executor.ts:511` | Prompt Mode (scheduler `dispatch-prompt`、`POST /api/agent-runs?executorKind=prompt`、CEO 即时 prompt 指令) | `applyProviderExecutionContext([buildPromptExecutionPrompt, preparedWorkflowContext.promptAppendix, retrievedKnowledgeSection].join('\n\n'), executionContext)` | `buildPromptModeProviderExecutionContext` (capability-pack) + `AssetLoader.resolveWorkflowContent` (Playbook context) + `prepareWorkflowRuntimeContext` (workflow-runtime-hooks) + `retrieveKnowledgeAssets` |
| 2 | `src/lib/agents/group-runtime.ts:1174` | legacy-single executionMode（即兼容 V1 单 role 路径） | `applyProviderExecutionContext(${workflowContent}\n\n${goal}, {promptPreamble, …})` | `AssetLoader.resolveWorkflowContent` + 外部 `input.promptPreamble`（由 `dispatch-service` 注入 template context，即 capability-pack） |
| 3 | `src/lib/agents/group-runtime.ts:1663` | restart-role（intervene → 重启某个 role 时） | `applyProviderExecutionContext(prompt \|\| buildRetryPrompt(...), …)` | `buildRetryPrompt` (不读 workflow，但仍叠上 preamble) |
| 4 | `src/lib/agents/group-runtime.ts:2108` | delivery-single-pass executionMode | `applyProviderExecutionContext(buildDeliveryPrompt(...), …)` | `buildDeliveryPrompt` → 内含 `AssetLoader.resolveWorkflowContent` |
| 5 | `src/lib/agents/group-runtime.ts:2275` | review-loop executionMode（author / reviewer 多 role 闭环），每个 round 每个 role 一次 | `applyProviderExecutionContext(buildRolePrompt(...), …)` | `buildRolePrompt` → 内含 `AssetLoader.resolveWorkflowContent` |
| 6 | `src/lib/agents/group-runtime.ts` (≈2310) | shared-conversation role switch（V5.5 共享 cascade 复用） | `buildRoleSwitchPrompt` 直接发送，**未经过** `applyProviderExecutionContext` | `buildRoleSwitchPrompt` → 内含 `AssetLoader.resolveWorkflowContent` |
| 7 | `src/lib/agents/dispatch-service.ts:167` | template/pipeline 派发（scheduler `dispatch-pipeline` / `dispatch-execution-profile(review-flow)` / 任何 stage dispatch） | 不直接拼最终 prompt，而是预先 `buildTemplateProviderExecutionContext` → `input.promptPreamble = ...`，再调 `dispatchRun(...)` 交给 group-runtime | 把 capability-pack 通过 `DispatchRunInput.promptPreamble` 提前喂给 #2/#4/#5 |
| 8 | `src/lib/agents/group-runtime.ts:992` | `dispatchRun` 兜底：若 caller 未提供 preamble，会再调一次 `buildTemplateProviderExecutionContext` | 同上 | 同上 |

补充入口（不直接拼 prompt 字段，但参与文本拼装）：

- `src/lib/agents/workflow-runtime-hooks.ts:906 prepareWorkflowRuntimeContext` — 按 `runtimeProfile` switch 注入运行时 helper 上下文（daily-digest / daily-events / story-top-candidates 各一段 markdown），结果挂到 `promptAppendix`。
- `src/lib/agents/department-execution-resolver.ts:295 formatWorkflowSection` + `:305 formatSkillSection` — capability-pack 内部把 workflow / skill 完整内容塞进 markdown 段。
- `src/lib/knowledge/retrieval.ts:67 retrieveKnowledgeAssets` + `:84 formatKnowledgeAssetsForPrompt` — knowledge RAG 召回为另一段独立 markdown，**只有 PromptExecutor 路径调用**，group-runtime 路径**完全不接 knowledge**。

一眼可见的事实是：**prompt 字符串至少从 8 个独立点被组装出来**，每个点都自带 builder、不共享去重表、不共享 ledger，也没有任何一处对"这段内容已经出现过"做记账。

---

## 三、Git 考古：模块出生顺序与演化时间线

按文件首次出现 commit (`git log --diff-filter=A`) 按时间正序重建：

| 时间 | Commit | 关键文件首次出现 | 含义 |
|------|--------|----------------|------|
| 2026-03-26 | `50f7db7 chore: 全量提交所有未跟踪和已修改的文件` | `asset-loader.ts`、`group-runtime.ts`、`group-types.ts`、`gateway-home.ts`、`review-engine.ts`、`group-registry.ts`、`run-registry.ts`、`step-merger.ts`、`scope-governor.ts`、`watch-conversation.ts` | **第一代 Prompt 拼装机制诞生**：`AssetLoader.resolveWorkflowContent` 把 workflow MD 直接拼进 role prompt，整个 prompt 由 group-runtime 内 inline 函数构造。`composedPrompt = \`${workflowContent}\n\n${goal}\``（git show `50f7db7 -- group-runtime.ts:381,384`）。 |
| 2026-04-06 | `1de02e5 feat: Phase 6 core engine upgrades` | `prompt-builder.ts`、`pipeline-generator.ts`、`graph-compiler.ts`、`subgraph.ts`、`dag-compiler.ts`、`dispatch-service.ts`（首次出现 `executeDispatch`）、`finalization.ts`、`ceo-agent.ts`、`contract-validator.ts` | **第一代被"功能性抽提"**：`prompt-builder.ts` 把 `buildRolePrompt / buildDeliveryPrompt / buildRoleSwitchPrompt` 从 group-runtime 拆出来，**但仍然保留 `AssetLoader.resolveWorkflowContent` 直读 workflow** 的语义。`dispatch-service` 同期诞生作为"统一派发入口"，可惜统一的是"派发"不是"拼装"。 |
| 2026-04-06 | `6cebb43 feat: finalize stage-centric pipeline migration` | `pipeline/template-normalizer.ts`、`stage-resolver.ts` | 把 pipeline / template 改成 stage-centric，但 prompt 拼装层不动。 |
| 2026-04-08 | `5077270 feat: PromptExecutor 端到端实现` | `prompt-executor.ts`、`prompt-executor.test.ts` + scheduler 增加 `dispatch-prompt` action | **第二代 Prompt 拼装机制诞生**：PromptExecutor 是"无 template、prompt 主导"的并行入口，复用 `AssetLoader` 但走自己的 builder (`buildPromptExecutionPrompt`)，**不复用 group-runtime 的 builder**。从此 prompt 拼装的根入口从 1 个变成 2 个。 |
| 2026-04-10 | `661243c chonggou yiban`（"重构一半"） | 增量 group-runtime fixtures + tests | commit message 直接承认是半截重构。这是项目里最诚实的一条 message。 |
| 2026-04-20 | `9966720 chore: snapshot current OPC CEO codebase` | `canonical-assets.ts`、`department-capability-registry.ts`、`department-execution-resolver.ts`、`workflow-runtime-hooks.ts`、`department-memory-bridge.ts`、`run-events.ts`、`run-history.ts` | **第三代 Prompt 拼装机制诞生**：Department Capability Pack。新机制以 `applyProviderExecutionContext(prompt, context)` 形式**包在外面**——它不是 funnel，它只是 `prependContext(prompt, context.promptPreamble)`，把 capability-pack（含完整 workflow MD）前置。同一个 commit 里 group-runtime 的 5 处 prompt 字段被一一**包了一层** `applyProviderExecutionContext`，但**没有任何一处把内层的 `AssetLoader.resolveWorkflowContent` 拿掉**。同期 `workflow-runtime-hooks.ts` 引入了第三条独立读 workflow 的路径——`prepareWorkflowRuntimeContext` + `getCanonicalWorkflowRuntimeConfig`。 |
| 2026-04-26 | `8523889 feat: add company self-growth kernel` | `gateway-home.test.ts`、`scheduler-company-loop.test.ts`、`workflow-runtime-hooks.test.ts`、`canonical-assets` 扩展、`company-kernel/*` | **growth assets 通道**接入 prompt：`loadPublishedGrowthAssets` 进入 `buildPromptModeProviderExecutionContext`，published growth workflow 被合并到 `effectiveWorkflows`，从而**capability-pack 里的 workflow 列表会包含 growth workflow 的全文**。这是第 4 条独立资产入口。 |
| 2026-05-01 | `130a8c2 checkpoint: stabilize self-evolution execution boundary` | （增量修改 PromptExecutor 等） | 没有结构性变化，依旧三代共存。 |
| 2026-05-07 | `076a52c Stabilize self-improvement control and direct Codex flow` | group-runtime 增量 | 同上。 |
| 2026-05-09 | `0ae1db2 chore: sync workspace updates` | （增量） | 当前 HEAD。 |

**关键结论**：每一代新拼装机制诞生时，都不是"替换"前一代，而是"包在外面"或"另开一条入口"。第一代到第二代之间是"另开入口"，第二代到第三代之间是"包在外面"。这两种叠加都不会触发"是否要删除旧的拼装"的代码审查信号，因此重复内容堂而皇之地长期共存。

---

## 四、根因分析：为什么会演化成多入口

按"决定性事件"列出 4 个最重要的拐点。

### 事件 1（2026-04-08 / `5077270`）：PromptExecutor 独立诞生而不是寄生在 group-runtime 上

- **设计意图**：commit message 写得很清楚——"无需依赖 template 即可由 AI 按 prompt 主导完成任务"。当时 group-runtime 是为 template/pipeline 设计的（envelope、source contract、review loop），把 prompt mode 塞进去要么会污染 template 路径要么会写一堆 `if (kind === 'prompt')` 分支。
- **副作用**：从这一刻起，prompt 字段拼装在系统中有了**两个无关联的根入口**——`executePrompt`（prompt-executor.ts）和 `dispatchRun`（group-runtime.ts）。后续任何"prompt 注入新东西"的需求都必须做**双倍工作**才能保持一致；如果只改一边，就开始漂移。
- **是否可避免**：可以。如果第一步就抽出一个 `PromptComposer` 接口（输入：role/target、assets、knowledge、capability context；输出：最终 string），两条执行路径都注入这一个 composer，就不会分岔。但当时 PromptExecutor 是一个 "新功能、小切口" 的工程权衡，没人愿意为了它先做大重构。这是典型的"在错误的时间点选择速度"。

### 事件 2（2026-04-20 / `9966720`）：Capability Pack 采用 "prepend" 而不是 "merge / dedupe"

- **设计意图**：`docs/research/canonical-workflow-department-resolver-implementation-2026-04-16.md` 写得很清楚——目标是"统一 canonical 资产源 + 接入 Department Capability Registry / Resolver"。Resolver 的实现策略是"deterministic resolver，不做 AI 二次选择"——把 workflow / fallback skills / identity rule **打包给 provider**。换句话说，新机制的设计目的是"上下文增强"，不是"接管现有 prompt 拼装"。
- **副作用**：实现选择是 `applyProviderExecutionContext(prompt, context)` ≡ `prependContext(prompt, context.promptPreamble)`（见 `department-execution-resolver.ts:340-343,405-407`）。这是一个 dumb prepend——它**完全不关心 prompt 已经包含什么**。同一份 workflow content 在 capability-pack 里再来一次、在 buildRolePrompt 里又来一次，prepend 不会知道。Resolver 把"`buildSharedContext + formatWorkflowSection`"作为唯一输出，但下游的 buildRolePrompt / buildDeliveryPrompt / buildPromptExecutionPrompt **没有收到通知**说"你不要再拼 workflow 了"。
- **当时是否可避免**：理论上可以——做 capability pack 时，本应同步删除 buildRolePrompt 等 builder 里的 `AssetLoader.resolveWorkflowContent` 调用。但代价是测试要重写、Antigravity 那边的兼容性（IDE 仍然期望 workflow inline 形式）需要重新验证、retry/restart-role 路径里 `run.resolvedWorkflowRef` 还没普及。**风险大，工程团队选了"加，不减"**——这是叠层的标准成因。

### 事件 3（2026-04-20 同一 commit）：workflow-runtime-hooks 又新开一条 workflow 读取路径

- **设计意图**：`prepareWorkflowRuntimeContext` 是为 daily-digest / daily-events / story-top-candidates 这些**有真实运行时副作用**的 workflow 准备的——它要 fetch 数据、跑 Python 脚本、生成 `prepared-ai-digest-context.json`。这本身是合理的，因为它**生成的是动态运行时上下文**，不是静态 workflow 文本。
- **副作用**：但实现里它通过 `getCanonicalWorkflowRuntimeConfig` 又独立读了一次 canonical workflow frontmatter，**和 `buildPromptModeProviderExecutionContext` 内部对 workflow 的解析完全分离**。两个 path 各读一次盘、各做一次 schema 解析。如果 workflow frontmatter 改了字段名，必须同步两处。`promptAppendix` 本身的内容（"Prepared Daily Digest Context" 那段）**只挂到 PromptExecutor**，group-runtime 路径完全不接，因此 dispatched 的 daily-digest run 和 prompt 触发的 daily-digest run 的 prompt 结构是**结构性不同**的——这是另一个隐藏的多入口副作用。
- **当时是否可避免**：可以。runtime hook 应该是 `PromptComposer` 的一个 plugin，而不是只挂在某一条入口上。

### 事件 4（2026-04-26 / `8523889`）：growth assets 通道再次旁路注入

- **设计意图**：company-kernel 的 self-growth kernel 要让"已发布的 GrowthProposal"可以被下次相似任务自动拾取（见 ARCHITECTURE.md L321）。实现方式是 `loadPublishedGrowthAssets` 在 `buildPromptModeProviderExecutionContext` 内拼到 `effectiveWorkflows`。
- **副作用**：第 4 条 workflow 读取路径出现。它**只服务 PromptExecutor**，因为 group-runtime 的 template 路径走 `buildTemplateProviderExecutionContext`，里面**没有** `loadPublishedGrowthAssets`。从此 prompt-mode 和 template-mode 在"是否包含 growth workflow"上**也存在结构性差异**。
- **当时是否可避免**：可以，但这里的根因更复杂——growth proposal 进 capability-pack 本质上是因为没有一个"全局上下文注入器"，只能往 resolver 内部塞。如果有 `PromptComposer + ContextProvider 注册表`，growth provider 应该是其中一个 provider。

### 综合：决定性事件链

这 4 件事不是 4 个独立 bug，是一条因果链：

> 第一代用 `AssetLoader.resolveWorkflowContent` inline 拼接 → 第二代为了"小切口"另开 PromptExecutor 入口 → 第三代用 prepend 形式把 capability-pack 包在外面（不删旧的）→ 第四代继续把 growth、knowledge、runtime-hook 各自独立挂到不同入口。
>
> 每一步都"理性"、每一步都不可避免（在给定约束下）、但合起来就是今天的局面：**N 个 builder × M 个入口 × K 个上下文 provider 的笛卡尔积，没有一处中央协调**。

---

## 五、模块重叠地图

### 5.1 每类资产的加载与注入通道

| 资产类型 | 加载器（读取磁盘 / DB） | 进入 prompt 的通道 | 通道间是否通信 |
|---------|---------------------|-----------------|--------------|
| Workflow MD | (1) `AssetLoader.resolveWorkflowContent` (`asset-loader.ts:216`) — 直接读 `ASSETS_DIR/workflows/<name>.md`<br>(2) `getCanonicalWorkflow` (`canonical-assets.ts:154`) — 读 canonical 资产，含 frontmatter<br>(3) `loadPublishedGrowthAssets` (`department-execution-resolver.ts:117`) — 走 growth proposal store<br>(4) `getCanonicalWorkflowRuntimeConfig` (`canonical-assets.ts:173`) — 给 runtime hook 用 | (a) `buildRolePrompt` / `buildDeliveryPrompt` / `buildRoleSwitchPrompt` 内 inline（group-runtime 路径）<br>(b) `formatWorkflowSection` 在 capability-pack（所有路径）<br>(c) `buildPromptExecutionPrompt` 的 Playbook context（仅 PromptExecutor）<br>(d) `prepareWorkflowRuntimeContext` 的 `promptAppendix`（仅 PromptExecutor） | 无。四个加载器各读各的，三个 / 四个 prompt 通道之间无去重 |
| Identity Rule | `getDepartmentCapabilityView` (`department-capability-registry.ts`) — 读 `.department/config.json` 派生 | 只通过 `buildSharedContext` → capability-pack 注入 | 单一通道（这一个还算正常） |
| Department Local Rules | 同上 | 同上 | 单一通道 |
| Department Skills | (1) `getCanonicalSkill` (`canonical-assets.ts:232`)<br>(2) capability view 的 `view.skills`<br>(3) `loadPublishedGrowthAssets` 的 `growthAssets.skills` | 只通过 `formatSkillSection` → capability-pack 注入（且 `buildPromptModeProviderExecutionContext` 里 `effectiveSkills` 与 capability view 已经做了 dedupe by name） | dedupe 仅限 capability-pack 内部，**只针对 skill**（对 workflow 没做同样的去重，因为没人觉得需要——直到现在） |
| Knowledge Assets | `retrieveKnowledgeAssets` (`knowledge/retrieval.ts:67`) | 仅 PromptExecutor 路径，作为 `retrievedKnowledgeSection` | 单一通道，但**只接 PromptExecutor**，group-runtime 路径完全无 knowledge 召回 — 这是另一种"多入口副作用"（不是重复，是结构性缺失） |
| Runtime Helper Context (daily-digest 之类) | `prepareWorkflowRuntimeContext` (`workflow-runtime-hooks.ts:906`) | 仅 PromptExecutor 路径，作为 `promptAppendix` | 单一通道，仅 PromptExecutor 接 |
| Template (DAG / pipeline) | `AssetLoader.loadTemplates` (`asset-loader.ts:33`) | 不直接进 prompt 字符串，但 `buildTemplateProviderExecutionContext` 读 `getTemplateWorkflowRefs(templateId)` 反查 workflow，再走 (b) | 反查通道与 (b) 衔接（已知正确） |
| Task Envelope | `getCanonicalTaskEnvelope` (group-runtime 内部) | 作为 stage context 在 buildRolePrompt 内引用路径（不是 inline 内容） | 单一通道 |

**图形化总结**：

```
                       ┌────────── ASSETS_DIR/workflows/*.md ──────────┐
                       │                                                │
        AssetLoader ───┤    ←——— GLOBAL_ASSETS_DIR（gateway-home）       │
                       │                                                │
                       └─→ resolveWorkflowContent ─→ buildRolePrompt    │   group-runtime
                                                  ─→ buildDeliveryPrompt│ ←─── 入口
                                                  ─→ buildRoleSwitchPrompt
                                                  ─→ buildPromptExecutionPrompt(Playbook)←┐
                                                                                          │
        canonical-assets ──→ getCanonicalWorkflow ───→ formatWorkflowSection ─┐           │
                       │     getCanonicalSkill    ───→ formatSkillSection     ├──→ capability-pack
                       │                                                       │  → applyProviderExecutionContext
        growth-proposal-store ──→ loadPublishedGrowthAssets ──────────────────┘    (prepend)
                                                                                          │
        workflow-runtime-hooks ─→ prepareWorkflowRuntimeContext ─→ promptAppendix ────────┤
                                                                                          │   PromptExecutor
        knowledge/retrieval ───→ retrieveKnowledgeAssets ─→ formatKnowledgeAssetsForPrompt┤ ←─── 入口
                                                          ─→ retrievedKnowledgeSection
```

蓝色箭头都汇到 PromptExecutor 的 `composedPrompt = applyProviderExecutionContext([…].join('\n\n'), context)` 单一字符串里——但同一个 workflow 名字会从 capability-pack、Playbook context、runtime appendix 三处出现各自的内容。没有任何一处对"这份 workflow 已经在 prompt 里了"做记账。

---

## 六、系统性根因（5 条）

每条都从"现象 / 设计 / 后果"三个层面拆。

### 根因 1：`applyProviderExecutionContext` 是一个 prepend，不是一个 funnel

- **现象层面**：`src/lib/agents/department-execution-resolver.ts:405-407`，整个函数只做 `prependContext(prompt, context.promptPreamble)`，即 `${preamble}\n\n${prompt}`。
- **设计层面**：当初引入它时的目标是"在不动既有 prompt 模板的前提下补丁式注入部门上下文"，所以选了最 narrow 的语义——拼接而非接管。
- **后果层面**：所有调用方都把它当"上下文注入完毕的标志"，但它不知道自己 prepend 的内容是否已经存在于 prompt 里，调用方也不知道彼此往里塞了什么。**这是叠层结构得以无声共存的工程基础。**

### 根因 2：没有"PromptComposer"接口，每个执行路径自己拼

- **现象层面**：`buildRolePrompt`、`buildDeliveryPrompt`、`buildRoleSwitchPrompt`、`buildRetryPrompt`、`buildPromptExecutionPrompt` 五个独立函数，分别在 `prompt-builder.ts` 与 `prompt-executor.ts` 中实现，**互相不知道对方的存在**，且全部独立调用 `AssetLoader.resolveWorkflowContent`。
- **设计层面**：第一代代码就是"function builder 模式"（pure builder + AssetLoader），第二代继承了这套，第三代选择 prepend 而不是 funnel，于是"一个 builder 一个职责"的模式从未升级到"composer + plugin"。
- **后果层面**：每加一个上下文（knowledge / runtime hook / growth / capability）都得选一个 builder 改一处，要么就另开一条挂载点。久而久之，"接哪条线"完全是 commit 顺序决定的，而不是设计决定的。group-runtime 没接 knowledge 不是因为它不需要，是因为 knowledge 是后来才出现的、当时只有人愿意改 PromptExecutor。

### 根因 3：双根入口（`executePrompt` vs `dispatchRun`）是无关联并行体

- **现象层面**：`scheduler.ts:706-780` 三个 action 路由——`dispatch-prompt` 走 `executePrompt`，`dispatch-pipeline` 走 `executeDispatch`，`dispatch-execution-profile` 按 target.kind 在两者间二选一。
- **设计层面**：PromptExecutor 当初是"轻量、绕开 template"的解药；group-runtime / dispatch-service 是"重型、走 template"的主流。两者公用 backend 层，但是**不公用 prompt 层**。
- **后果层面**：任何 prompt 层的能力（knowledge RAG、runtime appendix、growth assets、未来的 RAG-cache、token budget pre-check）都必须问"接哪条入口"。如果只接一条，prompt mode 与 template mode 的输出契约就会发生隐性差异；如果接两条，就要写两份代码。

### 根因 4：资产读取链路四套并行（AssetLoader / canonical-assets / runtime config / growth-store）

- **现象层面**：上面"模块重叠地图"5.1 一表已陈列。
- **设计层面**：`AssetLoader` 是第一代（按文件名读盘），`canonical-assets` 是第三代（按 frontmatter 解析），`workflow-runtime-hooks` 是第三代里的运行时分支（按 `runtimeProfile` 派生），`growth-proposal-store` 是第四代（按 proposal 状态过滤）。每一代都是为了一个新需求新建的，**没有任何一代把前一代收编为内部实现**。
- **后果层面**：(a) 同一份 workflow content 可能从两条路径各被读一次，造成内存浪费和潜在不一致；(b) frontmatter schema 改动需要在多处同步；(c) 没有一处可以做"按 workflowRef 全局去重 / 缓存 / token budget"的中央化决策。

### 根因 5：没有任何一处把"prompt 已经包含 X"显式记账

- **现象层面**：整个仓库找不到 `injectedAssets`、`promptLedger`、`composedSections`、`SeenWorkflows` 一类的概念。`appendRunHistoryEntry` 记录的是"workflow.preflight.completed / knowledge.retrieval.injected" 这种**业务事件**，而不是"我刚才把 workflow X 的内容塞进了 prompt 的哪一段"。
- **设计层面**：因为根因 1 选择了 prepend 而非 funnel，根因 2 没有 composer，于是从来没有一个对象承担"我是这条 prompt 的状态"的角色。状态被打散在多个局部变量里 (`composedPrompt`、`sections.join('\n')`、`promptPreamble`)。
- **后果层面**：(a) 重复检测无处实施；(b) prompt 长度无法在拼装阶段被精准控制（只能事后估算）；(c) token cost 归因无法精确到"哪段贡献了多少 token"；(d) 复盘工具看不到 prompt 的"成分清单"，只能看最终字符串。

---

## 七、合并 / 收敛路径建议（架构级）

### 短期 (1-2 周) — 最小切口止血

目标：**先消除 workflow MD 重复注入**，不动结构。

1. 在 `prompt-builder.ts` 的 5 个 builder（`buildRolePrompt` / `buildDeliveryPrompt` / `buildRoleSwitchPrompt` / `buildRetryPrompt` / 以及 `prompt-executor.ts` 的 `buildPromptExecutionPrompt`）中，**新增可选参数 `skipWorkflowInline: boolean`**。
2. 在调用 `applyProviderExecutionContext` 之前判断：若 `context.promptPreamble` 已经包含 capability-pack（即 `resolvedWorkflowRef` 存在），把 `skipWorkflowInline = true` 透传进 builder，**builder 内部跳过 `AssetLoader.resolveWorkflowContent`**。
3. 单测保护：测试 `composedPrompt` 中 `### <workflowName>` 段或 workflow 关键内容**只出现一次**。
4. 同时把 `buildRoleSwitchPrompt` 也用 `applyProviderExecutionContext` 包一层，消除入口 #6 漏接 preamble 的边界差异。

成本：单个 PR、500-800 行（含测试）。
风险：低，每个 builder 都是 pure function，影响面收敛在 prompt 字符串。
**收益最高的一项**。

### 中期 (1-2 月) — 引入 PromptComposer ledger

目标：**把"prompt 拼装"提升为系统性概念**，5 个 builder 各自往里推内容，由 composer 仲裁。

1. 新建 `src/lib/agents/prompt-composer.ts`，定义：
   ```ts
   class PromptComposer {
     pushSection(kind: SectionKind, key: string, content: string): void;
     hasSection(key: string): boolean;
     compose(): { prompt: string, ledger: PromptLedgerEntry[] };
   }
   ```
   其中 `kind` 是枚举 `'identity' | 'rules' | 'workflow' | 'skill' | 'playbook' | 'runtime-helper' | 'knowledge' | 'task' | 'goal'`，`key` 用资产 ref（如 `/ai_digest`、`skill:browser-testing`）做去重 key。
2. 把 `applyProviderExecutionContext` 改写为 `composer.pushCapabilityPack(view, executionProfile)`，**内部按 section 推进而不是 prepend 一整块**。
3. 把 `buildRolePrompt` 等 5 个 builder 改造成 "consume composer"——它们调 `composer.pushSection('workflow', ref, content)`，如果 composer 已经有这个 key 就不重复推。
4. group-runtime 与 prompt-executor 都通过 `composer` 出口拿最终字符串，并把 `ledger` 写进 run history（用作复盘）。
5. 把 `prepareWorkflowRuntimeContext` 改成一个 `ContextProvider` 注册项，让 group-runtime 路径也能接（解决根因 3 的副作用）。

成本：3-4 个 PR，约 2000-3500 行（含测试），需要回归 daily-digest / daily-events / story-top-candidates 三类 runtime hook 端到端测试。
风险：中。改动覆盖所有 prompt 入口，但 builder 内部 pure 的特性提供了相对安全的改造基础。
**收益**：从此 prompt 拼装可观察、可去重、可计量；新增 context 入口（例如 cache / RAG-cache / token budget pre-check）有统一接入点。

### 长期 (半年) — 统一 LLM-bound 字符串拼装到 PromptComposer service

目标：**把 PromptComposer 推广到所有发往 LLM 的字符串字段**（不仅是 agent runs，还包括 supervisor 的 `summarizeStepForSupervisor`、CEO 的对话 system prompt、Claude Engine 的 memory-prompt-builder、ceo-prompts.ts 等）。

1. PromptComposer 升级为 `service` 而不是 per-run 对象，支持 `compose(scope: RunScope)`，并支持 section-level snapshotting（用于 retry / fork conversation）。
2. 把 `src/lib/claude-engine/memory/memory-prompt-builder.ts`（另一个独立体系，目前只服务 Claude Engine）、`ceo-prompts.ts` 与 `supervisor.ts` 的 prompt 构造都迁进来。
3. 引入 `PromptBudgetPolicy` —— 在 composer 内执行 token budget pre-check 与按优先级裁剪（先丢 knowledge、再丢 skill fallback、最后才丢 workflow）。
4. ARCHITECTURE.md 增加一节 "Prompt Composition Layer"，把 composer 列为与 backend 层平级的"L2.5 prompt 服务"。

成本：跨季度的体系化重构。
价值：彻底解决根因 1-5。
是否值得：**值得**。当前 5 个 builder + 4 个加载链路 + 8 个入口 + N 类 context 的局面只会随着功能新增（multi-agent 调度、RAG-cache、token budget、长会话上下文压缩）继续恶化。**不做 composer，新功能每加一个都得在 N 个地方接线**。

---

## 八、风险与建议优先级

### 不修的话，新增什么功能会再放大重复

1. **RAG cache / 长上下文压缩**：势必再开第 5 条独立通道。
2. **per-skill 的 dedicated context**：会继续延长 capability-pack 而又无法保证不与 Playbook context 冲突。
3. **CEO Office 引入多 stage 决策**：CEO 的 prompt 会同时引用 capability-pack + supervisor summary + memory prompt + project context，重复风险线性放大。
4. **跨部门 workflow 复用**：growth assets 会被两个 capability view 各自注入，重复 × 2。
5. **token 预算 hard gate**：在 prepend 模式下根本无法做精准 budget，最多只能事后估算。

### 修的话，三个阶段的主要风险

| 阶段 | 主要风险 | 缓解 |
|------|---------|------|
| 短期 | builder 跳过 inline 后，对没有 `resolvedWorkflowRef` 的 legacy 任务（例如手写 prompt + 无 promptAssetRefs）可能丢 workflow | 默认 `skipWorkflowInline = false`；仅当 `executionContext.resolvedWorkflowRef` 非空时切到 `true` |
| 中期 | composer ledger 改造涉及所有 prompt 入口，回归面大 | 分阶段灰度：先 PromptExecutor，再 group-runtime；每条路径单独跑 acceptance test |
| 长期 | 跨子系统（Claude Engine memory prompt、CEO playbook、supervisor summary）合并阻力大 | 设独立 PromptComposer service，子系统按各自节奏接入，最后再决定是否合二为一 |

### 优先级排序（收益 ÷ 成本）

1. **短期 P0**：消除 workflow MD 双重注入。**收益最高、成本最低、风险最小**。建议本周内做。
2. **中期 P1**：PromptComposer + ledger（含 `prepareWorkflowRuntimeContext` 接入 group-runtime 路径）。**消除根因 1、2、5**，并把根因 3、4 的副作用降到可观测。
3. **长期 P2**：跨子系统统一。**只有在中期落地后再启动**——否则 scope 过大、改不动。

---

## 附录 A：所有 prompt 入口的代码定位清单

直接拼最终 prompt 字符串字段：

| # | 路径 | 路径含义 |
|---|------|---------|
| A1 | `src/lib/agents/prompt-executor.ts:511` | Prompt Mode 主入口（`composedPrompt`） |
| A2 | `src/lib/agents/group-runtime.ts:1174` | legacy-single executionMode（`composedPrompt`） |
| A3 | `src/lib/agents/group-runtime.ts:1663` | restart-role retry（`retryPrompt`） |
| A4 | `src/lib/agents/group-runtime.ts:2108` | delivery-single-pass（`prompt`） |
| A5 | `src/lib/agents/group-runtime.ts:2275` | review-loop per-role per-round（`rolePrompt`） |
| A6 | `src/lib/agents/group-runtime.ts` shared-conversation 段落 | role switch via `buildRoleSwitchPrompt` — **未经 applyProviderExecutionContext** |

向 backend 提交 prompt 的 builder：

| # | 路径 | 路径含义 |
|---|------|---------|
| B1 | `src/lib/agents/prompt-builder.ts:43 buildRoleSwitchPrompt` | shared cascade 内 role 切换 prompt |
| B2 | `src/lib/agents/prompt-builder.ts:88 buildRolePrompt` | review-loop / artifact-heavy role prompt |
| B3 | `src/lib/agents/prompt-builder.ts:183 buildDeliveryPrompt` | delivery role prompt（带 work-package 分支） |
| B4 | `src/lib/agents/prompt-executor.ts:181 buildPromptExecutionPrompt` | Prompt Mode role prompt |
| B5 | `src/lib/agents/group-runtime.ts` 内 inline `${workflowContent}\n\n${goal}` | legacy-single 路径 inline 拼接 |
| B6 | `src/lib/agents/group-runtime.ts buildRetryPrompt` | restart-role 兜底 prompt |

capability / context provider：

| # | 路径 | 含义 |
|---|------|------|
| C1 | `src/lib/agents/department-execution-resolver.ts:452 buildPromptModeProviderExecutionContext` | Prompt Mode 上下文（含 effectiveWorkflows / effectiveSkills / growth assets） |
| C2 | `src/lib/agents/department-execution-resolver.ts:410 buildTemplateProviderExecutionContext` | Template 上下文（不含 growth） |
| C3 | `src/lib/agents/department-execution-resolver.ts:323 buildSharedContext` | 两者共享的 identity + local rules + allowed templates 段 |
| C4 | `src/lib/agents/department-execution-resolver.ts:295 formatWorkflowSection` | capability-pack 内"Department Workflows" 段 |
| C5 | `src/lib/agents/department-execution-resolver.ts:305 formatSkillSection` | capability-pack 内"Department Skills" 段 |
| C6 | `src/lib/agents/department-execution-resolver.ts:340 prependContext` | 实际的 prepend 操作 |
| C7 | `src/lib/agents/department-execution-resolver.ts:405 applyProviderExecutionContext` | 包装入口 |
| C8 | `src/lib/agents/workflow-runtime-hooks.ts:906 prepareWorkflowRuntimeContext` | runtime profile dispatcher |
| C9 | `src/lib/agents/workflow-runtime-hooks.ts:247 prepareAiDigestContext` | daily-digest 运行时上下文 |
| C10 | `src/lib/agents/workflow-runtime-hooks.ts:358 prepareStoryTopCandidatesContext` | story-top runtime |
| C11 | `src/lib/agents/workflow-runtime-hooks.ts:406 prepareAiBigEventContext` | daily-events runtime |
| C12 | `src/lib/knowledge/retrieval.ts:67 retrieveKnowledgeAssets` | knowledge RAG 召回 |
| C13 | `src/lib/knowledge/retrieval.ts:84 formatKnowledgeAssetsForPrompt` | knowledge 段拼装 |

资产加载器（读盘 / DB）：

| # | 路径 | 含义 |
|---|------|------|
| L1 | `src/lib/agents/asset-loader.ts:216 AssetLoader.resolveWorkflowContent` | 第一代 workflow 读取（按 path 直读 md） |
| L2 | `src/lib/agents/canonical-assets.ts:154 getCanonicalWorkflow` | 第三代 canonical workflow 解析（含 frontmatter） |
| L3 | `src/lib/agents/canonical-assets.ts:232 getCanonicalSkill` | canonical skill |
| L4 | `src/lib/agents/canonical-assets.ts:173 getCanonicalWorkflowRuntimeConfig` | runtime hook 专用解析 |
| L5 | `src/lib/agents/department-execution-resolver.ts:117 loadPublishedGrowthAssets` | growth-store → CanonicalWorkflow/Skill |
| L6 | `src/lib/agents/department-capability-registry.ts getDepartmentCapabilityView` | 组装 identity / local rules / template allowlist / skills 视图 |

调度入口：

| # | 路径 | 含义 |
|---|------|------|
| E1 | `src/lib/agents/scheduler.ts:706 dispatch-prompt` → `executePrompt` | scheduler prompt 任务 |
| E2 | `src/lib/agents/scheduler.ts:725 dispatch-execution-profile (kind=prompt)` → `executePrompt` | scheduler execution profile（prompt 分支） |
| E3 | `src/lib/agents/scheduler.ts:765 dispatch-pipeline` → `executeDispatch` | scheduler pipeline 任务 |
| E4 | `src/lib/agents/scheduler.ts:744 dispatch-execution-profile (kind=review-flow)` → `executeDispatch` | scheduler execution profile（template 分支） |
| E5 | `src/lib/agents/dispatch-service.ts:86 executeDispatch` | 所有 template 派发入口 |
| E6 | `src/lib/agents/group-runtime.ts:968 dispatchRun` | template/stage 真正执行入口 |
| E7 | `src/lib/agents/prompt-executor.ts executePrompt` | prompt mode 真正执行入口 |
| E8 | `src/lib/agents/ceo-agent.ts` 内 CEO 即时指令 → 选择 E1/E7 | CEO 决策层 |

---

## 附录 B：关键 Git Commits（按时间正序）

| Commit | 日期 | Message 摘要 | 与本议题的关系 |
|--------|------|-------------|--------------|
| `50f7db7` | 2026-03-26 | chore: 全量提交所有未跟踪和已修改的文件 | **第一代 Prompt 拼装诞生**：group-runtime + asset-loader + 内联 `AssetLoader.resolveWorkflowContent`。原始 `composedPrompt = \`${workflowContent}\n\n${goal}\``。 |
| `1de02e5` | 2026-04-06 | feat: Phase 6 core engine upgrades and documentation alignment | 抽出 `prompt-builder.ts`、`dispatch-service.ts`、引入 `executeDispatch`；DAG / graph-compiler 一并落地。Prompt 拼装的"builder 风格"被固化但未升级。 |
| `6cebb43` | 2026-04-06 | feat: finalize stage-centric pipeline migration | stage-centric 迁移；prompt 层不动。 |
| `9148b3d` | 2026-04-06 | huancun | （未带描述）pipeline 索引化。 |
| `5077270` | 2026-04-08 | feat: PromptExecutor 端到端实现 — 运行时/CEO/Scheduler/前端/文档 | **第二代 Prompt 拼装诞生**：PromptExecutor 走自己的 `buildPromptExecutionPrompt`，scheduler 增 `dispatch-prompt`。两个根入口正式并存。 |
| `661243c` | 2026-04-10 | chonggou yiban（重构一半） | message 直接承认是半截重构。 |
| `9966720` | 2026-04-20 | chore: snapshot current OPC CEO codebase | **第三代 Prompt 拼装诞生**：`canonical-assets.ts`、`department-capability-registry.ts`、`department-execution-resolver.ts`、`workflow-runtime-hooks.ts` 同期出现；`applyProviderExecutionContext` 把 capability-pack 包到既有 prompt 外面；**buildRolePrompt / buildDeliveryPrompt 内 `AssetLoader.resolveWorkflowContent` 未删除**——双重注入从此存在。 |
| `8523889` | 2026-04-26 | feat: add company self-growth kernel | **growth assets 通道接入**：`loadPublishedGrowthAssets` 写入 `buildPromptModeProviderExecutionContext`；workflow-runtime-hooks 新增 daily-events / story-top 等 runtime profile。第 4 条独立 workflow 入口。 |
| `130a8c2` | 2026-05-01 | checkpoint: stabilize self-evolution execution boundary | 增量稳定，不改结构。 |
| `35d4c71` | 2026-05-04 | chore: checkpoint self-evolution and platform updates | 同上。 |
| `076a52c` | 2026-05-07 | Stabilize self-improvement control and direct Codex flow | 同上。 |
| `0ae1db2` | 2026-05-09 | chore: sync workspace updates | 当前 HEAD。 |

---

## 结语

回到用户的原始疑问——"**这逻辑本应是系统性的，怎么会有多个系统、多个入口？**"

答案不是 "有人偷懒"，也不是 "并行开发互踩"。答案是：

> **每一代设计都在自己的局部最优解上做了正确的工程选择，但项目从来没有在两代之间停下来做"是否要把上一代收编"的全局取舍。**
>
> 第一代是单 entrypoint inline builder；第二代为了快，复制了一份 builder 而不是抽象；第三代为了不破坏既有契约，选了 prepend 而不是 funnel；第四代继续往 prepend 的链条上挂新通道。每一次都是 "做加法"，没有一次是 "做减法 + 做抽象"。
>
> 这是软件考古学里最经典的"沉积岩地层"：每一层都是一次合理决策的化石，叠在一起就是今天的多入口 / 多系统 / 多重复。

短期止血是 1 个 PR，中期收敛需要一个 `PromptComposer`，长期统一需要把 prompt 拼装升格为与 backend 层平级的服务。问题不严重——所有 builder 仍然是 pure function、所有调用点都集中在 `src/lib/agents/*`——但**再不收敛，从加 RAG cache 那一天起就会失控**。
