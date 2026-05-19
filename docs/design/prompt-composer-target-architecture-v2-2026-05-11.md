# PromptComposer 改造方案 v2（聚焦版）

> **日期**: 2026-05-11
> **状态**: 替代 v1（`prompt-composer-target-architecture-2026-05-11.md`）
> **关联**:
> - 考古: `docs/research/prompt-composition-systemic-analysis-2026-05-11.md`
> - 修正: `docs/research/scheduler-and-prompt-actual-state-correction-2026-05-11.md`

---

## 0. 范围声明

**本文档只处理 prompt 拼装层的重构**。

- ✅ **做**：PromptComposer service / ContextProvider 注册表 / AssetRegistry / PromptLedger / Observability。
- ❌ **不做**（另文）：调度系统（GUI 已可配置，见修正报告）/ Token Budget 与 priority 裁剪（非当前痛点）/ **本期不做装配策略配置层**（provider 启停 / 优先级 / 部门级 override —— GUI 已覆盖当前的调度配置场景；装配策略层未来视产品形态再决定 YAML/JSON/GUI 形态，不在本期撤回范围内）/ 跨子系统统一（Claude Engine memory、CEO prompts、supervisor，超范围）/ 客户/部门声明式禁用 provider（商业化诉求，超范围）。

对齐用户的两个原始目标：(G1) prompt 拼装**可见 + 可修改**；(G2) 修掉**双重注入 / schema 漂移 / frontmatter 噪声**等错误设计。

---

## 1. 当前 prompt 拼装的真实问题清单

| # | 现象 | 位置 | 代价 |
|---|------|------|------|
| P1 | 同一份 workflow MD 在单条 prompt 出现 2 次（capability-pack + buildRolePrompt/buildDeliveryPrompt 中段） | `department-execution-resolver.ts:295 formatWorkflowSection` + `prompt-builder.ts:88 buildRolePrompt` 内 `AssetLoader.resolveWorkflowContent` | Prompt mode 实测 ~2500 token 中 ~1300 token 是重复内容；模型注意力分裂 |
| P2 | PromptExecutor 路径：**workflow MD 全文重复 2 次（capability-pack + Playbook context）+ runtime appendix 独立注入 1 段**（schema/artifact 路径/动态上下文，新内容、不属重复） | `prompt-executor.ts:511` 把三段 `.join('\n\n')`；runtime appendix 见 `workflow-runtime-hooks.ts:906` | Daily-digest 类任务每次 ~1300 重复 token（来自 workflow MD 的两份副本，runtime appendix 不计入重复） |
| P3 | Schema 三处独立维护 → 漂移风险 | (a) Workflow MD 头部 frontmatter；(b) `workflow-runtime-hooks.ts` 的 `runtimeProfile` 字符串 switch；(c) `canonical-assets.ts:173 getCanonicalWorkflowRuntimeConfig` 的 `extractRuntimeConfig` | 改 frontmatter 字段名要同步 3 处，漏一处就静默失效 |
| P4 | `affectedAreas` 字段用 TS 联合语法 `'a' \| 'b' \| 'c'` 出现在 prompt 字符串里冒充 JSON schema | **`workflow-runtime-hooks.ts:383`**（runtime hook 生成 prompt 字符串时手写的 inline JSON schema）—— **不是 workflow frontmatter**（`platform_engineering_story_candidates.md` frontmatter 只有 description / trigger / runtimeProfile） | 模型常把 `\|` 误解为 markdown 表格分隔符；属于 **WorkflowRuntimeProvider 输出契约**问题，非 frontmatter schema 漂移 |
| P5 | Frontmatter 原文（runtime / schedule / scripts 段）随 `workflow.content` 整体注入 prompt | `canonical-assets.ts:161` 直接 `fs.readFileSync(...)` 不剥 frontmatter；`formatWorkflowSection` 又把 `workflow.content` 整段 push | 每次浪费 ~200-400 token 在 LLM 不需要的运维元数据上 |
| P6 | 4 套加载器各读各的盘，互不感知 | `asset-loader.ts:216 resolveWorkflowContent` / `canonical-assets.ts:154 getCanonicalWorkflow` / `canonical-assets.ts:173 getCanonicalWorkflowRuntimeConfig` / `department-execution-resolver.ts:117 loadPublishedGrowthAssets` | 同一份 workflow 一次 run 内被读 2-4 次盘；无统一缓存 |
| P7 | 5 个 builder 互不感知，各自往 prompt 里塞东西 | `prompt-builder.ts:43/88/183` + `prompt-builder.ts buildRetryPrompt` + `prompt-executor.ts:181 buildPromptExecutionPrompt` | 新增上下文要改 5 处，半数会漏（knowledge 只接了 PromptExecutor、runtime appendix 只接了 PromptExecutor） |
| P8 | 没有任何"prompt 由什么组成"的可见性 | 整个仓库找不到 `composedSections` / `promptLedger` 概念；只能在 run history 看最终字符串 | 复盘只能 diff 全文，无法定位"哪段 provider 注入了什么、为什么超长" |

---

## 2. 改造点 × 收益清单（核心）

| # | 改造点 | 文件:行 | 改成什么 | 解决问题 | 命中目标 | 工作量 |
|---|--------|---------|---------|---------|---------|--------|
| C1 | 引入 `PromptSection / PromptLedgerEntry / ContextProvider / AssetRef` 类型骨架 | 新文件 `src/lib/agents/prompt-composer/types.ts` | TS 接口集合 + zod schema 派生 | P3 schema 漂移 | G2 | 1 PR / 200 行 |
| C2 | 新建 `AssetRegistry` 统一资产层 | 新文件 `src/lib/agents/prompt-composer/asset-registry.ts`，收编 `asset-loader.ts:216` / `canonical-assets.ts:154,173,232` / `department-execution-resolver.ts:117` | 单一 `registry.resolve(ref)` 出口，内部按 contentHash + canonicalRef 缓存 | P6 四套加载器 | G1 | 2 PR / 500 行 |
| C3 | `AssetRegistry.resolve` 在上层做 `raw / body / meta` 三段分离；**canonical-assets.ts 保持原行为（继续返回 raw）** | 新增 `stripFrontmatter()` 在 registry 内；`canonical-assets.ts:161` **不动**（`/api/workflows/[name]` 编辑链路依赖完整 markdown，见 `src/app/api/workflows/[name]/route.ts:53`） | prompt 注入只用 `body`；canonical API 与 workflow 保存继续读 `raw` | P5 frontmatter 噪声 | G2 | 同 C2 |
| C4 | `runtimeProfile` schema 用 zod 派生（P3）；`affectedAreas` 等 runtime payload 类型从 `src/lib/story-top-candidates.ts` 的 `StoryTopCandidatePayload` 派生（P4）—— **WorkflowRuntimeProvider 输出契约**改造 | 新建 `src/lib/agents/prompt-composer/asset-schema.ts`；删 `workflow-runtime-hooks.ts:383` 内手写的 inline JSON schema 字符串；删 `workflow-runtime-hooks.ts` 的 `runtimeProfile` 字符串 switch | `runtimeProfile = z.enum([...])`；runtime hook 不再 inline schema，改为引用 `StoryTopCandidatePayload` TS 类型派生 | P3 + P4 | G2 | 1 PR / 150 行 |
| C5 | 新建 `PromptComposer` service，提供唯一出口 `composer.compose(scope)` | 新文件 `src/lib/agents/prompt-composer/composer.ts` | 接口见 §3.1；内部维护 ordered sections + ledger | P7 五 builder 各拼各的 | G1 | 1 PR / 300 行 |
| C6 | `PromptLedger` 双键去重（contentHash + canonicalRef） | 同 C5 文件内 | `push(section)` 命中 dedupe → 第二次只追加 `[See: <ref> above]` 引用指针 | P1 / P2 双重 & 三重注入 | G2 | 同 C5 |
| C7 | 8 类现有上下文改造为 8 个 `ContextProvider` | 新目录 `src/lib/agents/prompt-composer/providers/*` | `DepartmentIdentity / LocalRules / Workflow / WorkflowRuntime / Skill / GrowthAssets / KnowledgeRetrieval / TaskGoal` | P7 + P1 + P2 | G1 | 3 PR / 800 行 |
| C8 | `PromptExecutor` 切到 composer 出口 | `prompt-executor.ts:511` 把三段 `.join('\n\n')` + `applyProviderExecutionContext(...)` 替换为 `composer.compose({mode:'prompt', ...}).text` | 单入口、自动去重 | P1 / P2 | G1 + G2 | 1 PR / 200 行 |
| C9 | `group-runtime` 5 处入口切到 composer | `group-runtime.ts:1174` (legacy-single) / `:1663` (restart-role) / `:2108` (delivery-single-pass) / `:2275` (review-loop) / role-switch（~2310） | 全部改为 `composer.compose({mode:'template', target, role, stage}).text`；删除内部 `AssetLoader.resolveWorkflowContent` 调用 | P1 / P7 | G1 + G2 | 3 PR / 600 行 |
| C10 | `applyProviderExecutionContext` 改为 composer 的 deprecated wrapper | `department-execution-resolver.ts:405` 内部调用 `composer.pushCapabilityPack(view)` 而非 `prependContext` | 消除"prepend 而非 funnel"的根因 | P1 + P7 | G1 | 1 PR / 150 行 |
| C11 | 每个 run 产 `prompt.composed.json` + `prompt.composed.md` | 在 `composer.compose()` 末尾写盘到 `artifactAbsDir`，通过现有 `appendRunHistoryEntry` 发 `prompt.composed` 事件 | 可见性 | P8 | G1 | 1 PR / 150 行 |
| C12 | Snapshot test 锁定"workflow 内容仅出现一次"等不变量 | 新建 `prompt-composer/__tests__/dedup.test.ts` | 输入固定 scope，对 `composed.text` 跑 `expect(occurrences(workflowMarker)).toBe(1)` | 防回归 | G2 | 0.5 PR / 100 行 |

总计：约 8-10 PR，~3200 行（含测试）。改造分布在新目录 `src/lib/agents/prompt-composer/*`，旧文件以最小切口接入。

---

## 3. 核心机制

### 3.1 PromptComposer service（单一拼装出口）

5 个 builder（`buildRolePrompt` / `buildDeliveryPrompt` / `buildRoleSwitchPrompt` / `buildRetryPrompt` / `buildPromptExecutionPrompt`）全部收敛为 `composer.compose(scope)` 的内部 stage。

```ts
// src/lib/agents/prompt-composer/composer.ts
export interface CompositionScope {
  mode: 'prompt' | 'template';
  target: ExecutionTarget;
  role?: RoleSpec;
  stage?: StageContext;
  goal: string;
  artifactAbsDir: string;
}

export interface ComposedPrompt {
  text: string;                  // 最终送 backend 的字符串
  sections: PromptSection[];     // 成分清单
  ledger: PromptLedgerEntry[];   // 注入 / 去重 / 跳过 全过程
  tokenEstimate: number;
}

export class PromptComposer {
  constructor(private registry: AssetRegistry, private providers: ContextProvider[]) {}
  async compose(scope: CompositionScope): Promise<ComposedPrompt>;
}
```

### 3.2 ContextProvider 注册表（可增删的段）

每类上下文一个 provider，无状态、可单测。新增上下文 = 注册一个 provider，不再改 5 个 builder。

```ts
// src/lib/agents/prompt-composer/types.ts
export interface ContextProvider {
  readonly name: string;
  readonly kind: SectionKind;
  shouldRun(scope: CompositionScope): boolean;
  contribute(ctx: ProviderRunCtx): Promise<PromptSection[]>;
}
```

**8 个通用 provider**（一一对应 PromptExecutor 路径的实际入口）：
`DepartmentIdentityProvider` / `LocalRulesProvider` / `WorkflowProvider` / `WorkflowRuntimeProvider`（替代 `prepareWorkflowRuntimeContext`）/ `SkillProvider` / `GrowthAssetsProvider` / `KnowledgeRetrievalProvider`（替代 `retrieveKnowledgeAssets`）/ `TaskGoalProvider`。

**4 个 stage-specific provider**（覆盖 group-runtime 的 `buildRolePrompt` / `buildDeliveryPrompt` / `buildRoleSwitchPrompt` / `buildRetryPrompt` 的额外输出段，见 `prompt-builder.ts:105`、`group-runtime.ts:1921`）：
- `StageContextProvider` —— task envelope + work package + execution contract
- `ArtifactContextProvider` —— input artifacts + upstream artifacts
- `AssignmentProvider` —— review assignment + delivery assignment
- `RetryProvider` —— retry context + failure history

实现策略二选一：**(A)** 注册为 12 个 provider，stage-specific 通过 `shouldRun(scope)` 判定 stage 类型；**(B)** group-runtime 入口在调 composer 前，由 stage adapter 把 stage 状态（task envelope / artifacts / assignment / retry）映射成上述 4 个 provider 的输入。本期倾向 (A)，保留 (B) 作为大型 stage 出现时的演进口。

注意：`WorkflowRuntimeProvider` 与 `KnowledgeRetrievalProvider` 现在只接 PromptExecutor 路径 —— 改造后由 composer 统一仲裁，**group-runtime 路径也能透明接入**，消除"prompt mode 和 template mode 结构性不同"的副作用。

### 3.3 PromptLedger 双键去重

```ts
// src/lib/agents/prompt-composer/composer.ts (节选)
push(section: PromptSection): void {
  const seenByHash = this.byContentHash.get(section.contentHash);
  const seenByRef  = section.canonicalRef && this.byRef.get(section.canonicalRef);
  const dup = seenByHash ?? seenByRef;
  if (dup) {
    this.ledger.push({ event: 'section.deduped', sectionId: section.id, source: section.source,
      details: { dedupedFrom: dup.id, ref: section.canonicalRef } });
    this.sections.push({ ...section, content: `[See: ${section.canonicalRef ?? dup.kind} above]`, dedupedFrom: dup.id });
    return;
  }
  this.byContentHash.set(section.contentHash, section);
  if (section.canonicalRef) this.byRef.set(section.canonicalRef, section);
  this.sections.push(section);
  this.ledger.push({ event: 'section.pushed', sectionId: section.id, source: section.source });
}
```

contentHash 防"内容相同但 ref 不同"（例如 canonical 与 growth 各贡献同一 workflow）；canonicalRef 防"ref 相同但内容微差"（例如 frontmatter 差异）。两者并用 = 任何重复都会命中。

### 3.4 AssetRegistry（替代 4 套加载器，含 schema-from-TS）

```ts
// src/lib/agents/prompt-composer/asset-registry.ts
const WorkflowFrontmatterSchema = z.object({
  runtimeProfile: z.enum(['daily-digest','daily-events','story-top-candidates']).optional(),
  affectedAreas: z.array(z.string()).optional(),   // 不再用 'a'|'b' 字符串
  schedule: z.string().optional(),
});
export type WorkflowFrontmatter = z.infer<typeof WorkflowFrontmatterSchema>;

interface AssetEntry {
  ref: AssetRef;
  raw: string;                          // 完整文件内容（含 frontmatter），用于 canonical API 与 workflow 保存链路
  body: string;                         // 剥离 frontmatter 后的正文，prompt 注入只用这段
  meta: WorkflowFrontmatter;            // 解析后的 frontmatter，用于运行时决策（runtimeProfile 等）
  contentHash: string;
}

export class AssetRegistry {
  resolve(ref: AssetRef): AssetEntry {
    const cached = this.cache.get(ref.key);
    if (cached) return cached;
    const raw = readFromDisk(ref);                          // 收编下层加载器
    const { meta, body } = stripFrontmatter(raw);           // 在 registry 上层切分，不动 canonical-assets
    const parsed = WorkflowFrontmatterSchema.parse(meta);   // P3+P4：schema 单一真理源
    const entry = { ref, raw, body, meta: parsed, contentHash: sha256(body) };
    this.cache.set(ref.key, entry);
    return entry;
  }
}
```

**关键约束**：`canonical-assets.ts:161` 与下层 fs 调用保持原行为（返回完整 markdown）—— `/api/workflows/[name]` 编辑保存链路（`src/app/api/workflows/[name]/route.ts:53`）依赖 `workflow.content` 是完整 markdown 含 frontmatter，不能破坏。Prompt 注入路径只读 `entry.body`；canonical API 与 workflow 编辑器读 `entry.raw`；`WorkflowRuntimeProvider` 读 `entry.meta.runtimeProfile`。

zod schema 是 frontmatter / `WorkflowFrontmatter` TS 类型 / `WorkflowRuntimeProvider` 派发依据的**唯一真理源**。原 `workflow-runtime-hooks.ts` 内的 `runtimeProfile` 字符串 switch（P3）改为 `entry.meta.runtimeProfile` 的 enum 派发。

---

## 4. Observability（可见性的具体落点）

每个 run 在 `artifactAbsDir` 自动产两份产物，并通过现有 `appendRunHistoryEntry` 发 `prompt.composed` 事件。

`prompt.composed.json` 结构示例：

```json
{
  "runId": "run_abc123",
  "mode": "prompt",
  "tokenEstimate": 1240,
  "sections": [
    { "id": "s1", "kind": "identity",  "source": "DepartmentIdentityProvider", "tokens": 86,  "canonicalRef": "department:platform-engineering" },
    { "id": "s2", "kind": "local-rule","source": "LocalRulesProvider",        "tokens": 142 },
    { "id": "s3", "kind": "workflow",  "source": "WorkflowProvider",          "tokens": 612, "canonicalRef": "workflow:/platform_engineering_story_candidates" },
    { "id": "s4", "kind": "workflow",  "source": "GrowthAssetsProvider",      "tokens": 12,  "canonicalRef": "workflow:/platform_engineering_story_candidates", "dedupedFrom": "s3" },
    { "id": "s5", "kind": "knowledge", "source": "KnowledgeRetrievalProvider","tokens": 188 },
    { "id": "s6", "kind": "goal",      "source": "TaskGoalProvider",          "tokens": 200 }
  ],
  "ledger": [
    { "event": "section.pushed",  "sectionId": "s3", "source": "WorkflowProvider" },
    { "event": "section.deduped", "sectionId": "s4", "source": "GrowthAssetsProvider", "details": { "dedupedFrom": "s3" } }
  ]
}
```

`prompt.composed.md` 是同样信息的人类可读版本：每段标注 `<!-- source=WorkflowProvider ref=workflow:/xxx tokens=612 -->` 后紧跟 markdown 原文，去重段直接显示 `[See: workflow:/xxx above]`。运营/复盘可直接打开看，无须 jq。

写入位置：`<artifactAbsDir>/prompt.composed.{json,md}`。事件：复用 `appendRunHistoryEntry` 现有机制（`run-history.ts`），新增事件类型 `prompt.composed`，payload 仅放 sections 摘要避免重复落盘。

---

## 5. 落地路径

按依赖顺序的 **7 个 milestone（M0-M6）**，每个都可独立 review、独立合入、零下游影响：

| M | 内容 | 改什么文件 | 关键风险 | 验收标准 |
|---|------|-----------|---------|---------|
| **M0** | **现状回归测试 + 止血**（紧急 / 零业务风险 / 半天） | 给 `PromptExecutor` 和 group-runtime 的 4 个入口分别加 snapshot 回归测试，固化当前拼装行为；给 `buildRolePrompt` / `buildDeliveryPrompt` / `buildRoleSwitchPrompt` / `buildPromptExecutionPrompt` 加可选参数 `skipWorkflowInline`；当 `executionContext.resolvedWorkflowRef` 非空 → `skipWorkflowInline=true`，跳过 inline 注入 | 零（snapshot 守护原行为） | snapshot 覆盖 4 个入口；`skipWorkflowInline` 开启后单条 prompt 中 workflow MD 出现次数从 2 降到 1（消除当前可观测痛点）；后续 M1-M6 重构期间 snapshot 持续守护 |
| **M1** | 类型骨架（C1+C4 一半） | 新增 `prompt-composer/types.ts` + `asset-schema.ts` | 零（纯类型）；**M0 snapshot 保护下，类型骨架引入零风险** | `tsc --noEmit` 通过；zod 派生类型在 1 个调用点试用 |
| **M2** | AssetRegistry 收编 4 套加载器（C2+C3） | 新增 `asset-registry.ts`；`asset-loader.ts:216` / `canonical-assets.ts:154,173` 改为 thin wrapper 委托给 registry | frontmatter 剥离后 downstream 误读 → 单测覆盖每一份现存 workflow MD | 同一 ref 多次调用只读 1 次盘；frontmatter 不出现在 `asset.body` |
| **M3** | 8 类上下文改造为 Provider（C7） | 新增 `providers/*.ts`；保留旧 builder 暂未删 | provider 行为漂移 → 每个 provider 对照原行为写 snapshot test | 8 个 provider 单独跑通；输出 PromptSection 与旧路径文字 diff = 0 |
| **M4** | PromptComposer + Ledger（C5+C6） | 新增 `composer.ts`；feature flag `PROMPT_COMPOSER_V2=off` 默认关 | dedupe 逻辑误删非重复段 → 引入 contentHash + canonicalRef 双键 | flag 开启时 `composer.compose(scope)` 输出含完整 sections + ledger；dedupe snapshot test 通过 |
| **M5** | PromptExecutor 切到 composer（C8） | `prompt-executor.ts:511` 单点替换 | prompt 内容回归 → 黄金 prompt fixture diff | flag 开启后 prompt mode 端到端跑通；workflow MD 出现次数 = 1 |
| **M6** | group-runtime 5 处入口切到 composer（C9+C10+C11+C12） | `group-runtime.ts:1174 / 1663 / 2108 / 2275 / role-switch`；`department-execution-resolver.ts:405` | review-loop 多 role 多 round 场景的回归面最大 → 灰度部门粒度开 flag | **切换前必须先验证**：4 个 stage-specific provider 覆盖 `buildRolePrompt` / `buildDeliveryPrompt` / `buildRoleSwitchPrompt` / `buildRetryPrompt` 的**所有输出段**（snapshot diff = 0）；之后再切。验收：6 个入口的 prompt 都含 `prompt.composed.json`；review-loop 整轮跑通；workflow 仅出现 1 次 |

灰度策略：M5/M6 都通过 feature flag 开启，先单部门、单任务类型，runtime ledger 异常时一键 fallback。

---

## 6. 不在范围（明确撤回 v1 内容）

| v1 章节 | 撤回理由 |
|---------|---------|
| §7 Token Budget Policy | 当前不是痛点；GUI 已能看到运行历史与 token 用量；裁剪策略一旦做错会丢关键上下文，**先做可见性、再谈裁剪** |
| §8 ConfigurationLayer (YAML) | **本期不做装配策略配置层**（非"永远不做 YAML"）。修正报告第 1 节已确认调度场景由 GUI 覆盖；prompt 装配策略层（provider 启停、provider 优先级、部门级 override）未来视产品形态再决定是否引入 YAML/JSON。本期 provider 注册表为这层留好接口（`shouldRun` 是动态判定），但不实现 |
| §11 M7/M7b/M8 跨子系统统一 | Claude Engine memory / CEO prompts / supervisor 各自有独立 owner 与节奏，强统一会阻断他们的迭代；本文 composer 只覆盖 agent runs |
| §14 跨子系统衔接 | 同上；统一时机晚于本文 6 个 milestone 全部稳定之后再议 |
| v1 提到的"客户/部门声明式 provider 开关" | 商业化诉求，超范围；本文 provider 注册表为未来此能力留好接口（`shouldRun` 已是动态判定），但本期不实现 |

---

## 7. 验收清单（用户视角）

- [ ] 单条 prompt 里同一份 workflow MD 出现且仅出现一次（snapshot test 锁定）
- [ ] Schema 只有一份真理来源：`asset-schema.ts` 的 zod 定义；frontmatter / runtime hook / TS 类型全部派生自它
- [ ] 每个 run 自动产 `<artifactAbsDir>/prompt.composed.json` 与 `prompt.composed.md`，可逐段看 source / kind / tokens / dedupedFrom
- [ ] 新增一类上下文段，只需注册一个 `ContextProvider`，不需改 5 个 builder
- [ ] Frontmatter（runtime / schedule / scripts）不再出现在送 LLM 的 prompt 文本里
- [ ] `affectedAreas` 等结构化字段统一为 `z.array(z.string())`，不再用 `'a' \| 'b' \| 'c'` 字符串
- [ ] group-runtime 路径与 PromptExecutor 路径具备**相同的上下文供给契约**（knowledge / workflow-runtime appendix 不再因入口不同而结构性缺失）

---

## 8. Story Top 3 任务在新架构下的 prompt 示例

任务：`Platform Engineering Story Top 3 Candidates`（runtimeProfile = `story-top-candidates`，每日 cron 触发，走 PromptExecutor 路径）。

**改造前**（实测约 ~2800 tokens）：

```
<department-capability-pack>
# Identity: Platform Engineering...                     ← capability-pack 段
## Department Workflows
### platform_engineering_story_candidates
---                                                     ← frontmatter 噪声开始
runtimeProfile: story-top-candidates
schedule: 0 9 * * *
---
（workflow 正文 ~600 tokens）                            ← 第 1 次出现
</department-capability-pack>

# Playbook context（buildPromptExecutionPrompt 注入）
（同一 workflow 正文 ~600 tokens，AssetLoader 再读一遍）  ← 第 2 次出现（重复）

# Prepared Story Top Candidates Context
（runtime hook 生成的 candidate 数据 + inline schema：
  affectedAreas: 'pipeline' | 'scheduler' | 'agents'   ← 假 JSON，位置：workflow-runtime-hooks.ts:383
 ~400 tokens，独立内容、非重复段）

# Knowledge
（RAG 召回 ~300 tokens）

# Primary Task
（用户 goal ~200 tokens）
```

**改造后**（预计 ~1400 tokens，节省 ~50%）：

```
<!-- source=DepartmentIdentityProvider tokens=86 -->
# Identity: Platform Engineering...

<!-- source=LocalRulesProvider tokens=142 -->
## Department Local Rules ...

<!-- source=WorkflowProvider (capability-pack 段) ref=workflow:/platform_engineering_story_candidates tokens=420 -->
### platform_engineering_story_candidates
（workflow 正文，已剥 frontmatter，~420 tokens）          ← 只出现 1 次

<!-- source=WorkflowProvider (Playbook context 段) ref=workflow:/platform_engineering_story_candidates DEDUPED -->
[See: workflow:/platform_engineering_story_candidates above]   ← 引用指针 ~12 tokens
（注：因 Story Top 3 走 explicit promptAssetRefs 路径，growth assets 在
 `department-execution-resolver.ts:521` 已被禁用；本示例的双重注入发生在
 capability-pack 的 `## Department Workflows` 与 buildPromptExecutionPrompt
 的 Playbook context 之间，与 GrowthAssetsProvider 无关。）

<!-- source=WorkflowRuntimeProvider tokens=400 -->
# Prepared Story Top Candidates Context ...

<!-- source=KnowledgeRetrievalProvider tokens=188 -->
# Knowledge ...

<!-- source=TaskGoalProvider tokens=200 -->
# Primary Task ...
```

节省构成：(a) workflow 第二份副本（Playbook context 段）由 ~600 token → ~12 token 引用指针（省 ~590）；(b) frontmatter 噪声剥离省 ~180；(c) `affectedAreas` 由 runtime hook 改用 TS 类型派生的结构化字段，模型无需"看懂" `|` 符号，间接减少澄清提问。

ledger 同时记录：
```
section.pushed  s3 WorkflowProvider (capability-pack)   (ref=workflow:/platform_engineering_story_candidates)
section.deduped s4 WorkflowProvider (Playbook context)  (dedupedFrom=s3)
```

复盘工具看到 `s4.dedupedFrom=s3` 即可一眼定位"谁尝试重复注入了什么"，这正是 G1（可见 + 可修改）的具体落地形态。

---

## 9. 评审修订记录（v2.1, 2026-05-11）

针对 v2 首轮评审反馈所做的精准修订（不重写、保留原节奏）：

| # | 评审反馈 | 修订位置 | 修订要点 |
|---|---------|---------|---------|
| P1-1 | canonical-assets 不应改成只返回 body（会破坏 `/api/workflows/[name]` 编辑链路） | §2 C3 行；§3.4 AssetRegistry 代码块与说明 | 改为 AssetRegistry 在上层做 `raw / body / meta` 三段切分；canonical-assets.ts:161 保持原行为返回 raw；标注关联保护点 `src/app/api/workflows/[name]/route.ts:53` |
| P1-2 | Story Top 3 示例里 GrowthAssetsProvider 去重不成立（growth assets 在 `department-execution-resolver.ts:521` 已被禁用） | §8 改造后示例与 ledger | 双重注入示例改为 capability-pack 的 `## Department Workflows` 段 vs buildPromptExecutionPrompt 的 Playbook context 段；附说明 growth assets 禁用位置 |
| P2-3 | "同一 workflow 最多出现 3 次"表述偏重（runtime appendix 是新内容，非重复） | §1 P2 行；§8 示例 | 表述改为"workflow MD 全文重复 2 次 + runtime appendix 独立 1 段"；强调 runtime appendix 不计入重复 |
| P2-4 | `affectedAreas` 定位错（不在 frontmatter，在 `workflow-runtime-hooks.ts:383` 的 inline schema） | §1 P4 行；§2 C4 行；§8 示例 | 纠正位置到 `workflow-runtime-hooks.ts:383`；归类改为"WorkflowRuntimeProvider 输出契约清理"；修复方向改为从 `src/lib/story-top-candidates.ts` 的 `StoryTopCandidatePayload` TS 类型派生 |
| P2-5 | 8 个 provider 不足覆盖 group-runtime（task envelope / artifacts / assignment / retry context 缺失） | §3.2 ContextProvider 注册表；§5 M6 行 | 补 4 个 stage-specific provider：`StageContextProvider` / `ArtifactContextProvider` / `AssignmentProvider` / `RetryProvider`；M6 加切换前覆盖度验证 gate |
| 范围-YAML | YAML 撤回过头（修正报告只撤回了调度 YAML，装配策略 YAML 未来仍可能保留） | §0 范围声明；§6 撤回表 | 表述改为"本期不做装配策略配置层"（非"永远不做 YAML"） |
| 落地-M0 | 缺止血层，重构期间无回归保护 | §5 milestone 表 | 新增 M0（snapshot 回归测试 + `skipWorkflowInline` 参数），milestone 总数 6 → 7；M1 描述补充"在 M0 snapshot 保护下零风险" |

**关键事实收口**（修订后文档中的正确表述）：
- workflow MD 全文重复 = **2 次**（capability-pack + Playbook context）
- runtime appendix = **独立 1 段**新内容（schema / artifact 路径 / 动态上下文），不计入"workflow 重复"
- `affectedAreas` 问题位置 = `workflow-runtime-hooks.ts:383`，非 frontmatter
- canonical-assets 改造 = **不动**，由 AssetRegistry 上层切 `raw / body / meta`
- Story Top 3 示例的 growth assets = 因 explicit refs 已被禁用，不参与双重注入示例
- provider 总数 = 8 个通用 + 4 个 stage-specific
- YAML 范围 = "本期不做装配策略配置层"
- milestone = M0-M6 共 7 个，M0 为止血层

---

> **本文档已被 [v3 最终版](./prompt-composer-target-architecture-v3-2026-05-11.md) 取代**

