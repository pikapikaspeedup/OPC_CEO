# PromptComposer 目标架构设计（长期 P2 终态）

> **日期**: 2026-05-11
> **作者**: 资深系统架构师（Claude，架构组）
> **状态**: 设计提案 — 待 staffing review
> **关联文档**:
> - 前置考古: [`docs/research/prompt-composition-systemic-analysis-2026-05-11.md`](../research/prompt-composition-systemic-analysis-2026-05-11.md)
> - 同期 RFC: [`docs/design/observability-and-resilience-rfc-2026-05-10.md`](./observability-and-resilience-rfc-2026-05-10.md)
> - 历史格式参照: [`docs/design/conversation-message-flow-2026-04-10.md`](./conversation-message-flow-2026-04-10.md)
> - 协议契约: `ARCHITECTURE.md` L2 Backend 层
>
> **本文位置**: 长期 P2 终态（不是短期止血，不是中期收敛）。短期 P0 / 中期 P1 在考古报告第七节已有结论，本文跳过。
>
> **预期受众**: 工程负责人（用于拉 staffing）、Tech Lead（用于拆 milestone）、产品 / 运营负责人（看第 1、8、15 节）。

---

## 0. 摘要（TL;DR）

把当前 5 个 builder × 8 个入口 × 4 套加载器的笛卡尔积，收敛为：

> **一个 PromptComposer service + 一套 ContextProvider plugin 注册表 + 一个 AssetRegistry + 一份 PromptLedger**。

所有发往 LLM backend 的 `prompt` / `system` 字符串字段，统一从 `composer.compose(scope)` 出口产生；composer 内部由 N 个 provider 按 priority 推送 `PromptSection`，由 ledger 双键去重（contentHash + canonicalRef），由 budget policy 按优先级裁剪，最终输出 `ComposedPrompt`（字符串 + 成分清单 + token 估算）。

终态收益：

1. **可观测**：每个 run 输出 `prompt.composed.json`，可逐段归因 token 消耗、注入来源、去重命中、裁剪决策。
2. **可配置**：cron 时间 / prompt 文案 / playbook 引用 / token budget / provider 开关，全部从 TS 代码迁到 YAML（运营不发版可改）。
3. **可去重**：同一份 workflow MD 在单条 prompt 里最多出现一次；重复命中输出指针 `[See: workflow:/xxx above]`。
4. **可裁剪**：按 priority 分级，token 预算超限时自动从低优先级开始丢，并在 ledger 留痕。
5. **可测试**：composer 是 pure（输入 scope → 输出 ComposedPrompt），可 snapshot test；provider 各自独立 unit test。
6. **可计量**：每段 token 单独估算，cost 归因到 provider 粒度。
7. **可裁剪 provider**：客户/部门可声明式禁用某个 provider（例如关闭 knowledge retrieval）。

预计 token 节省：当前 prompt mode 约 ~2500 tokens（含重复），目标态 ~1200 tokens（去重 + 引用指针），节省 ~50%。

---

## 1. 设计目标（业务驱动）

每条目标都绑定一个真实业务问题，不是技术 wishlist。

| # | 目标 | 业务问题 | 验证标准 |
|---|------|---------|---------|
| G1 | **单一入口** | 当前加一个上下文（RAG cache / knowledge）需要在 8 个入口都接线，半数会漏 | 新功能只需注册一个 `ContextProvider`，所有入口自动生效 |
| G2 | **运营可配置** | cron 改时间要发版；调 prompt 文案要发版；调 playbook 路径要发版 | `.agents/scheduled-jobs.yaml` / `.department/prompt-composition.yaml` 改完热重载生效 |
| G3 | **客户可配置** | 不同客户 / 部门希望开关不同的 provider（例如 SOC2 客户禁用 growth assets，金融客户禁用 RAG knowledge） | YAML 声明 `providers.knowledge.enabled: false`，无须 fork 代码 |
| G4 | **prompt 内容可观测** | 现在拼装出的 prompt 是黑盒，复盘只能看最终字符串 | 每个 run 自动产 `prompt.composed.json`，含 sections / tokens / dedupeHits / trim decisions |
| G5 | **token 预算可计量可裁剪** | 当前没有 budget 概念，长上下文容易爆模型 context window；爆了之后没有自动降级路径 | composer 内置 budget policy，超限按 priority 自动裁剪并 emit 事件 |
| G6 | **去重确定性** | 同一份 workflow 在单条 prompt 里出现 2-3 次，token 浪费 + LLM 混淆 | 双键去重（contentHash + canonicalRef），命中后输出引用指针；snapshot test 保护 |
| G7 | **跨子系统统一** | Claude Engine memory prompt / CEO prompts / supervisor summary 各自一套拼装，无法对齐 | 所有 LLM-bound 字符串通过同一个 composer，可统一 budget、统一 ledger、统一审计 |

---

## 2. 架构总览

### 2.1 PromptComposer 在系统里的位置

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ L1  调度层 (Trigger Layer)                                                   │
│  scheduler.ts / dispatch-service.ts / ceo-agent.ts / web API routes /       │
│  intervene routes / company-loop-executor.ts                                │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │  composer.compose(scope: CompositionScope)
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ L1.5  PromptComposer Service                  ◀── 本文核心 ──▶              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  ContextProvider Plugin Registry                                    │    │
│  │   ├ DepartmentIdentityProvider      ── priority=1000 (mandatory)    │    │
│  │   ├ RuntimeContractProvider         ── priority=950                 │    │
│  │   ├ LocalRulesProvider              ── priority=900                 │    │
│  │   ├ WorkflowProvider                ── priority=800                 │    │
│  │   ├ RuntimeHookProvider             ── priority=750                 │    │
│  │   ├ SkillProvider                   ── priority=600                 │    │
│  │   ├ GrowthAssetsProvider            ── priority=500                 │    │
│  │   ├ KnowledgeRetrievalProvider      ── priority=400                 │    │
│  │   ├ MemoryProvider (Claude Engine)  ── priority=350                 │    │
│  │   └ TaskGoalProvider                ── priority=100 (last)          │    │
│  │                                                                     │    │
│  │  ┌──── PromptLedger ────┐    ┌──── PromptBudgetPolicy ────┐         │    │
│  │  │  - sections[]        │ ↔  │  - totalBudget             │         │    │
│  │  │  - contentHash idx   │    │  - priority-based trim     │         │    │
│  │  │  - canonicalRef idx  │    │  - emit trim events        │         │    │
│  │  │  - dedupe hits[]     │    └────────────────────────────┘         │    │
│  │  └──────────────────────┘                                           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│           ▲                                            │                    │
│           │                                            ▼                    │
│  ┌────────┴────────┐                       ┌───────── ObservabilitySink ─┐  │
│  │ AssetRegistry   │                       │  prompt.composed.json       │  │
│  │ (统一资产层)     │                       │  prompt.composed.md         │  │
│  │ ├ content-addr  │                       │  appendRunHistoryEntry      │  │
│  │ └ ref-addr      │                       └─────────────────────────────┘  │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│  ┌────────▼────────────────────────────────────────────────────────────┐    │
│  │  ConfigurationLayer (YAML)                                          │    │
│  │   .department/prompt-composition.yaml                               │    │
│  │   .agents/scheduled-jobs.yaml                                       │    │
│  │   .agents/provider-policy.yaml                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │  ComposedPrompt { text, sections[], tokens }
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ L2  Backend 层 (AgentBackend.start)                                         │
│  backend.start(BackendRunConfig { prompt: composed.text, ... })             │
│  - applyBeforeRunMemoryHooks (仍然存在，但只做轻量 hook，不再做拼装)         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 组件全清单

| 组件 | 职责 | 替代当前 |
|------|------|---------|
| **PromptComposer Service** | 唯一的 prompt 拼装入口，提供 `compose(scope)` API | 当前 8 个入口的拼装逻辑 |
| **AssetRegistry** | 统一资产层（workflow / skill / canonical / growth），内容寻址 + ref 寻址双键 | `AssetLoader.resolveWorkflowContent` + `getCanonicalWorkflow` + `getCanonicalWorkflowRuntimeConfig` + `loadPublishedGrowthAssets` |
| **ContextProvider 接口** | 每类上下文一个 provider，声明式注册 | 当前内联 builder + capability-pack + runtime hook + knowledge 召回 |
| **PromptSection model** | 带 contentHash / priority / dedupeKey / source / kind 的内容单元 | 当前裸字符串拼接 |
| **PromptLedger** | 注入登记表 + 双键去重 | 当前 0 个记账机制 |
| **PromptBudgetPolicy** | token 预算 + priority-based 裁剪 | 当前无 |
| **ConfigurationLayer** | YAML 配置（cron / prompt 文案 / playbook / provider 开关 / budget） | 当前硬编码在 TS |
| **ObservabilitySink** | 每个 run 输出 composed-prompt 成分清单 | 当前只能看最终字符串 |

---

## 3. 核心数据模型（TypeScript 接口）

以下接口构成 PromptComposer 的"语言"。**所有 provider、所有 builder、所有调用方都使用同一套类型**。

```ts
// ─── PromptSection ───────────────────────────────────────────────────────────
// 一段内容的元数据 + 实际文本。所有 provider 都通过 push PromptSection 与 composer 交互。

export type SectionKind =
  | 'identity'             // 部门 identity rule
  | 'runtime-contract'     // executionClass / required artifacts / toolset
  | 'local-rule'           // department local rules
  | 'workflow'             // workflow MD 全文
  | 'workflow-runtime'     // runtime hook 生成的运行时上下文（daily-digest 等）
  | 'skill'                // skill SKILL.md
  | 'growth-asset'         // published growth proposal asset
  | 'knowledge'            // knowledge retrieval RAG
  | 'memory'               // Claude Engine memory prompt
  | 'supervisor-summary'   // supervisor 阶段摘要
  | 'task-context'         // task envelope / stage context
  | 'goal';                // 用户的 originalPrompt / Primary task

export interface PromptSection {
  /** 唯一 id（uuid 或 hash），用于 ledger 索引 */
  id: string;
  /** 段落语义类型 */
  kind: SectionKind;
  /** 优先级（0-1000）：越高越不会被 budget 裁剪 */
  priority: number;
  /** 注入此段的 provider name（observability 用） */
  source: string;
  /** 规范 ref（例如 `workflow:/platform_engineering_story_candidates`、`skill:browser-testing`）—— canonicalRef 去重键 */
  canonicalRef?: string;
  /** 用户层去重 key（用于无 canonicalRef 时的逻辑去重，如 `growth:asset:abc123`） */
  dedupeKey?: string;
  /** sha256(content)，contentHash 去重键 */
  contentHash: string;
  /** Markdown 内容本体 */
  content: string;
  /** 估算 token（用 backend 提供的 tokenizer 或近似算法） */
  tokenEstimate: number;
  /** 注入者声明的 trigger 条件（例如 'always_on' / 'interactive_only' / 'automation_opt_in'） */
  trigger?: 'always_on' | 'interactive_only' | 'automation_opt_in';
  /** 若被 dedupe 命中，记录指向的 sectionId */
  dedupedFrom?: string;
}

// ─── PromptLedgerEntry ──────────────────────────────────────────────────────

export interface PromptLedgerEntry {
  timestamp: string;
  event:
    | 'section.pushed'
    | 'section.deduped'
    | 'section.trimmed'
    | 'section.replaced-with-pointer'
    | 'budget.exceeded'
    | 'provider.skipped';
  sectionId?: string;
  source: string;
  reason?: string;
  details: Record<string, unknown>;
}

// ─── ContextProvider 接口 ───────────────────────────────────────────────────
// 所有上下文注入都改为 provider plugin。Provider 是无状态、可单测的。

export interface ContextProviderContext {
  scope: CompositionScope;
  registry: AssetRegistry;
  ledger: PromptLedger;
  config: PromptCompositionConfig;
  logger: Logger;
}

export interface ContextProvider {
  /** Provider 唯一名（用于配置开关、observability） */
  readonly name: string;
  /** 默认 priority；可被 config 覆盖 */
  readonly defaultPriority: number;
  /** 此 provider 是否应在当前 scope 下激活（同步快路径） */
  isApplicable(ctx: ContextProviderContext): boolean;
  /** 异步收集 sections（允许读盘 / 读 DB / 远程 RAG） */
  collect(ctx: ContextProviderContext): Promise<PromptSection[]>;
}

// ─── AssetRef ─────────────────────────────────────────────────────────────
// 资产规范化标识。统一替代 4 套加载器各自的 ref 形态。

export interface AssetRef {
  /** 资产类型 */
  kind: 'workflow' | 'skill' | 'identity' | 'local-rule' | 'growth-asset' | 'knowledge-asset';
  /** canonical id（例如 `/platform_engineering_story_candidates`、`browser-testing`） */
  id: string;
  /** 来源（canonical / growth-proposal / department-local / workspace-local） */
  source: 'canonical' | 'growth-proposal' | 'department-local' | 'workspace-local';
  /** 范围（global / workspace / department） */
  scope: 'global' | 'workspace' | 'department';
}

// ─── ComposedPrompt ────────────────────────────────────────────────────────

export interface ComposedPrompt {
  /** 最终 prompt 字符串（即将发给 backend.start 的 `prompt` 字段） */
  text: string;
  /** 成分清单（snapshot，写入 prompt.composed.json） */
  sections: PromptSection[];
  /** ledger 完整事件流 */
  ledger: PromptLedgerEntry[];
  /** 总 token 估算 */
  totalTokens: number;
  /** budget 信息 */
  budget: { total: number; used: number; trimmed: number };
  /** composer 版本（用于 observability schema 演化） */
  composerVersion: string;
}

// ─── CompositionScope ──────────────────────────────────────────────────────
// 调用方告诉 composer "我是谁、要为哪条 run 做拼装"。

export interface CompositionScope {
  runId: string;
  workspace: string;                     // workspace URI
  workspacePath: string;                 // 解析后的本地路径
  executionTarget: ExecutionTarget;      // 复用现有类型：prompt / template / review-flow
  triggerContext: {
    source: 'scheduler' | 'ceo' | 'web' | 'intervene' | 'company-loop';
    schedulerJobId?: string;
    parentRunId?: string;
    correlationId?: string;
  };
  /** 用户给的原始任务文本（成为 goal section） */
  originalPrompt: string;
  /** stage / role（template 路径专用） */
  stageId?: string;
  roleId?: string;
  round?: number;
  /** intervene / retry 专用 */
  retryHints?: { round: number; reviewFeedbackPath?: string };
}

// ─── PromptCompositionConfig（声明式 YAML 反序列化目标） ─────────────────────

export interface PromptCompositionConfig {
  version: 'v1';
  budget: {
    totalTokens: number;
    reservedOutputTokens: number;
    safetyMarginTokens: number;
  };
  providers: Record<
    string /* provider name */,
    {
      enabled: boolean;
      priorityOverride?: number;
      /** provider 专属配置（按 provider 名 namespace） */
      [key: string]: unknown;
    }
  >;
  /** 全局裁剪策略 */
  trimStrategy: 'priority-asc' | 'kind-allowlist' | 'custom';
  /** kind-allowlist 策略下的允许保留 kind 顺序 */
  kindKeepOrder?: SectionKind[];
  /** rules trigger 过滤（automation_opt_in 等） */
  rulesTriggerPolicy: {
    automationOptIn: boolean;
    interactiveOnly: boolean;
  };
}
```

---

## 4. ContextProvider Plugin 系统

### 4.1 注册机制

```ts
// src/lib/prompt-composer/registry.ts
const providers = new Map<string, ContextProvider>();

export function registerContextProvider(provider: ContextProvider): void {
  if (providers.has(provider.name)) {
    throw new Error(`ContextProvider "${provider.name}" already registered`);
  }
  providers.set(provider.name, provider);
}

export function listContextProviders(): ContextProvider[] {
  return Array.from(providers.values())
    .sort((a, b) => b.defaultPriority - a.defaultPriority);
}
```

启动期注册（`src/lib/prompt-composer/built-in-providers.ts`）：

```ts
export function registerBuiltInProviders(): void {
  registerContextProvider(new DepartmentIdentityProvider());
  registerContextProvider(new RuntimeContractProvider());
  registerContextProvider(new LocalRulesProvider());
  registerContextProvider(new WorkflowProvider());
  registerContextProvider(new RuntimeHookProvider());
  registerContextProvider(new SkillProvider());
  registerContextProvider(new GrowthAssetsProvider());
  registerContextProvider(new KnowledgeRetrievalProvider());
  registerContextProvider(new MemoryProvider());
  registerContextProvider(new TaskGoalProvider());
}
```

### 4.2 现有上下文如何变成 Provider

| 旧机制 | 新 Provider | 主要逻辑迁移点 |
|--------|------------|--------------|
| `buildSharedContext > view.identityRule` | **DepartmentIdentityProvider** | 从 `getDepartmentCapabilityView` 读 identity，push 一段 `kind: 'identity'`、priority=1000 |
| `runtimeContract` 字段（当前由 capability-pack 间接表达） | **RuntimeContractProvider** | 把 executionClass / required artifacts / toolset / permissionMode 显式 push 成 markdown 段 |
| `view.localRules` | **LocalRulesProvider** | 支持 frontmatter `trigger: always_on / interactive_only / automation_opt_in` 过滤 |
| `effectiveWorkflows` + `AssetLoader.resolveWorkflowContent` | **WorkflowProvider** | 通过 AssetRegistry 取 workflow；canonicalRef = `workflow:/<id>`；自动去重 |
| `prepareWorkflowRuntimeContext` | **RuntimeHookProvider** | runtimeProfile 注册中心化（见 4.3.5）；对所有 scope 都生效（不再只挂 PromptExecutor） |
| `view.skills` + `loadPublishedGrowthAssets.skills` | **SkillProvider** | 合并 canonical + growth；canonicalRef = `skill:<id>` |
| `loadPublishedGrowthAssets.workflows` | **GrowthAssetsProvider** | 从 growth proposal store 取 published assets；不再混入 effectiveWorkflows |
| `retrieveKnowledgeAssets` | **KnowledgeRetrievalProvider** | 直接迁移；对所有 scope 都生效 |
| `applyBeforeRunMemoryHooks` 内的 Claude Engine memory | **MemoryProvider** | 把 `buildMemoryPrompt` 调用迁进来；`applyBeforeRunMemoryHooks` 简化为只设 runtime contract |
| originalPrompt + Primary task 段 | **TaskGoalProvider** | priority=100（最低，避免被 dedupe 误删但优先级最低） |

### 4.3 关键 Provider 实现要点

#### 4.3.1 DepartmentIdentityProvider

```ts
class DepartmentIdentityProvider implements ContextProvider {
  name = 'department-identity';
  defaultPriority = 1000;
  isApplicable(ctx) { return Boolean(ctx.scope.workspacePath); }
  async collect(ctx) {
    const view = getDepartmentCapabilityView(ctx.scope.workspacePath);
    return [makeSection({
      kind: 'identity',
      source: this.name,
      priority: 1000,
      canonicalRef: `identity:${view.config.id}`,
      content: view.identityRule.trim(),
    })];
  }
}
```

#### 4.3.2 LocalRulesProvider（带 trigger frontmatter 过滤）

每条 local rule MD 支持 frontmatter：

```yaml
---
trigger: always_on        # 默认；任何 scope 都注入
# trigger: interactive_only  # 仅 web / ceo interactive 触发
# trigger: automation_opt_in # 仅 scheduler / company-loop 触发
priority: 900
---
```

Provider 内部按 `ctx.scope.triggerContext.source` + `ctx.config.rulesTriggerPolicy` 双重过滤。

#### 4.3.3 WorkflowProvider（带 dedupeKey）

```ts
class WorkflowProvider implements ContextProvider {
  name = 'workflow';
  defaultPriority = 800;
  async collect(ctx) {
    const refs = resolveWorkflowRefsFromScope(ctx);
    // 来源可能有 3 处：(1) executionTarget.promptAssetRefs (2) template workflow refs (3) growth assets
    return refs.map((ref) => {
      const wf = ctx.registry.getWorkflow(ref);
      return makeSection({
        kind: 'workflow',
        source: this.name,
        priority: 800,
        canonicalRef: `workflow:${ref}`,   // 关键：相同 ref 触发去重
        content: formatWorkflowSection(wf),
      });
    });
  }
}
```

#### 4.3.4 RuntimeHookProvider（runtimeProfile 注册中心化）

把目前散在 `workflow-runtime-hooks.ts` 的 switch 改为注册表：

```ts
interface RuntimeProfile {
  id: 'daily-digest' | 'daily-events' | 'story-top-candidates' | string;
  prepare(scope: CompositionScope, manifest: CanonicalWorkflowRuntimeConfig): Promise<string>;
  finalize?(scope: CompositionScope, result: TaskResult): Promise<TaskResult>;
}
const profiles = new Map<string, RuntimeProfile>();
export function registerRuntimeProfile(p: RuntimeProfile) { profiles.set(p.id, p); }
```

Provider 内只查注册表：

```ts
class RuntimeHookProvider implements ContextProvider {
  name = 'runtime-hook';
  defaultPriority = 750;
  async collect(ctx) {
    const wfRef = ctx.scope.executionTarget?.resolvedWorkflowRef;
    if (!wfRef) return [];
    const manifest = ctx.registry.getWorkflowRuntimeConfig(wfRef);
    const profile = profiles.get(manifest.runtimeProfile);
    if (!profile) return [];
    const appendix = await profile.prepare(ctx.scope, manifest);
    return appendix
      ? [makeSection({ kind: 'workflow-runtime', source: this.name, priority: 750,
          canonicalRef: `runtime:${wfRef}`, content: appendix })]
      : [];
  }
}
```

### 4.4 Provider 协作：顺序 / 优先级 / 互斥

- **collect 顺序**: 按 `priority` 降序异步 collect（高优先级先收集，便于 budget 裁剪决策）；可声明 `dependsOn: string[]` 强制串行（默认并行）。
- **互斥**: provider 可声明 `mutuallyExclusive: string[]`，例如 `growth-assets` 与 `workflow` 在某些客户配置下互斥（避免 growth 提案污染主线 workflow）。
- **renderOrder**: composer compose 时按 kind 渲染顺序输出，与 priority 解耦。默认顺序：identity → runtime-contract → local-rule → workflow → workflow-runtime → skill → growth-asset → knowledge → memory → supervisor-summary → task-context → goal。

---

## 5. AssetRegistry 设计

替代当前 4 套加载器（`AssetLoader.resolveWorkflowContent` / `getCanonicalWorkflow` / `getCanonicalWorkflowRuntimeConfig` / `loadPublishedGrowthAssets`）。

### 5.1 接口

```ts
export interface AssetRegistry {
  // 按 ref 取
  getWorkflow(ref: string): Promise<CanonicalWorkflow | null>;
  getWorkflowRuntimeConfig(ref: string): Promise<CanonicalWorkflowRuntimeConfig | null>;
  getSkill(id: string): Promise<CanonicalSkill | null>;
  getGrowthAssets(workspacePath: string): Promise<GrowthAssetBundle>;
  // 按 contentHash 反查（observability）
  getByContentHash(hash: string): AssetRef | null;
  // 失效
  invalidate(ref: string): void;
  reloadAll(): void;
}
```

### 5.2 双键索引

```
                           ┌─ ref index (canonicalRef → AssetRecord)
       AssetRegistry ──────┤
                           └─ content-hash index (sha256 → AssetRecord)

AssetRecord {
  ref, content, mtime, sha256, parsedFrontmatter, source
}
```

- 写入时同步更新两个索引；
- ✅ **mtime-based 缓存**：每次 get 检查文件 mtime，变化则重读；
- ⚠️ 多进程并发不强一致：本设计接受最终一致（worker 子进程允许短暂读到旧版本），通过 LL1 cache invalidation broadcast（基于 EventEmitter）做最终一致。

### 5.3 Schema-from-TS（zod / typebox）

当前 schema 在 3 处独立维护（playbook MD frontmatter / runtime-hook 解析 / TS 类型）。目标态用 **zod**：

```ts
import { z } from 'zod';

export const StoryTopCandidatePayloadSchema = z.object({
  candidates: z.array(z.object({
    id: z.string(),
    score: z.number(),
    rationale: z.string(),
  })),
});
export type StoryTopCandidatePayload = z.infer<typeof StoryTopCandidatePayloadSchema>;

// 从 zod 自动派生 JSON Schema 供 playbook MD frontmatter 引用
export const StoryTopCandidatePayloadJsonSchema = zodToJsonSchema(StoryTopCandidatePayloadSchema);
```

✅ 选 zod 而非 typebox：zod 在仓库已部分使用，学习成本低；zodToJsonSchema 成熟。
⚠️ 代价：runtime overhead 比纯 TS 类型多一次解析；但只发生在 manifest 加载，可忽略。

---

## 6. PromptLedger + 去重协议

### 6.1 Ledger 数据结构

```ts
class PromptLedger {
  private sections: PromptSection[] = [];
  private byContentHash = new Map<string, PromptSection>();
  private byCanonicalRef = new Map<string, PromptSection>();
  private byDedupeKey = new Map<string, PromptSection>();
  private events: PromptLedgerEntry[] = [];

  /** push → dedupe check → emit */
  push(section: PromptSection): { accepted: boolean; pointer?: PromptSection } {
    // 1. canonicalRef 优先（强语义）
    if (section.canonicalRef) {
      const existing = this.byCanonicalRef.get(section.canonicalRef);
      if (existing) {
        this.events.push({
          timestamp: new Date().toISOString(),
          event: 'section.deduped',
          sectionId: section.id,
          source: section.source,
          reason: 'canonicalRef-match',
          details: { canonicalRef: section.canonicalRef, existingId: existing.id },
        });
        return { accepted: false, pointer: existing };
      }
    }
    // 2. contentHash 兜底（弱语义；防止两个 provider 用不同 ref 注入同一内容）
    const byHash = this.byContentHash.get(section.contentHash);
    if (byHash) {
      this.events.push({
        timestamp: new Date().toISOString(),
        event: 'section.deduped',
        sectionId: section.id,
        source: section.source,
        reason: 'contentHash-match',
        details: { contentHash: section.contentHash, existingId: byHash.id },
      });
      return { accepted: false, pointer: byHash };
    }
    // 3. dedupeKey（业务自定义；例如 'growth:asset:abc123'）
    if (section.dedupeKey && this.byDedupeKey.has(section.dedupeKey)) {
      const existing = this.byDedupeKey.get(section.dedupeKey)!;
      return { accepted: false, pointer: existing };
    }
    this.sections.push(section);
    if (section.canonicalRef) this.byCanonicalRef.set(section.canonicalRef, section);
    this.byContentHash.set(section.contentHash, section);
    if (section.dedupeKey) this.byDedupeKey.set(section.dedupeKey, section);
    this.events.push({ event: 'section.pushed', sectionId: section.id, source: section.source,
      timestamp: new Date().toISOString(), details: {} });
    return { accepted: true };
  }
}
```

### 6.2 "重复内容只输出引用指针"格式

被 dedupe 命中的段，composer 不再 emit 完整内容，而是输出**引用指针块**：

```markdown
[See: workflow:/platform_engineering_story_candidates above]
```

或者更结构化（便于 LLM 解析）：

```markdown
<ref-pointer kind="workflow" canonical="/platform_engineering_story_candidates" originalSection="sec_a3f1">
This content was already included above. See section "Department Workflows > platform_engineering_story_candidates".
</ref-pointer>
```

✅ 选 XML-like tag 而非纯 markdown 注释：LLM 对 XML tag 解析稳定性高，且不会被误当作注释忽略。

### 6.3 双键去重的设计取舍

| 键 | 优点 | 缺点 |
|----|------|------|
| **canonicalRef** | 强语义；workflow 改内容也能去重 | 需要每个 provider 都正确填 ref |
| **contentHash** | 兜底；自动捕获"两个 provider 用不同 ref 注入同一内容" | workflow 内容轻微改动会绕过 |
| **dedupeKey** | 业务自定义；例如同一 growth proposal 不同版本 | 需要 provider 显式声明 |

⚠️ 三键同时启用：先 canonicalRef，再 contentHash，再 dedupeKey。这是为了在演进期（provider 还没完全标准化 ref）也能保证去重不退化。

---

## 7. Token Budget + Priority 裁剪

### 7.1 总 budget 来源

```
totalBudget = modelContextWindow - reservedOutputTokens - safetyMargin

例如 Claude Opus 200k context：
  totalBudget = 200_000 - 32_000 (reserved output) - 8_000 (safety) = 160_000 tokens for prompt
```

`modelContextWindow` 从 `backend.capabilities` 取（每个 backend 自己声明）。

### 7.2 Priority 分级

```
1000  identity                  (mandatory, never trimmed)
 950  runtime-contract          (mandatory)
 900  local-rule                (mandatory)
 800  workflow                  (high)
 750  workflow-runtime          (high)
 600  skill                     (medium)
 500  growth-asset              (medium-low)
 400  knowledge                 (low — first to trim)
 350  memory                    (low)
 300  supervisor-summary        (low)
 100  goal                      (never trimmed — explicit exception)
```

### 7.3 裁剪策略

```ts
function applyBudget(sections: PromptSection[], budget: BudgetPolicy): PromptSection[] {
  let used = sections.reduce((s, x) => s + x.tokenEstimate, 0);
  if (used <= budget.totalTokens) return sections;

  // 1. 按 priority 升序排序（低优先级先丢）
  const candidates = [...sections]
    .filter((s) => s.kind !== 'goal' && s.priority < 900)  // 强制保留 mandatory + goal
    .sort((a, b) => a.priority - b.priority);

  const dropped: PromptSection[] = [];
  for (const s of candidates) {
    if (used <= budget.totalTokens) break;
    used -= s.tokenEstimate;
    dropped.push(s);
    ledger.emit({
      event: 'section.trimmed',
      sectionId: s.id,
      source: s.source,
      reason: 'budget-exceeded',
      details: { freedTokens: s.tokenEstimate, newUsed: used },
    });
  }
  return sections.filter((s) => !dropped.includes(s));
}
```

裁剪顺序（实测优先级）：
1. **knowledge**（最低 400）—— 永远先丢
2. **memory** / **supervisor-summary** —— 再丢
3. **growth-asset** —— 再丢
4. **skill** —— 再丢
5. **workflow-runtime** —— 最后才考虑（因为它是运行时副作用产物，丢了可能导致 LLM 无数据可用）
6. **workflow / local-rule / runtime-contract / identity / goal** —— ❌ 永远不丢；如果连这些都装不下，说明配置错误，应抛硬错

裁剪事件记入 ledger，写入 `prompt.composed.json.budget.trimmed`，前端可展示"本次跑被裁掉了 knowledge 段，节省 1200 tokens"。

---

## 8. ConfigurationLayer（让客户/运营能配置）

### 8.1 配置文件路径

```
.department/
  config.json                          (existing — identity + local-rules registry)
  prompt-composition.yaml              (NEW — composer config)
.agents/
  scheduled-jobs.yaml                  (NEW — cron + dispatch action)
  provider-policy.yaml                 (NEW — per-customer provider toggles)
.workspace/
  prompt-overrides.yaml                (NEW — workspace-level priority overrides)
```

### 8.2 配置 schema 示例

#### `.department/prompt-composition.yaml`

```yaml
version: v1
budget:
  totalTokens: 160000
  reservedOutputTokens: 32000
  safetyMarginTokens: 8000

providers:
  department-identity:
    enabled: true
  runtime-contract:
    enabled: true
  local-rule:
    enabled: true
  workflow:
    enabled: true
  runtime-hook:
    enabled: true
  skill:
    enabled: true
  growth-assets:
    enabled: false      # ❌ 本部门关闭 growth proposal 注入
  knowledge:
    enabled: true
    priorityOverride: 350     # 把 knowledge 优先级压更低
    maxAssets: 3
  memory:
    enabled: true
  task-goal:
    enabled: true

trimStrategy: priority-asc

rulesTriggerPolicy:
  automationOptIn: false        # cron 任务不注入 automation_opt_in 规则
  interactiveOnly: false
```

#### `.agents/scheduled-jobs.yaml`

```yaml
version: v1
jobs:
  - id: story-top-3-daily
    cron: "0 9 * * *"
    action:
      kind: dispatch-prompt
      workspace: file:///workspaces/platform-engineering
      prompt: |
        请生成今日 Story Top 3 候选，参考 platform_engineering_story_candidates workflow。
      executionTarget:
        kind: prompt
        promptAssetRefs:
          - /platform_engineering_story_candidates
    composition:
      priorityOverrides:
        knowledge: 200          # 这个任务把 knowledge 压更低
      disableProviders:
        - growth-assets
```

#### `.agents/provider-policy.yaml`

```yaml
version: v1
customers:
  default:
    providers:
      knowledge: { enabled: true }
      memory: { enabled: true }
  enterprise-finance-co:           # 金融客户配置覆盖
    providers:
      knowledge: { enabled: false }     # SOC2 合规：禁用 RAG
      growth-assets: { enabled: false }
```

### 8.3 配置生效机制

- **启动加载**：`PromptComposer.create({ workspacePath })` 时合并 `.department/` + `.agents/` + 默认。
- **热重载**：监听 yaml 文件 mtime，变化时 `composer.reloadConfig()`；正在跑的 run 不受影响（compose 用的是启动 snapshot）。
- **变更审计**：每次 reload 写一条 `run-history` 等价的 `config-change.jsonl`，含 diff。
- **配置 vs 代码 兜底**：YAML 缺字段 → fallback 到 built-in default（在 TS 里）；YAML 写错语法 → 启动期 zod 校验失败、抛错；启动期校验通过后任何 provider runtime 错误 → 记 ledger，**不要 fallback 到代码 default 静默忽略**（避免配置改了但实际没生效的隐性 bug）。

✅ 选 YAML 而非 JSON / TS：运营常见手编辑场景；YAML 支持注释，对 cron / prompt 文案的可读性远好于 JSON；不选 TS-as-config 是因为它需要发版重启（违背 G2）。

---

## 9. 单一入口（Single Funnel）

### 9.1 唯一 API

```ts
class PromptComposer {
  async compose(scope: CompositionScope): Promise<ComposedPrompt> {
    const ctx = this.buildProviderContext(scope);
    const ledger = new PromptLedger();
    const applicable = listContextProviders().filter((p) => {
      if (!this.config.providers[p.name]?.enabled) {
        ledger.emit({ event: 'provider.skipped', source: p.name,
          reason: 'disabled-by-config', timestamp: new Date().toISOString(), details: {} });
        return false;
      }
      return p.isApplicable(ctx);
    });

    // 并行 collect
    const collected = await Promise.all(applicable.map((p) => p.collect({ ...ctx, ledger })));

    // Push to ledger（带去重）
    const accepted: PromptSection[] = [];
    const dedupePointers: { section: PromptSection; pointer: PromptSection }[] = [];
    for (const sections of collected) {
      for (const s of sections) {
        const r = ledger.push(s);
        if (r.accepted) accepted.push(s);
        else if (r.pointer) dedupePointers.push({ section: s, pointer: r.pointer });
      }
    }

    // Budget trim
    const after = applyBudget(accepted, this.config.budget, ledger);

    // Render
    const text = renderSections(after, dedupePointers);

    return {
      text,
      sections: after,
      ledger: ledger.events,
      totalTokens: after.reduce((s, x) => s + x.tokenEstimate, 0),
      budget: { /* ... */ },
      composerVersion: COMPOSER_VERSION,
    };
  }
}
```

### 9.2 调用方接入（替代 8 个入口）

| 旧入口 | 新接入方式 |
|--------|----------|
| `prompt-executor.ts:511` | `const composed = await composer.compose({ runId, workspace, executionTarget: { kind: 'prompt', ... }, originalPrompt: prompt, triggerContext, ... })` |
| `group-runtime.ts:1174` (legacy-single) | 同上，`executionTarget.kind = 'template'`, stageId/roleId 填入 |
| `group-runtime.ts:1663` (restart-role) | `retryHints: { round, reviewFeedbackPath }` |
| `group-runtime.ts:2108` (delivery-single-pass) | 同 template，标记 delivery |
| `group-runtime.ts:2275` (review-loop) | 每 round 每 role 各调一次 |
| `group-runtime.ts` shared-conversation role switch | 同上 |
| `dispatch-service.ts:167` template 派发 | 不再构造 promptPreamble；直接 `composer.compose(...)` |
| `group-runtime.ts:992` dispatchRun 兜底 | 同上 |

### 9.3 兼容性：薄 wrapper 策略

✅ 在过渡期（milestone M3-M5），**保留旧入口 API 签名**作为 wrapper：

```ts
// 兼容 wrapper（保留 1-2 个 minor 版本，便于第三方集成迁移）
export async function buildRolePrompt(role, ...): Promise<string> {
  console.warn('[deprecated] buildRolePrompt — use composer.compose() instead');
  const composed = await composerFromLegacy(role, ...);
  return composed.text;
}
```

终态（M8）删除所有 wrapper。

---

## 10. Observability + Debugging

### 10.1 每个 run 输出 2 个文件

```
<artifactDir>/
  prompt.composed.json       (machine-readable, 写到 run-history dir)
  prompt.composed.md         (human-readable, 写到 artifact dir)
```

#### `prompt.composed.json` 结构

```json
{
  "composerVersion": "1.0.0",
  "runId": "run_abc123",
  "composedAt": "2026-05-11T09:00:00Z",
  "totalTokens": 1240,
  "budget": { "total": 160000, "used": 1240, "trimmed": 0 },
  "sections": [
    {
      "id": "sec_a3f1",
      "kind": "identity",
      "source": "department-identity",
      "priority": 1000,
      "canonicalRef": "identity:platform-engineering",
      "contentHash": "sha256:abc...",
      "tokenEstimate": 180
    },
    {
      "id": "sec_b8c2",
      "kind": "workflow",
      "source": "workflow",
      "priority": 800,
      "canonicalRef": "workflow:/platform_engineering_story_candidates",
      "contentHash": "sha256:def...",
      "tokenEstimate": 420
    }
  ],
  "ledger": [
    { "event": "section.pushed", "sectionId": "sec_a3f1", "source": "department-identity", "timestamp": "..." },
    { "event": "section.deduped", "sectionId": "sec_x9", "source": "growth-assets",
      "reason": "canonicalRef-match", "details": { "canonicalRef": "workflow:/platform_engineering_story_candidates", "existingId": "sec_b8c2" } }
  ],
  "providersSkipped": ["growth-assets"]
}
```

#### `prompt.composed.md` 结构

```markdown
# Composed Prompt — run_abc123

**Total tokens**: 1240 / 160000 (0.8% used)
**Sections**: 8 accepted, 1 deduped, 0 trimmed

## Section Index

| # | Kind | Source | Priority | Tokens | Ref |
|---|------|--------|----------|--------|-----|
| 1 | identity | department-identity | 1000 | 180 | identity:platform-engineering |
| 2 | local-rule | local-rule | 900 | 60 | local-rule:always-write-tests |
| ... |

## Dedupe Hits

- `workflow:/platform_engineering_story_candidates` injected by `growth-assets` was deduped
  against earlier inject from `workflow` (saved 420 tokens).

## Trim Decisions

(none)

---

## Final Prompt Text

[原 prompt 文本]
```

### 10.2 整合到 `appendRunHistoryEntry`

```ts
appendRunHistoryEntry({
  runId, provider,
  eventType: 'prompt.composed',
  details: {
    totalTokens: composed.totalTokens,
    sectionsCount: composed.sections.length,
    dedupeHits: composed.ledger.filter((e) => e.event === 'section.deduped').length,
    trimmedSections: composed.ledger.filter((e) => e.event === 'section.trimmed').map((e) => e.sectionId),
    providersSkipped: composed.ledger.filter((e) => e.event === 'provider.skipped').map((e) => e.source),
    composedPromptPath: `<artifactDir>/prompt.composed.json`,
  },
});
```

前端 ops 页面可以直接展示"本次 run 注入了哪些 provider、节省了多少 token、被裁掉了哪段"。

---

## 11. 迁移路径（从当前到目标态）

⚠️ **绝对不是大爆炸式重写**。6-8 个 milestone，每个独立可验证、可回滚。

### Milestone 总览

| M# | 名称 | 工作量 (PR) | 风险 | 可独立交付? |
|----|------|------------|------|------------|
| M1 | PromptSection model + AssetRegistry 落地（仅引入类型，不改调用方） | 2 PR / ~1500 行 | 低 | ✅ |
| M2 | PromptLedger + 双键去重（封装但还不接管入口） | 2 PR / ~1200 行 | 低 | ✅ |
| M3 | ContextProvider 接口 + 5 个核心 provider（identity / rules / workflow / skill / goal） | 3 PR / ~3000 行 | 中 | ✅ |
| M4 | PromptComposer service + feature flag 控制（默认关闭） | 2 PR / ~1500 行 | 中 | ✅ |
| M5 | PromptExecutor 路径切到 composer（feature flag 开启），并保留旧路径 | 1 PR / ~800 行 | 中 | ✅ |
| M6 | group-runtime 5 个入口切到 composer | 3 PR / ~2500 行 | 高 | ✅（每个入口可独立切） |
| M7 | ConfigurationLayer（YAML）+ provider-policy + scheduled-jobs.yaml 迁移 | 3 PR / ~2000 行 | 中 | ✅ |
| M8 | 跨子系统接入（memory / supervisor-summary / ceo-prompts）+ token budget 启用 + 旧入口删除 | 4 PR / ~2500 行 | 高 | ✅ |

**总工作量估算**: ~20 PR / ~15000 行（含 test），按 1 Tech Lead + 2 工程师，跨 2-3 个 sprint（6-9 周）。

### M1: AssetRegistry + PromptSection model

- 新建 `src/lib/prompt-composer/{types.ts, asset-registry.ts}`
- 实现 `AssetRegistry` 包装现有 4 套加载器（接口适配，不改源）
- ✅ **不改任何调用方**；只引入类型和 registry，便于后续 provider 实现时直接 import
- 验证：单测覆盖率 ≥ 90%；现有所有测试通过
- 回滚：删除新文件即可

### M2: PromptLedger

- 新建 `src/lib/prompt-composer/ledger.ts`
- 实现双键去重 + 事件流
- 单测覆盖 contentHash / canonicalRef / dedupeKey 三种 dedupe 路径
- ✅ **不改任何调用方**

### M3: ContextProvider 接口 + 5 个核心 provider

- 新建 `src/lib/prompt-composer/providers/{identity, rules, workflow, skill, goal}.ts`
- 每个 provider 实现 + 单测
- ✅ **不改任何调用方**；provider 还没被 wire 进去
- 验证：每个 provider 单独 unit test，对比旧 builder 输出（snapshot test）

### M4: PromptComposer service + feature flag

- 新建 `src/lib/prompt-composer/composer.ts`
- feature flag: `PROMPT_COMPOSER_ENABLED=false`（默认）
- 实现 `compose(scope)` 完整流程（collect → ledger → budget → render）
- 集成测试：构造典型 scope，验证输出与旧 builder 等价（修复双重注入后的预期值）

### M5: PromptExecutor 路径切换（feature flag = true）

- 在 `prompt-executor.ts:511` 处加分支：
  ```ts
  const composed = process.env.PROMPT_COMPOSER_ENABLED === 'true'
    ? await composer.compose(scope)
    : { text: applyProviderExecutionContext([...], executionContext) };
  ```
- 在 staging / 部分客户开启 flag，观察 `prompt.composed.json` 输出
- ⚠️ 风险：PromptExecutor 是流量最大的路径之一；分阶段灰度（10% → 50% → 100%）
- 回滚：flag 设回 false

### M6: group-runtime 5 个入口切换

- 每个入口单独 PR；同样用 feature flag 控制
- 顺序：legacy-single (low traffic) → restart-role → delivery-single-pass → review-loop → shared-conversation role switch
- 每个入口切完跑一周 staging acceptance test 再切下一个

### M7: ConfigurationLayer

- 新建 `src/lib/prompt-composer/config-loader.ts`（YAML + zod 校验）
- 把现有硬编码（cron / prompt 文案 / playbook path）逐项迁到 yaml
- 兜底：yaml 缺失字段 fallback 到 TS default
- ✅ 这一步可以单独发布给客户体验"运营不发版改 cron"

### M8: 跨子系统统一 + 删除旧入口

- MemoryProvider 接入（把 `applyBeforeRunMemoryHooks` 内的 memory prompt 构造迁过来）
- supervisor-summary / ceo-prompts 接入
- token budget enable（之前 budget 只算不裁；此步开启裁剪）
- 删除 `applyProviderExecutionContext` / `buildRolePrompt` / `buildDeliveryPrompt` / `buildRoleSwitchPrompt` / `buildRetryPrompt` / `buildPromptExecutionPrompt`
- 删除 feature flag（默认行为 = composer）

### Feature flag 策略

```
PROMPT_COMPOSER_ENABLED                    # 全局开关
PROMPT_COMPOSER_ENABLED_FOR_PROMPT_MODE    # 仅 PromptExecutor
PROMPT_COMPOSER_ENABLED_FOR_TEMPLATE_MODE  # 仅 group-runtime
PROMPT_COMPOSER_BUDGET_TRIM_ENABLED        # 是否实际裁剪（false 时仅 emit 事件）
```

---

## 12. 关键设计决策与权衡（架构师视角）

### ✅ 决策 1: Plugin 系统 vs 内置 builder

**选了 plugin 系统**。
- 因为：每加一个上下文（RAG cache / token budget / 长上下文压缩 / 新 runtime profile）都不需要改 composer 核心，只新增一个 provider 注册即可。这是 G1（单一入口）的核心要求。
- ❌ **代价**：plugin 系统的复杂性高于"再加 5 个 builder"。新人理解曲线陡（要先学 provider 接口）。
- ⚠️ 缓解：built-in providers 不可禁用核心几个（identity / goal / task-context），降低误用风险。

### ✅ 决策 2: 双键去重（contentHash + canonicalRef + dedupeKey）

**三键并用，优先级 canonicalRef > contentHash > dedupeKey**。
- 因为：单独 contentHash 在内容轻微改动时失效；单独 canonicalRef 在 provider 没填 ref 时失效；dedupeKey 给业务侧特殊场景兜底。
- ❌ **代价**：dedupe 逻辑分支多，需要明确文档化"为什么命中了 X 没命中 Y"；ledger event reason 字段必填。
- 备选：只用 contentHash。**否决**，因为同一份 workflow 注释改了一个字就会绕过去重。

### ✅ 决策 3: 同步 compose vs 异步 stream compose

**选了异步（Promise）非 stream**。
- 因为：当前没有 stream prompt 的产品需求；compose 是 fast path（大部分时间花在 knowledge retrieval / runtime hook 这类 I/O，已经天然 async）；stream 化引入复杂度但收益不明显。
- ❌ **代价**：长 runtime hook（例如 daily-events 跑 Python）会阻塞 compose，最长可能 1-2 秒。
- ⚠️ 缓解：runtime hook provider 内部做 timeout（默认 5s），超时降级为空 appendix + emit warning。
- 备选：stream compose。**未来可演进**，但不放入 M1-M8。

### ✅ 决策 4: 配置 YAML vs JSON vs TypeScript-as-config

**选了 YAML**（G2 业务驱动）。
- 因为：运营要直接改；YAML 有注释、可读性高；prompt 文案多行字符串友好。
- ❌ **代价**：YAML 解析比 JSON 慢、有边角语法陷阱（缩进、boolean 字符串）；需要 zod schema 校验。
- 备选 1：JSON。**否决**，运营不会手编 JSON、无法注释。
- 备选 2：TS-as-config。**否决**，违背"不发版改"的要求。

### ✅ 决策 5: Schema 从 TS（zod）生成 JSON Schema vs 维护独立 JSON Schema 文件

**选了 zod 单一来源**。
- 因为：当前 schema 三处维护（playbook MD / runtime-hook / TS 类型）是个明确痛点；zod 已在仓库使用；zodToJsonSchema 工具链成熟。
- ❌ **代价**：runtime 多一次 zod 解析（cold path 影响可忽略）；学习曲线（团队要熟悉 zod）。
- 备选：JSON Schema 为主，TS 类型用 `json-schema-to-typescript` 反生成。**否决**，反生成的 TS 类型可读性差、IDE 体验不佳。

### ✅ 决策 6: 是否把 Claude Engine memory / supervisor / CEO prompts 都纳入 composer

**选了"纳入，但放到 M8 最后阶段"**。
- 因为：长期看必须统一才能解决根因（考古第七节"长期 P2"）；但短期 M1-M7 的价值已经能交付，没必要为了"完美统一"拖住主线。
- ❌ **代价**：M1-M7 期间，memory / supervisor / ceo 仍然是孤立体系，部分 budget 计量不准。
- ⚠️ 缓解：M1 开始就给 MemoryProvider / SupervisorSummaryProvider / CeoPromptProvider 占位接口，避免后期被卡。

### ✅ 决策 7: 引用指针格式（XML-like vs Markdown comment vs 纯 markdown）

**选了 XML-like tag**：`<ref-pointer kind=... canonical=...>...</ref-pointer>`。
- 因为：LLM（Claude / GPT）对 XML tag 解析极稳定；markdown comment `<!-- -->` 在某些 backend 渲染中被剥除；纯 markdown 指针无结构化语义。
- ❌ **代价**：XML tag 多 ~20 tokens / 个；非工程读者看到 raw prompt 时阅读体验下降。
- 备选：JSON inline。**否决**，破坏 prompt 的 markdown 语义流畅性。

---

## 13. 风险与开放问题

### 已知风险（known risks）

| # | 风险 | 概率 | 影响 | 缓解 |
|---|------|------|------|------|
| R1 | M5 / M6 切换时 prompt 输出与旧版有微小 diff，导致 LLM 输出回归 | 中 | 高 | snapshot test + 灰度 + ledger 比对工具 |
| R2 | provider collect 并发导致竞态（例如两个 provider 同时调 AssetRegistry 触发缓存写） | 低 | 中 | AssetRegistry 内部加 mutex；单测覆盖并发场景 |
| R3 | YAML 配置在 production 被错误编辑导致启动失败 | 中 | 高 | zod 校验 + 启动期 dry-run 模式 + 配置变更 CI 校验 |
| R4 | token budget 启用后误裁关键内容（例如裁了 workflow runtime hook 但 LLM 需要数据） | 中 | 高 | M8 前 budget 仅 emit 不裁；启用前跑大规模 shadow run |
| R5 | Antigravity 协议契约（IDE 端期望 prompt inline workflow）兼容性破坏 | 低 | 高 | 与 IDE 团队同步契约；保留 `composerVersion` 字段 |
| R6 | feature flag 长期挂着不删，造成代码 fork | 高 | 中 | M8 强制收尾；CI 检查 flag age > 90 天报警 |
| R7 | 跨子系统接入（memory / ceo）阻力大，M8 延期 | 中 | 中 | 这部分可降级为 P3，不阻塞 M1-M7 交付 |
| R8 | configuration hot reload 在多 worker 进程下不同步 | 中 | 低 | 启动期一次性加载；reload 通过 SIGHUP 全局触发 |

### 待决问题（open questions）

| # | 问题 | 需谁决策 | 影响 |
|---|------|---------|------|
| Q1 | YAML 配置 source-of-truth 放哪？仓库 vs 部门 workspace vs 外部 config store？ | 产品 + 安全 | 配置变更审计链路 |
| Q2 | 客户自定义 provider 是否支持？还是只允许内置 provider 配置开关？ | 产品 | 决定 plugin 系统是否对外开放 |
| Q3 | budget 超限时是裁剪 + 继续，还是直接 fail run？ | 产品 + 工程 | 裁剪 = 用户体验降级；fail = 用户感知问题 |
| Q4 | 多语言 prompt 模板（中文 / 英文部门）—— ConfigurationLayer 是否需要 i18n？ | 产品 | 影响 yaml schema |
| Q5 | 是否要把 ComposedPrompt 完整存到 run-history（增加存储成本）vs 只存摘要？ | 工程 + 运维 | 影响 run-history 体积，大概 +30-50% |

---

## 14. 与现有系统的衔接

### 14.1 Claude Engine memory 系统（`src/lib/claude-engine/memory/`）

- 当前：`buildMemoryPrompt`（`memory-prompt-builder.ts`）独立体系，通过 `applyBeforeRunMemoryHooks` 注入到 backend config。
- 目标态：**MemoryProvider 接管**。`buildMemoryPrompt` 函数保留为 pure helper，被 MemoryProvider 内部调用。`applyBeforeRunMemoryHooks` 简化为只设 runtime contract（不再注入 memory prompt）。
- M8 阶段统一。

### 14.2 CEO prompts / supervisor summary

- 当前：`supervisor.ts:summarizeStepForSupervisor` 自构造 supervisor prompt；`ceo-prompts.ts` 自构造 CEO prompts。
- 目标态：
  - **CeoPromptProvider**（priority=950）：把 CEO 的 system / persona prompt 作为 section 注入。
  - **SupervisorSummaryProvider**（priority=300）：把 supervisor 阶段总结作为 section 注入。
- 二者都通过 composer 出口，确保 token 计量、ledger、budget 统一。

### 14.3 Backend memory hook（`applyBeforeRunMemoryHooks`）

- 当前：在 backend.start 前给 BackendRunConfig 注入 memory prompt / runtime contract。
- 目标态：
  - **prompt 注入** → 移到 MemoryProvider；
  - **runtime contract** → 保留在 memory hook，因为它是 backend 启动参数（toolset / permissionMode / readRoots）而非 prompt 内容；
- 边界明确：composer 管 prompt 文本，memory hook 管 backend 参数。

### 14.4 Knowledge retrieval

- 当前：`retrieveKnowledgeAssets` + `formatKnowledgeAssetsForPrompt`，仅 PromptExecutor 接。
- 目标态：**KnowledgeRetrievalProvider** 接管；对所有 scope 都生效（group-runtime 也能接知识召回）。
- ⚠️ 注意：knowledge 召回有性能成本（DB query），需要在 isApplicable 阶段过滤掉不需要的 scope。

### 14.5 Antigravity 协议契约

❌ **不能破坏的部分**：
- backend.start 的 `prompt` 字段语义（最终拼好的 markdown 字符串）；
- `BackendRunConfig.runtimeContract`、`toolset`、`permissionMode` 等启动参数；
- IDE 端展示 prompt 时的 markdown 结构（identity → workflow → goal 的顺序）。

✅ **新增（不破坏）**：
- backend 可选接收 `composerMetadata: ComposedPrompt['sections']`（IDE 端可展示成分清单）；
- `composerVersion` 字段标识 prompt 来自哪个版本，便于双向兼容。

---

## 15. 目标态示例

### 15.1 同一条 Story Top 3 定时任务（新架构下）

#### 15.1.1 YAML 配置（`.agents/scheduled-jobs.yaml`）

```yaml
version: v1
jobs:
  - id: platform-engineering-story-top-3-daily
    cron: "0 9 * * *"
    description: "每日 9 点生成 Platform Engineering 部门 Story Top 3 候选"
    action:
      kind: dispatch-prompt
      workspace: file:///workspaces/platform-engineering
      prompt: |
        请基于今日数据生成 Platform Engineering 部门的 Story Top 3 候选清单。
        遵循 platform_engineering_story_candidates workflow 的输出 schema。
      executionTarget:
        kind: prompt
        promptAssetRefs:
          - /platform_engineering_story_candidates
    composition:
      priorityOverrides:
        knowledge: 200
      disableProviders:
        - growth-assets
      budgetTotalTokens: 60000
```

#### 15.1.2 Composer 内部流程（伪结构）

```
scheduler.run("platform-engineering-story-top-3-daily") {
  scope = {
    runId: "run_xyz",
    workspace: "file:///workspaces/platform-engineering",
    executionTarget: { kind: 'prompt', promptAssetRefs: ['/platform_engineering_story_candidates'] },
    triggerContext: { source: 'scheduler', schedulerJobId: 'platform-engineering-story-top-3-daily' },
    originalPrompt: "请基于今日数据生成 ..."
  }

  composer.compose(scope) {
    [applicable providers]:
      - DepartmentIdentityProvider   → 1 section (identity, 180 tok)
      - RuntimeContractProvider      → 1 section (runtime-contract, 80 tok)
      - LocalRulesProvider           → 2 sections (only 'always_on' rules due to scheduler scope, 120 tok)
      - WorkflowProvider             → 1 section (/platform_engineering_story_candidates, 420 tok)
      - RuntimeHookProvider          → 1 section (story-top-candidates runtime appendix, 280 tok)
      - SkillProvider                → 0 sections (no skill hint)
      - GrowthAssetsProvider         → SKIPPED (disabled in yaml)
      - KnowledgeRetrievalProvider   → 1 section (priority=200 due to override, 140 tok)
      - MemoryProvider               → 0 sections (no memory dir)
      - TaskGoalProvider             → 1 section (goal, 60 tok)

    [ledger]:
      - section.pushed × 8
      - section.deduped × 0 (no duplicates)
      - provider.skipped: growth-assets

    [budget]:
      total: 60000, used: 1280, trimmed: 0

    composed.text:
      <department-capability-pack>
      ...identity (180 tok)...
      ## Runtime Contract
      ...
      ## Department Local Rules
      ...
      ## Department Workflows
      ### platform_engineering_story_candidates
      ...
      </department-capability-pack>

      ## Workflow Runtime Context
      Prepared story-top candidates data:
      ...

      ## Retrieved Knowledge
      ...

      ## Primary Task
      请基于今日数据生成 ...
  }
}
```

#### 15.1.3 `prompt.composed.json` 输出（节选）

```json
{
  "composerVersion": "1.0.0",
  "runId": "run_xyz",
  "totalTokens": 1280,
  "budget": { "total": 60000, "used": 1280, "trimmed": 0 },
  "sections": [
    { "id": "sec_01", "kind": "identity", "source": "department-identity",
      "priority": 1000, "tokenEstimate": 180 },
    { "id": "sec_02", "kind": "runtime-contract", "source": "runtime-contract",
      "priority": 950, "tokenEstimate": 80 },
    { "id": "sec_03", "kind": "local-rule", "source": "local-rule",
      "priority": 900, "tokenEstimate": 60, "canonicalRef": "local-rule:no-pii-in-logs" },
    { "id": "sec_04", "kind": "local-rule", "source": "local-rule",
      "priority": 900, "tokenEstimate": 60, "canonicalRef": "local-rule:always-cite-source" },
    { "id": "sec_05", "kind": "workflow", "source": "workflow",
      "priority": 800, "tokenEstimate": 420,
      "canonicalRef": "workflow:/platform_engineering_story_candidates" },
    { "id": "sec_06", "kind": "workflow-runtime", "source": "runtime-hook",
      "priority": 750, "tokenEstimate": 280,
      "canonicalRef": "runtime:/platform_engineering_story_candidates" },
    { "id": "sec_07", "kind": "knowledge", "source": "knowledge",
      "priority": 200, "tokenEstimate": 140 },
    { "id": "sec_08", "kind": "goal", "source": "task-goal",
      "priority": 100, "tokenEstimate": 60 }
  ],
  "ledger": [
    { "event": "provider.skipped", "source": "growth-assets",
      "reason": "disabled-by-config", "timestamp": "..." },
    { "event": "section.pushed", "sectionId": "sec_01", "source": "department-identity", "timestamp": "..." }
  ]
}
```

### 15.2 Token 节省估算

| 项 | 当前（多重注入） | 目标态（去重 + 引用指针） | 节省 |
|----|----------------|------------------------|------|
| identity | 180 | 180 | 0 |
| runtime-contract | 0（未单独表达）| 80 | -80 |
| local-rule | 120 | 120 | 0 |
| **workflow（首次）** | 420 | 420 | 0 |
| **workflow（第二次, capability-pack）** | 420 | 0（去重）| **-420** |
| **workflow（第三次, Playbook context, PromptExecutor 路径）** | 420 | 0（去重）| **-420** |
| workflow-runtime | 280 | 280 | 0 |
| skill | 200 | 200 | 0 |
| knowledge | 140 | 140 | 0 |
| growth-assets | 380 | 0（disabled）| **-380** |
| memory | 0 | 0 | 0 |
| goal | 60 | 60 | 0 |
| ref-pointer overhead | 0 | +40（2 个 pointer）| +40 |
| **总计** | **~2620 tok** | **~1520 tok** | **节省 ~42%** |

对 PromptExecutor 路径下"workflow ×3 注入"的极端场景，节省更接近 **~50%**。

按当前观测到的日均 ~2000 runs 估算，按 Claude Opus $15 / 1M input tokens 计算：

```
日均节省: 2000 × 1100 tok = 2.2M tok/day
月节省: 66M tok/month → ~$1000/month
```

⚠️ 这是输入 token 节省；输出 token 不变；但 prompt 更精简通常意味着 LLM 关注度更集中、输出质量更高，间接的二阶收益不易量化但真实存在。

---

## 16. 落地后预期的工程实践变化

为了让重构成果不被未来"再叠一层"破坏，建议同步引入以下工程实践：

1. **新增上下文必须走 provider**：CI 检查任何新增的 `prompt += "..."` 直接拼接代码触发 review block。
2. **CHANGELOG 必填**：任何 provider 新增 / priority 调整 / canonicalRef 命名变更，必须在 CHANGELOG `[prompt-composition]` 节登记。
3. **Snapshot test**：每个 provider 一个 snapshot test，固化"在某个典型 scope 下注入什么 section"。
4. **Ledger diff 工具**：build 一个 `npm run prompt:diff <runId1> <runId2>` CLI，输出两个 run 的 sections 差异，便于回归排查。
5. **配置 schema 版本化**：YAML schema 升级（v1 → v2）必须有迁移脚本，启动期自动转换 + 留痕。

---

## 17. 结语

PromptComposer 不是"为了好看的抽象"。它是当前系统三代叠层的**唯一可持续出路**——只要不收敛，每加一个功能（RAG cache / token budget / 多语言 / 客户定制 / 自动评估）都要在 N 个地方接线，且大概率漏接其中一个。

本设计的核心承诺：

> **从 M5 开始，"接入一个新上下文"的代价从"改 8 个入口 + 3 套加载器"降到"注册一个 provider"。**

每个 milestone 都独立可交付、可回滚、有验收标准。第 M1-M3 可以在 4 周内完成（只引入类型 + registry + provider，零调用方改动），先把基础设施铺好；M4-M6 是实际收益爆发期（约 4-6 周）；M7-M8 是工程实践落地期（约 4 周）。

如果时间预算只够前半段，至少做到 M5（PromptExecutor 路径切完）—— 这能 100% 消除 PromptExecutor 路径的双重注入，并且为后续接 group-runtime 留好接口。M6-M8 可在下个季度继续。

> **不要等"完美方案"。M1-M3 是无悔投资（只增不改），先开工。**

---

## 附录 X：2026-05-11 修正声明

> 本节为本设计文档的**事后修正**。
>
> **触发因素**: 用户提供 UI 截图与运行实例 jobId，证实"调度系统已有完整 GUI 自服务能力"，前序据此设计的 §8 ConfigurationLayer（YAML manifest 化）方向不成立。
>
> **配套报告**: [`../research/scheduler-and-prompt-actual-state-correction-2026-05-11.md`](../research/scheduler-and-prompt-actual-state-correction-2026-05-11.md)

### X.1 撤回的设计

- ⚠️ **§8 `.agents/scheduled-jobs.yaml` 设计撤回** —— 实际项目已通过 `src/components/scheduler-panel.tsx`（GUI）+ `src/app/api/scheduler/jobs/` 三个路由（REST）+ `antigravity_create_scheduler_job` 等 MCP tools 提供**完整 CRUD**：新建 / 编辑 cron+prompt+promptAssetRefs+timezone+enabled / 启停 / 立即执行 / 删除 / 调度治理。YAML manifest 相对 GUI 是**功能退化**（失去字段级 schema 校验、操作审计、立即执行验证、SQLite 事务一致性）。

- ⚠️ **§11 M7 milestone 重新定位** —— 原 M7 "ConfigurationLayer（把内置 cron 任务 manifest 化）" 不应作为核心目标。真正需要"manifest 化或运营接管"的 builtIn 任务**只有 1 个**：`Platform Engineering Story Top 3`（jobId `builtin-platform-engineering-story-top-candidates`，cron 字面量 `'0 9 * * *'` 写死在 `src/lib/agents/scheduler.ts:229`，ensure 函数 `ensureBuiltInPlatformEngineeringStoryCandidateJob` 在 `:281-303` 每次启动覆盖用户编辑）。建议改造方向：把它降级为"onboarding seed 进 SQLite 的可编辑任务"，删除 ensure 函数，让运营在 GUI 上接管。**不要走 YAML 路线。**

- ⚠️ **§1 G2 / §8.1 等节中所有 "`.agents/scheduled-jobs.yaml` 改完热重载生效" 的措辞** —— 应解读为"GUI 改完即生效（已实现）"，YAML 路径作废。

### X.2 仍然成立的设计

- ✅ **M1-M5（PromptComposer Service + PromptLedger + AssetRegistry + ContextProvider 注册表）** —— 解决 prompt 装配重复注入、5 builder × 8 入口笛卡尔积、资产加载四套并行等问题。**与调度系统是否可配置是独立维度**，本次修正不影响。
- ✅ **§4 ContextProvider 插件系统** —— 仍是收敛 8 个入口的核心。
- ✅ **§5 AssetRegistry（内容寻址 + ref 寻址双键）** —— 仍是合并四套加载器的必要抽象。
- ✅ **§6 PromptLedger 双键去重协议（contentHash + canonicalRef）** —— 仍是解决"workflow MD 被注入两次"的硬核手段。
- ✅ **§7 Token Budget + Priority 裁剪** —— 仍然必要。
- ✅ **§10 Observability `prompt.composed.json` / `prompt.composed.md`** —— 仍然必要。
- ✅ **§9 单一入口（Single Funnel）** —— 仍是 G1 的核心实现。
- ⚠️ **§8 ConfigurationLayer**（部分保留）—— 删除调度 YAML 部分，**保留** `.department/prompt-composition.yaml` 与 `.agents/provider-policy.yaml`，但作用域**仅限装配策略**（provider 开关 / budget / priority override / rulesTriggerPolicy），不再涉及任何调度任务。

### X.3 调度系统真实状态简记

详细数据见配套报告 `../research/scheduler-and-prompt-actual-state-correction-2026-05-11.md`。要点：

| # | 任务 | 来源类型 | 可配置性 |
|---|---|---|---|
| 1 | 市场部 Prompt 任务 · 每周 | 运行时（CEO Agent 调 MCP） | ✅ GUI/API/MCP 全可改 |
| 2 | AI情报工作室 Native Codex 周期巡检 | 运行时（用户 REST） | ✅ GUI 可改 |
| 3 | AI情报工作室日报 · 每天 20:00 | 运行时（用户/CEO 创建） | ✅ GUI 可改 |
| 4 | Company Daily Loop | builtIn（policy 驱动） | ✅ 通过 policy API 可改 |
| 5 | Company Weekly Review | builtIn（policy 驱动） | ✅ 通过 policy API 可改 |
| 6 | Platform Engineering Story Top 3 | builtIn（cron 字面量硬编码） | ❌ 唯一真正不可改的任务 |

关键概念澄清（前序混淆）：

- **`createdBy` 字段**全集 = `'api' | 'mcp' | 'web' | 'ceo-command' | 'ceo-workflow'`（`src/lib/agents/scheduler-types.ts:15`）—— 描述**任务来源**。
- **UI 标签"工作流执行"**派生自 `executionProfile.kind === 'workflow-run'`（`src/lib/execution/contracts.ts:29-32` → `src/components/ops-dashboard.tsx:219`）—— 描述**任务执行形态**。
- 这是两个独立维度，不要再混淆为同一个字段。

### X.4 长期架构的真正核心（修正后）

去掉 §8 调度 YAML 与 M7 调度 manifest 化后，长期架构核心可一句话表达：

> **一个 PromptComposer service + 一套 ContextProvider 插件 + 一个 AssetRegistry + 一份 PromptLedger 双键去重协议。**

ConfigurationLayer 的角色由"统一的 YAML 配置层"重新定位为：

- **调度任务的可配置性** → 通过既有 GUI / REST / MCP 已经达成，**不需要再造**。
- **`Platform Engineering Story Top 3` 这一个特例** → 通过 onboarding seed + 删除 ensure 函数解决（一次性改动，几小时工作量）。
- **装配策略的可配置性**（provider 开关 / budget / priority override） → `.department/prompt-composition.yaml` 与 `.agents/provider-policy.yaml` 仍可考虑，但作用域大幅缩窄。

### X.5 修正后的 milestone 全景

| Milestone | 原版状态 | 修正后状态 | 备注 |
|---|---|---|---|
| M1 AssetRegistry + PromptSection model | 计划中 | ✅ 不变 | — |
| M2 PromptLedger | 计划中 | ✅ 不变 | — |
| M3 ContextProvider 接口 + 5 核心 provider | 计划中 | ✅ 不变 | — |
| M4 PromptComposer service + feature flag | 计划中 | ✅ 不变 | — |
| M5 PromptExecutor 路径切换 | 计划中 | ✅ 不变 | — |
| M6 group-runtime 5 个入口切换 | 计划中 | ✅ 不变 | — |
| **M7 ConfigurationLayer** | 计划中 | ⚠️ **缩窄** | 删除"调度任务 YAML 化"，仅保留装配策略 YAML |
| **新增 M7b "Story Top 3 seed 化"** | — | ✅ **新增** | 删除 `ensureBuiltInPlatformEngineeringStoryCandidateJob`，改为 onboarding 一次性 seed |
| M8 跨子系统统一 + 删除旧入口 | 计划中 | ✅ 不变 | — |

### X.6 致歉与责任声明

本设计文档在原版中将"调度任务硬编码"作为预设事实，并据此提出 `.agents/scheduled-jobs.yaml` 等设计。事后核查证明该预设错误。该错误根因是**只读后端 `scheduler.ts` 的 builtIn 部分而未读 `scheduler-panel.tsx` 等 UI 层代码**，导致把"6 个任务中 1 个真硬编码"放大为"全系统硬编码"。本附录作为正式修正，原文 §8 / M7 相关段落仍保留以保留历史脉络，但读者应以本附录为准。

— 架构组，2026-05-11
