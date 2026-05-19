# PromptComposer 改造方案 v3（最终版）

> **日期**: 2026-05-11
> **状态**: 最终版（取代 v2.1 `prompt-composer-target-architecture-v2-2026-05-11.md`）
> **关联**:
> - 考古: `docs/research/prompt-composition-systemic-analysis-2026-05-11.md`
> - 修正: `docs/research/scheduler-and-prompt-actual-state-correction-2026-05-11.md`

本文档仅 3 章：核心问题 / 预计修改的点以及收益 / 架构调整影响。所有评审 v2.2 必修项已融入正文。

---

## 1. 核心问题

**总览**：当前 prompt 装配由 5 个 builder × 8 个入口 × 4 套加载器 × N 个上下文 provider 笛卡尔积构成，无中心 funnel、无去重 ledger、无成分清单；prompt mode 与 template mode 因入口不同而结构性差异。

| # | 问题 | 证据位置 | 业务影响 |
|---|------|---------|---------|
| ★1 | 同一份 workflow MD 全文重复注入 ×2（capability-pack 段 + buildRolePrompt/buildDeliveryPrompt 内 inline） | `department-execution-resolver.ts:295` `formatWorkflowSection` + `prompt-builder.ts:88` 内 `AssetLoader.resolveWorkflowContent` | 单 prompt ~2500 token 中 ~1300 token 重复；模型注意力分裂、输出质量下降 |
| ★2 | PromptExecutor 路径再多一份 Playbook context（同 workflow 第二副本）+ runtime appendix（新内容，不计重复） | `prompt-executor.ts:511`（`.join('\n\n')` 三段）；`workflow-runtime-hooks.ts:906` | daily-digest 每次浪费 ~1300 token；与 group-runtime 路径上下文结构性不一致 |
| ★3 | Schema 在 3 处独立维护，漂移风险 | (a) workflow MD frontmatter；(b) `workflow-runtime-hooks.ts` 的 `runtimeProfile` 字符串 switch；(c) `canonical-assets.ts:173` `getCanonicalWorkflowRuntimeConfig` | 改 frontmatter 字段名需同步 3 处，漏一处静默失效 |
| ★4 | `affectedAreas` 用 TS 联合语法 `'a' \| 'b' \| 'c'` 出现在 prompt 字符串里冒充 JSON schema（**位于 runtime hook 内的 inline schema，不是 frontmatter**） | `workflow-runtime-hooks.ts:383` | 模型把 `\|` 误读为 markdown 表格分隔符；属 WorkflowRuntimeProvider 输出契约问题 |
| ★5 | Frontmatter（runtime / schedule / scripts）原文随 `workflow.content` 整段进 prompt | `canonical-assets.ts:161` 直接 `fs.readFileSync` 不剥；`formatWorkflowSection` push 完整 content | 每 prompt 浪费 ~200-400 token 在运维元数据 |
| ★6 | runtime hook 多 round × N 副作用放大（python spawn / fetch / `recordKnowledgeAssetAccess`） | `workflow-runtime-hooks.ts:215+` child_process / fetch / knowledge access；review-loop 每 round 每 role 各调一次 | review-loop 一轮 6 个 role → fetch_context.py spawn 6 次、knowledge access 重复 record；token & I/O 浪费 |
| ★7 | prompt mode 与 template mode 结构性不同 —— template 路径完全没有 `resolvedWorkflowRef` 派生入口；runtime appendix / knowledge / growth assets 只接 PromptExecutor | `dispatch-service.ts:215-216` `buildTemplateProviderExecutionContext` 调用处 **不传 resolvedWorkflowRef**；`prompt-executor.ts:181/511` 独占 runtime appendix + knowledge 注入 | 同一份 daily-digest workflow 由调度触发 vs prompt 触发，prompt 字符串结构性不同；调试时无法用同一份 fixture 复现 |
| ★8 | 装配过程不可见 —— 仓库内不存在 `composedSections` / `promptLedger` 概念 | 全仓库 grep 0 命中 | 复盘只能 diff 全文，无法定位"哪段 provider 注入了什么、为什么超长" |

---

## 2. 预计修改的点以及收益

主体清单（按落地顺序）。每行带文件位置 / 收益 / 命中问题 / 工作量。

| # | 改造点 | 文件位置 | 改成什么 | 收益 | 命中 | 工作量 |
|---|--------|----------|----------|------|------|--------|
| 1 | **M0-a** snapshot 锁定现状 | 新建 `prompt-composer/__tests__/snapshot-*.test.ts` 覆盖 6 个 builder + PromptExecutor 入口 | golden fixture 固化当前拼装行为；后续每次切换前/后跑 diff | 守护 M1-M6 期间零回归；为 M0-b skip flag 提供安全网 | ★1-★8 | 0.5 PR / 300 行 |
| 2 | **M0-b** ⚠️ `skipWorkflowInline` 灰度（**仅 PromptExecutor 单 workflow prompt-mode 止血**） | `prompt-executor.ts:181/511` + `prompt-builder.ts:66/105/200/228` 加可选参数；feature flag `PROMPT_COMPOSER_SKIP_INLINE` **默认 off** | 当 `executionContext.resolvedWorkflowRef` 非空 → `skipWorkflowInline=true`；**不承诺零业务风险**（skip 一开 prompt 字符串变化、snapshot diff），仅 PromptExecutor 路径止血 | 单 prompt workflow MD 出现次数 2 → 1，节省 ~600 token；group-runtime / retry / role-switch / legacy-single **不在 M0 处理**（见下行） | ★1 | 0.5 PR / 200 行 |
|   | **⚠ M0 边界说明** | — | M0 在 group-runtime 流量下覆盖率为 0：`dispatch-service.ts:215-216` 不传 `resolvedWorkflowRef` → `buildTemplateProviderExecutionContext` 源头没派生 → skip 触发条件命中 0 次。**group-runtime 完整改造放到 M6** | retry (`group-runtime.ts:1663` `promptPreamble: ''` + `:1934/:1955` inline workflow) / role-switch (`:2305-2331` 直接调 `session.send`，不走 `applyProviderExecutionContext`) / legacy-single (`:1173` 字符串硬拼，不经 builder) 这 3 条单独风险路径在 M6-b 处理 | — | — | — |
| 3 | **M1** 类型骨架 + zod schema 派生 | 新建 `src/lib/agents/prompt-composer/types.ts` + `asset-schema.ts` | `PromptSection / PromptLedgerEntry / ContextProvider / AssetRef` TS 接口；`WorkflowFrontmatterSchema = z.object({ runtimeProfile: z.enum(...), affectedAreas: z.array(z.string()), schedule: z.string().optional() })`；`affectedAreas` 类型从 `src/lib/story-top-candidates.ts` 的 `StoryTopCandidatePayload` 派生 | schema 单一真理源；P3 / P4 修复 | ★3 ★4 | 1 PR / 200 行 |
| 4 | **M2** AssetRegistry 上层切 raw/body/meta（**canonical-assets.ts 不动**） | 新建 `prompt-composer/asset-registry.ts`；收编 `asset-loader.ts:216` / `canonical-assets.ts:154,173,232` / `department-execution-resolver.ts:117` | registry 内 `stripFrontmatter()` 出 `raw / body / meta`；**`canonical-assets.ts:161` 保持原行为返回 raw**（`/api/workflows/[name]/route.ts:53` 编辑链路依赖完整 markdown）；prompt 注入读 `body`，canonical API + workflow 保存读 `raw` | 同一 ref 一 run 内读盘 1 次；frontmatter 不再出现在 LLM prompt（节省 ~200-400 token）；canonical API 编辑链路零破坏 | ★5 ★6 | 2 PR / 500 行 |
| 5 | **M3-a** 8 个通用 ContextProvider（含 ⚠ 副作用守门） | 新建 `prompt-composer/providers/*.ts` | `DepartmentIdentity / LocalRules / Workflow / WorkflowRuntime / Skill / GrowthAssets / KnowledgeRetrieval / TaskGoal`。**`WorkflowRuntimeProvider.shouldRun` 默认 false**，仅 `scope.target.runtimeProfile ∈ {daily-digest, daily-events, story-top-candidates}` 时启用；**`KnowledgeRetrievalProvider.shouldRun` 默认 false**，仅 prompt mode 启用。独立 flag `PROMPT_COMPOSER_RUNTIME_HOOKS_IN_TEMPLATE_MODE / KNOWLEDGE_IN_TEMPLATE_MODE` 控制是否在 template mode 启用 | ★6 副作用收口；★7 结构性差异收口 | ★6 ★7 | 3 PR / 800 行 |
| 6 | **M3-b** 4 个 stage-specific ContextProvider | `prompt-composer/providers/stage-*.ts` | `StageContextProvider`（task envelope + work package + execution contract）/ `ArtifactContextProvider`（input + upstream artifacts）/ `AssignmentProvider`（review / delivery assignment）/ `RetryProvider`（retry context + failure history） | 覆盖 `buildRolePrompt:105` / `buildDeliveryPrompt` / `buildRoleSwitchPrompt` / `buildRetryPrompt`（`group-runtime.ts:1921`）输出段 | ★1 ★7 | 2 PR / 500 行 |
| 7 | **M4** PromptComposer + Ledger（双键去重） | 新建 `prompt-composer/composer.ts`；feature flag `PROMPT_COMPOSER_V2=off` 默认关 | `composer.compose(scope)` 出口；ledger 双键（contentHash + canonicalRef）；dedupe 命中 → 第二次替换为 `[See: <ref> above]` 引用指针 | workflow MD 出现次数从 2 → 1（~600 token / prompt）；任何重复都被 ledger 显式记账 | ★1 ★2 ★8 | 1 PR / 300 行 |
| 8 | **M4 配套** composer 内 per-run runtime-cache | 同 composer.ts | review-loop 多 round 共享 `PreparedContext`（runtime hook 输出、knowledge 召回结果） | review-loop fetch_context.py spawn 从 6 → 1；knowledge `recordKnowledgeAssetAccess` 从 N → 1；整轮幂等 | ★6 | 0.5 PR / 100 行 |
| 9 | **M5** PromptExecutor 入口切到 composer | `prompt-executor.ts:511` 把 `.join('\n\n') + applyProviderExecutionContext(...)` 替换为 `composer.compose({mode:'prompt', ...}).text` | 单入口、自动去重 | 端到端 prompt mode 落地：workflow MD = 1，token 节省 ~50% | ★1 ★2 | 1 PR / 200 行 |
| 10 | **M6-a** group-runtime 5 处入口切换（含覆盖度 gate） | `group-runtime.ts:1174`（legacy-single）/ `:1663`（restart-role）/ `:2108`（delivery-single-pass）/ `:2275`（review-loop）/ `~2310`（role-switch）；`department-execution-resolver.ts:405 applyProviderExecutionContext` 改为 composer thin wrapper | **切换前 gate**：4 个 stage-specific provider snapshot diff = 0；之后再切。同步删除内层 `AssetLoader.resolveWorkflowContent` 调用 | template 路径与 prompt 路径上下文契约对齐；★7 结构性差异消除 | ★1 ★7 | 3 PR / 600 行 |
| 11 | **M6-b** retry / role-switch / legacy-single 单独处理 | retry: `group-runtime.ts:1663/:1934/:1955`；role-switch: `:2305-2331`（绕过 `applyProviderExecutionContext`）；legacy-single: `:1173`（字符串硬拼） | 三条路径**不能套同一 skip 逻辑**，须改 group-runtime 自身：retry 显式调 composer 并提供 `RetryProvider` 数据；role-switch 改走 composer（不再直发 session.send）；legacy-single 走 composer.compose 替换硬拼 | skip flag 在这 3 路径下失效的根因消除；workflow 不再因路径不同而漏注入 | ★1 ★7 | 2 PR / 400 行 |
| 12 | **Observability 防污染** | `composer.compose()` 末尾写 `prompt.composed.{json,md}`；**`run-artifacts.ts:122-210` `ignoredPromptRootFiles` 黑名单加 `prompt.composed.json/.md`**；summary 走 `appendRunHistoryEntry` 事件（新增 `prompt.composed` 类型） | 不直接写 `artifactAbsDir` 根目录；阻止 `gateway-db.ts:1634 syncRunArtifactsToDeliverables` → SQLite deliverables → run capsule → 三套 UI 面板污染 | 装配可视、不污染 deliverables；★8 修复 | ★8 | 1 PR / 150 行 |
| 13 | **消费层显式覆盖** | `department-capability-registry.ts:632`、`prompt-builder.ts:66/105/200/228`、`group-runtime.ts:1173/1934/1955`、`prompt-executor.ts:177`、`workflow-runtime-hooks.ts:215`、`api/pipelines/[id]/route.ts:32` | 全部改为读 `AssetRegistry` 的 `body` 出口（不再各自 `fs.readFileSync` / `AssetLoader.resolveWorkflowContent`） | 4 套加载器收编完成；同一 ref 全 run 单次读盘 | ★3 ★5 | 1 PR / 200 行 |

**Provider 数量两个选项**：

- ★ **最小集（9 provider）= 6 通用 + 3 stage-specific**：去掉 Memory / Growth provider 与 1 个可选 stage-specific（如 RetryProvider 暂复用 StageContextProvider 输出）。本期推荐。
- **完整集（12 provider）= 8 通用 + 4 stage-specific**：含全部，覆盖未来 multi-role review-loop / cross-department workflow 复用。

总规模：约 12-14 PR，~3700 行（含测试）。新代码集中在 `src/lib/agents/prompt-composer/*`，旧文件以最小切口接入。

---

## 3. 架构调整影响

### 3.1 影响的文件清单

**读取层**（4 套加载器收编入 AssetRegistry）
- `src/lib/agents/asset-loader.ts:216 resolveWorkflowContent`
- `src/lib/agents/canonical-assets.ts:154 getCanonicalWorkflow` / `:173 getCanonicalWorkflowRuntimeConfig` / `:232 getCanonicalSkill`
- `src/lib/agents/department-execution-resolver.ts:117 loadPublishedGrowthAssets`

**消费层**（改为读 AssetRegistry body 出口）
- `src/lib/agents/department-capability-registry.ts:632`
- `src/lib/agents/prompt-builder.ts:66/105/200/228`
- `src/lib/agents/group-runtime.ts:1173/1934/1955`
- `src/lib/agents/prompt-executor.ts:177`
- `src/lib/agents/workflow-runtime-hooks.ts:215`
- `src/app/api/pipelines/[id]/route.ts:32`

**调用入口**（切到 composer）
- `src/lib/agents/prompt-executor.ts:511`（M5）
- `src/lib/agents/group-runtime.ts:1174/1663/2108/2275/~2310`（M6-a/b）
- `src/lib/agents/dispatch-service.ts:215-216`（补 `resolvedWorkflowRef` 派生）
- `src/lib/agents/department-execution-resolver.ts:405 applyProviderExecutionContext`（改 composer thin wrapper）

**配套修改**
- `src/lib/agents/run-artifacts.ts:122-210 ignoredPromptRootFiles`（加 `prompt.composed.{json,md}` 黑名单）
- `src/lib/agents/run-history.ts`（新增 `prompt.composed` 事件类型）
- `src/lib/story-top-candidates.ts StoryTopCandidatePayload`（作为 `affectedAreas` zod schema 派生源）

### 3.2 不破坏的边界（明示）

- ✅ **GUI 调度面板**（`scheduler-panel.tsx` / `/api/scheduler/jobs*`）完全不动 —— 修正报告已确认 GUI 是更好的配置层。
- ✅ **调度系统**（`scheduler.ts` / `scheduled_jobs` SQLite 表 / Company Loop policy）完全不动 —— 与 prompt 装配是独立维度。
- ✅ **canonical-assets API 行为不动** —— `/api/workflows/[name]/route.ts:53` 编辑链路继续返回完整 markdown（含 frontmatter），由 AssetRegistry 在上层切 raw/body/meta。
- ✅ **Antigravity gRPC 协议契约不动** —— 仅改 prompt 字符串内容，不改 backend 接口。
- ✅ **Backend memory hook 边界不动** —— Claude Engine memory / CEO prompts / supervisor 不在本期范围。
- ✅ **artifact deliverables / run capsule / 三套 UI 面板**不受 `prompt.composed.{json,md}` 污染（`ignoredPromptRootFiles` 黑名单守门）。
- ❌ **与本期有冲突的旧行为**：
  - 5 个 builder 内联的 `AssetLoader.resolveWorkflowContent` 调用会被删（替换为 composer + AssetRegistry）。
  - retry / role-switch 路径的 workflow 来源会改（从 inline 改为 composer 内 RetryProvider / StageContextProvider 注入）。
  - `applyProviderExecutionContext` 从 prepend 改为 funnel（语义保留：旧调用方继续工作，但内部走 composer.pushCapabilityPack）。

### 3.3 风险与守门

| 风险 | 触发场景 | 守门策略 |
|------|---------|---------|
| M0 skip flag 误开 → prompt 内容意外变化 | 灰度阶段 flag 被开到 group-runtime 流量 | flag 默认 off；M0-a snapshot 守护；明示 M0 仅 PromptExecutor 单 workflow prompt-mode 止血 |
| M6 group-runtime 切换缺 stage 数据 | 4 个 stage-specific provider 未覆盖某个 builder 输出段 | 切换前 gate：`buildRolePrompt` / `buildDeliveryPrompt` / `buildRoleSwitchPrompt` / `buildRetryPrompt` 的 snapshot diff = 0 | 
| runtime hook 在 group-runtime 重复 spawn | template mode 启用 runtime hook 但未做幂等 | `WorkflowRuntimeProvider.shouldRun` 默认 false；`PROMPT_COMPOSER_RUNTIME_HOOKS_IN_TEMPLATE_MODE` 独立 flag；composer per-run runtime-cache 保证 review-loop 整轮幂等 |
| `prompt.composed.{json,md}` 污染 deliverables | 直接写 `artifactAbsDir` 根目录 → `syncRunArtifactsToDeliverables` 吸入 | `ignoredPromptRootFiles` 黑名单加 `prompt.composed.{json,md}`；summary 走 `appendRunHistoryEntry` 事件 |
| canonical-assets 编辑链路破坏 | `canonical-assets.ts:161` 改为返回 body 而非 raw | **不动 canonical-assets**，AssetRegistry 在上层切；`/api/workflows/[name]/route.ts:53` 继续读 raw |
| retry / role-switch / legacy-single skip 失效 | M0-b skip flag 假定所有路径都经 `applyProviderExecutionContext` + `resolvedWorkflowRef` | M0 明示不处理这 3 路径；M6-b 单独改 group-runtime 自身 |
| 副作用 fence 失守 | template mode 触发 child_process spawn / fetch / knowledge access | M6 验收 gate：template mode 无 `runtimeProfile` 时 0 次 spawn / 0 次 fetch / 0 次 `recordKnowledgeAssetAccess` |

### 3.4 落地路径

| M | 工作量 | 风险 | 验收标准 |
|---|--------|------|---------|
| **M0-a** snapshot 锁定 | 0.5 PR / 半天 | 零 | 6 个 builder + PromptExecutor 入口 golden fixture 通过；M1-M6 期间 diff 守护 |
| **M0-b** skip flag 灰度（PromptExecutor only） | 0.5 PR / 半天 | 低（flag off 默认；skip 一开 prompt 字符串变化） | flag 开启后 PromptExecutor 路径单 workflow prompt-mode 内 workflow MD 出现次数 2 → 1；snapshot diff 符合预期变化；group-runtime 路径行为不变 |
| **M1** 类型骨架 | 1 PR / 1 天 | 零（纯类型） | `tsc --noEmit` 通过；zod 派生类型在 1 调用点试用 |
| **M2** AssetRegistry | 2 PR / 3 天 | 中（frontmatter 剥离回归） | 同 ref 一 run 内读盘 1 次；frontmatter 不出现在 `body`；`canonical-assets.ts:161` 返回 raw 不变 |
| **M3-a** 8 通用 provider | 3 PR / 5 天 | 中（provider 行为漂移） | 每个 provider 对照原行为 snapshot diff = 0；`WorkflowRuntimeProvider` / `KnowledgeRetrievalProvider` 默认 shouldRun = false |
| **M3-b** 4 stage-specific provider | 2 PR / 3 天 | 中 | 4 provider 覆盖 4 个 builder 输出段；snapshot diff = 0 |
| **M4** Composer + Ledger + runtime-cache | 1.5 PR / 3 天 | 中（dedupe 误删） | contentHash + canonicalRef 双键；dedupe snapshot 通过；review-loop fetch_context.py spawn = 1 |
| **M5** PromptExecutor 切换 | 1 PR / 2 天 | 中（端到端回归） | 黄金 prompt fixture diff = 预期变化；workflow MD = 1；token 节省 ~50% |
| **M6-a** group-runtime 5 入口切换 | 3 PR / 5 天 | 高（review-loop 多 role 多 round） | 切换前 4 stage provider snapshot diff = 0；6 入口 prompt 都含 `prompt.composed.json`；review-loop 整轮跑通；workflow = 1 |
| **M6-b** retry / role-switch / legacy-single | 2 PR / 3 天 | 高（3 条独立路径） | retry 走 composer + RetryProvider；role-switch 不再直发 session.send；legacy-single 走 composer.compose；3 路径 workflow 不漏注入 |

**Feature-flag matrix**（M5/M6 联合灰度维度）：
`PROMPT_COMPOSER_V2` × `PROMPT_COMPOSER_SKIP_INLINE` × `resolvedWorkflowRef`(有/无) × `PROMPT_COMPOSER_RUNTIME_HOOKS_IN_TEMPLATE_MODE` × `KNOWLEDGE_IN_TEMPLATE_MODE` = 灰度组合矩阵，先单部门单任务类型，runtime ledger 异常一键 fallback。

**M6 副作用 fence 验收**（强制）：
- template mode 无 `runtimeProfile` 时：0 次 child_process spawn / 0 次外部 fetch / 0 次 `recordKnowledgeAssetAccess`
- review-loop 整轮：`fetch_context.py` 仅 spawn 1 次、knowledge access 仅 record 1 次

---

> **本文档已被 v4 最小修复版取代**：[v4](./prompt-composer-target-architecture-v4-2026-05-11.md)
> v3 的大型重构方向（PromptComposer + Ledger + AssetRegistry + 12 provider）经评估存在过度设计——同样的问题用 ~220 行代码可端到端解决。v3 保留作为方案演进考古档案。

