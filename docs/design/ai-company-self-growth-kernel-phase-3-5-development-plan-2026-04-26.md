# AI 公司自增长内核 Phase 3-5 开发计划

**日期**: 2026-04-26  
**状态**: Implemented and verified  
**前置状态**: `ai-company-self-growth-kernel-long-term-plan-2026-04-25.md` 的 Phase 0-2 已完成底座落地。本文细化 Phase 3-5；实现完成后的验收记录见 `docs/PROJECT_PROGRESS.md`。  
**关联文档**:

1. `docs/design/ai-company-self-growth-kernel-long-term-plan-2026-04-25.md`
2. `docs/design/company-kernel-phase-0-2-implementation-rfc-2026-04-25.md`
3. `docs/design/company-kernel-boundary-audit-2026-04-25.md`

---

## 1. 计划定位

P0-P2 已经完成的是“公司内核底座”：

1. Phase 0：边界审计与主线冻结。
2. Phase 1：RunCapsule / WorkingCheckpoint。
3. Phase 2：MemoryCandidate / Promotion。

P3-P5 要解决的是“AI 公司自增长开始成形”：

1. Phase 3：把事件、失败、审批、知识候选、scheduler 状态变成统一经营信号和 agenda。
2. Phase 4：给 agenda / dispatch / scheduler / evolution 加预算、冷却、熔断和拦截原因。
3. Phase 5：基于真实 RunCapsule 和 promoted knowledge 生成 SOP / workflow / skill proposal。

一句话：

> P3 让系统会观察和排序，P4 让系统管得住，P5 让系统能沉淀可复用能力。

---

## 2. 总体路线

```text
P0-P2 已完成
  RunCapsule -> MemoryCandidate -> Knowledge Promotion

P3 Signal / Agenda
  OperatingSignal -> AgendaItem -> CompanyOperatingDay

P4 Budget / Circuit Breaker
  BudgetPolicy -> BudgetLedger -> DispatchGate -> CircuitBreaker

P5 Crystallizer
  RunCapsule + KnowledgeAsset + RepeatedRuns -> GrowthProposal -> Evaluation -> Approval -> Publish -> Observe
```

### 2.1 不做事项

P3-P5 期间明确不做：

1. 不做无限自循环。
2. 不做无审批自动发布。
3. 不做启动时全库扫描写入。
4. 不做 5 秒轮询。
5. 不做核心代码自改。
6. 不把每次任务都记录成长文档。
7. 不把 review findings 当成 Phase 主线；它们是 sidecar hardening，不是 P3-P5 的产品主线。

### 2.2 成功标准

P3-P5 全部完成后，用户应能看到：

1. CEO Office 里有真实 agenda，而不是前端拼接的“近期信号”。
2. Ops 能解释某个任务为什么没跑、为什么被拦截、为什么被熔断。
3. Knowledge 能把候选记忆、已晋升知识、SOP/workflow proposal 串起来。
4. Evolution proposal 不再泛泛生成模板，而是引用真实 run、artifact、evidence。
5. 系统具备“自增长候选”能力，但仍然受预算、审批和观察约束。

---

## 3. Phase 3: Signal / Agenda v1

### 3.1 目标

将 scheduler、run、approval、knowledge、system health 的事件统一转换成 `OperatingSignal`，再由确定性规则生成 `OperatingAgendaItem`。CEO routine 不再只是摘要，而是产出可解释、可排序、可下钻的 agenda。

P3 不自动执行任务，只建立“观察 -> 排序 -> 建议动作”的闭环。

### 3.2 关键对象

#### OperatingSignal

```ts
export interface OperatingSignal {
  id: string;
  source: 'scheduler' | 'run' | 'approval' | 'knowledge' | 'user' | 'system' | 'external';
  kind: 'opportunity' | 'risk' | 'routine' | 'failure' | 'learning' | 'decision';
  title: string;
  summary: string;
  evidenceRefs: string[];
  workspaceUri?: string;
  sourceRunId?: string;
  sourceJobId?: string;
  sourceCandidateId?: string;
  sourceApprovalId?: string;
  urgency: number;
  value: number;
  confidence: number;
  risk: number;
  estimatedCost: {
    tokens: number;
    minutes: number;
  };
  dedupeKey: string;
  status: 'observed' | 'triaged' | 'dismissed' | 'converted';
  createdAt: string;
  updatedAt: string;
}
```

#### OperatingAgendaItem

```ts
export interface OperatingAgendaItem {
  id: string;
  signalIds: string[];
  title: string;
  recommendedAction: 'dispatch' | 'ask_user' | 'approve' | 'observe' | 'snooze' | 'dismiss';
  targetDepartmentId?: string;
  suggestedWorkflowRef?: string;
  suggestedExecutionTargetId?: string;
  priority: 'p0' | 'p1' | 'p2' | 'p3';
  score: number;
  status: 'triaged' | 'ready' | 'blocked' | 'dispatched' | 'completed' | 'dismissed' | 'snoozed';
  reason: string;
  evidenceRefs: string[];
  createdAt: string;
  updatedAt: string;
}
```

#### CompanyOperatingDay

```ts
export interface CompanyOperatingDay {
  date: string;
  timezone: string;
  focus: string[];
  agenda: OperatingAgendaItem[];
  activeSignals: OperatingSignal[];
  departmentStates: DepartmentOperatingStateSummary[];
  activeRuns: string[];
  completedRuns: string[];
  newKnowledgeIds: string[];
  memoryCandidateIds: string[];
  blockedSignals: string[];
  createdAt: string;
  updatedAt: string;
}
```

### 3.3 模块设计

新增：

```text
src/lib/company-kernel/operating-signal.ts
src/lib/company-kernel/operating-signal-store.ts
src/lib/company-kernel/agenda.ts
src/lib/company-kernel/agenda-store.ts
src/lib/company-kernel/operating-day.ts
```

职责：

1. `operating-signal.ts`
   - signal 构建。
   - dedupeKey 生成。
   - scoring 输入归一化。
2. `operating-signal-store.ts`
   - SQLite CRUD。
   - 分页查询。
   - dedupe upsert。
3. `agenda.ts`
   - signal -> agenda item。
   - priority 计算。
   - recommendedAction 计算。
4. `agenda-store.ts`
   - agenda CRUD。
   - snooze / dismiss / complete。
5. `operating-day.ts`
   - 聚合今日读模型。
   - 提供 CEO Office 使用的低成本 API。

### 3.4 SQLite 表

```sql
CREATE TABLE IF NOT EXISTS operating_signals (
  signal_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  workspace TEXT,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL,
  score REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operating_signals_dedupe ON operating_signals(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_operating_signals_status ON operating_signals(status);
CREATE INDEX IF NOT EXISTS idx_operating_signals_source ON operating_signals(source);
CREATE INDEX IF NOT EXISTS idx_operating_signals_kind ON operating_signals(kind);
CREATE INDEX IF NOT EXISTS idx_operating_signals_updated_at ON operating_signals(updated_at);

CREATE TABLE IF NOT EXISTS operating_agenda (
  agenda_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  score REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operating_agenda_status ON operating_agenda(status);
CREATE INDEX IF NOT EXISTS idx_operating_agenda_priority ON operating_agenda(priority);
CREATE INDEX IF NOT EXISTS idx_operating_agenda_updated_at ON operating_agenda(updated_at);
```

### 3.5 Signal 来源

第一批只接入低风险来源。

#### Run terminal signal

来源文件：

1. `src/lib/agents/run-registry.ts`
2. `src/lib/agents/finalization.ts`
3. `src/lib/agents/prompt-executor.ts`
4. `src/lib/company-kernel/run-capsule-store.ts`

规则：

1. `failed / blocked / timeout` -> `failure` signal。
2. `completed` 且有 reusableSteps -> `learning` signal。
3. `completed` 且有 workflowSuggestion -> `opportunity` signal。
4. signal 必须引用 RunCapsule evidence。

#### Scheduler signal

来源文件：

1. `src/lib/agents/scheduler.ts`
2. `src/app/api/scheduler/jobs/*`

规则：

1. overdue job -> `routine` + `risk`。
2. repeated failure -> `failure`。
3. disabled scheduler with active jobs -> `risk`。
4. 手动 trigger 成功不重复生成 signal，只更新已有 signal 状态。

#### Approval signal

来源文件：

1. `src/lib/approval/*`
2. `src/app/api/approval/*`

规则：

1. pending approval -> `decision` signal。
2. rejected approval -> `risk` signal。
3. approved publish -> `opportunity` signal。

#### Knowledge signal

来源文件：

1. `src/lib/company-kernel/memory-candidate-store.ts`
2. `src/lib/company-kernel/memory-promotion.ts`
3. `src/lib/knowledge/store.ts`

规则：

1. pending-review MemoryCandidate -> `learning` or `decision`。
2. high conflict candidate -> `risk`。
3. promoted knowledge with reusable process -> `opportunity`。

### 3.6 Scoring 与分组

基础公式：

```text
score =
  urgency * 0.25
  + value * 0.35
  + confidence * 0.20
  - risk * 0.15
  - normalizedCost * 0.05
```

priority 规则：

1. `score >= 0.75` -> `p0`
2. `0.60 <= score < 0.75` -> `p1`
3. `0.40 <= score < 0.60` -> `p2`
4. `< 0.40` -> `p3`

recommendedAction 规则：

1. `risk >= 0.75` -> `approve` 或 `ask_user`。
2. `confidence < 0.5` -> `observe`。
3. `kind=failure` -> `ask_user` 或 `observe`。
4. `kind=learning` 且 evidence 足够 -> `approve`。
5. `kind=routine` 且 budget 未接入前 -> `observe`。

P3 不产生 `dispatch` 自动执行，最多建议 `dispatch`，状态仍为 `ready`。

### 3.7 API

新增：

```text
GET /api/company/signals
GET /api/company/signals/:id
POST /api/company/signals/:id/dismiss
GET /api/company/agenda
GET /api/company/agenda/:id
POST /api/company/agenda/:id/dismiss
POST /api/company/agenda/:id/snooze
GET /api/company/operating-day
```

要求：

1. 全部分页，默认 `pageSize=20`，最大 `pageSize=100`。
2. App route 与 control-plane route 都要注册。
3. `AG_ROLE=web` 必须代理到 control-plane。
4. API 不做全库扫描，只读已有 store 或按明确参数生成。

### 3.8 UI

CEO Office：

1. `决策队列` 改为 agenda 数据源。
2. 每个 agenda item 显示：
   - priority。
   - recommendedAction。
   - reason。
   - evidence count。
   - source。
3. 点击后打开详情：
   - signal 列表。
   - evidence refs。
   - linked run / candidate / approval。

Knowledge：

1. MemoryCandidate pending-review 可展示“已进入 agenda”状态。
2. 高冲突 candidate 显示 linked agenda。

Ops：

1. 新增 Operating Signals 列表。
2. 支持按 source / kind / status 过滤。
3. 显示 dedupeKey 和最后更新时间。

### 3.9 测试清单

新增：

```text
src/lib/company-kernel/operating-signal.test.ts
src/lib/company-kernel/operating-signal-store.test.ts
src/lib/company-kernel/agenda.test.ts
src/lib/company-kernel/agenda-store.test.ts
src/app/api/company/signals/route.test.ts
src/app/api/company/agenda/route.test.ts
src/app/api/company/operating-day/route.test.ts
```

覆盖：

1. failed run -> failure signal。
2. overdue scheduler -> routine risk signal。
3. pending approval -> decision signal。
4. pending-review MemoryCandidate -> learning signal。
5. dedupeKey 相同不会重复刷屏。
6. agenda score / priority 稳定。
7. dismiss / snooze 状态转换正确。
8. API 分页有效。
9. 测试不污染真实 DB。

### 3.10 Phase 3 验收

1. AI 日报 job overdue、审批、失败 run、知识候选都能变成 signal。
2. 同类 signal 不重复刷屏。
3. 高风险 signal 不自动执行。
4. CEO Office 能解释每个 agenda 来源和建议动作。
5. `/api/company/operating-day` 能作为 CEO Office 的主读模型之一。
6. `npm run build` 通过。
7. 相关 Vitest 通过。

---

## 4. Phase 4: Budget / Circuit Breaker

### 4.1 目标

自运营循环必须统一经过预算、并发、冷却和熔断。Phase 4 完成前，不允许把 agenda 自动派发成 run。

一句话：

> Scheduler 只能触发信号，dispatch 必须经过 budget gate。

### 4.2 核心对象

#### OperatingBudgetPolicy

```ts
export interface OperatingBudgetPolicy {
  id: string;
  scope: 'organization' | 'department' | 'workflow' | 'agenda-kind';
  scopeId: string;
  period: 'hour' | 'day' | 'week';
  maxConcurrentRuns: number;
  maxTokens: number;
  maxRuntimeMinutes: number;
  maxAutonomousDispatches: number;
  cooldownMinutesByKind: Record<string, number>;
  failureBudget: {
    maxConsecutiveFailures: number;
    circuitBreakMinutes: number;
  };
  createdAt: string;
  updatedAt: string;
}
```

#### BudgetLedgerEntry

```ts
export interface BudgetLedgerEntry {
  id: string;
  scope: OperatingBudgetPolicy['scope'];
  scopeId: string;
  agendaItemId?: string;
  runId?: string;
  schedulerJobId?: string;
  decision: 'reserved' | 'committed' | 'released' | 'blocked' | 'skipped';
  tokensReserved: number;
  tokensUsed: number;
  runtimeMinutes: number;
  reason: string;
  createdAt: string;
}
```

#### CircuitBreaker

```ts
export interface CircuitBreaker {
  id: string;
  scope: 'organization' | 'department' | 'workflow' | 'scheduler-job' | 'provider';
  scopeId: string;
  status: 'closed' | 'open' | 'half-open';
  reason: string;
  openedAt?: string;
  recoverAt?: string;
  consecutiveFailures: number;
  lastFailureRunId?: string;
  updatedAt: string;
}
```

### 4.3 模块设计

新增：

```text
src/lib/company-kernel/budget-policy.ts
src/lib/company-kernel/budget-ledger-store.ts
src/lib/company-kernel/budget-gate.ts
src/lib/company-kernel/circuit-breaker.ts
src/lib/company-kernel/autonomy-policy.ts
```

职责：

1. `budget-policy.ts`
   - 默认预算策略。
   - policy merge：organization -> department -> workflow。
2. `budget-gate.ts`
   - dispatch 前预算检查。
   - reserve / commit / release。
3. `budget-ledger-store.ts`
   - 预算流水。
   - 分页查询。
4. `circuit-breaker.ts`
   - 连续失败统计。
   - open / half-open / reset。
5. `autonomy-policy.ts`
   - 是否允许自动派发。
   - 风险阈值。
   - 高风险审批门槛。

### 4.4 SQLite 表

```sql
CREATE TABLE IF NOT EXISTS budget_policies (
  policy_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  period TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_policies_scope ON budget_policies(scope, scope_id, period);

CREATE TABLE IF NOT EXISTS budget_ledger (
  ledger_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  agenda_item_id TEXT,
  run_id TEXT,
  scheduler_job_id TEXT,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_budget_ledger_scope ON budget_ledger(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_budget_ledger_decision ON budget_ledger(decision);
CREATE INDEX IF NOT EXISTS idx_budget_ledger_created_at ON budget_ledger(created_at);

CREATE TABLE IF NOT EXISTS circuit_breakers (
  breaker_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_circuit_breakers_scope ON circuit_breakers(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_circuit_breakers_status ON circuit_breakers(status);
```

### 4.5 接入点

#### Scheduler

文件：

1. `src/lib/agents/scheduler.ts`
2. `src/server/workers/scheduler-worker.ts`

规则：

1. 到点任务先经过 budget check。
2. budget deny -> 写 budget ledger + signal，不创建 run。
3. circuit open -> 写 skipped ledger + signal，不创建 run。
4. 仍禁止高频扫描。

#### CEO dispatch

文件：

1. `src/lib/agents/ceo-agent.ts`
2. `src/app/api/ceo/command/route.ts`
3. `src/app/api/agent-runs/route.ts`

规则：

1. 用户手动任务可绕过 autonomous dispatch cap，但仍记录 tokens/runtime ledger。
2. 高风险任务必须产生 approval。
3. 缺 provider / 缺 execution target -> agenda blocked。

#### Agenda dispatch

P4 第一版可以只做 `dry-run dispatch gate`：

1. Agenda item 点击“执行”前检查预算。
2. 通过后创建 run。
3. 不做无人值守批量派发。

#### Evolution / Crystallizer

1. proposal generate 前检查 budget。
2. evaluation 前检查 budget。
3. publish 仍走 approval。

### 4.6 API

新增：

```text
GET /api/company/budget/policies
PUT /api/company/budget/policies/:id
GET /api/company/budget/ledger
GET /api/company/circuit-breakers
POST /api/company/circuit-breakers/:id/reset
POST /api/company/agenda/:id/dispatch-check
POST /api/company/agenda/:id/dispatch
```

要求：

1. ledger 分页。
2. dispatch-check 只检查，不创建 run。
3. dispatch 创建 run 前必须 reserve budget。
4. run terminal 后必须 commit/release budget。

### 4.7 UI

Ops：

1. Budget Ledger 表格。
2. Circuit Breaker 卡片。
3. Scheduler skip reason。
4. Provider / department / workflow 维度过滤。

CEO Office：

1. agenda item 显示 budget 状态。
2. 被拦截的 agenda 显示原因。
3. 不展示复杂 budget 配置。

Settings：

1. Organization autonomy policy。
2. Department budget defaults。
3. High-risk approval threshold。

### 4.8 测试清单

新增：

```text
src/lib/company-kernel/budget-policy.test.ts
src/lib/company-kernel/budget-gate.test.ts
src/lib/company-kernel/budget-ledger-store.test.ts
src/lib/company-kernel/circuit-breaker.test.ts
src/app/api/company/budget/ledger/route.test.ts
src/app/api/company/circuit-breakers/route.test.ts
```

覆盖：

1. 同部门并发超过上限 -> blocked。
2. 日预算超过上限 -> blocked。
3. cooldown 未到 -> skipped。
4. 连续失败触发 circuit open。
5. recoverAt 到期进入 half-open。
6. 手动 reset 正确关闭 breaker。
7. scheduler 被 budget/circuit 拦截时不创建 run。
8. ledger 不写真实 DB。

### 4.9 Phase 4 验收

1. 同部门并发限制生效。
2. 连续失败触发熔断。
3. 预算不足时生成可解释的 blocked / skipped 记录。
4. Ops 能看到某个任务为什么没执行。
5. Agenda dispatch 不绕过 budget。
6. Scheduler 不绕过 budget。
7. `npm run build` 通过。
8. 相关 Vitest 通过。

---

## 5. Phase 5: Crystallizer v1

### 5.1 目标

从真实 RunCapsule、KnowledgeAsset、repeated runs 中提炼 SOP / workflow / skill，让 evolution proposal 不再泛泛生成模板。

P5 不做自动发布。P5 做的是：

```text
发现可复用路径 -> 生成 GrowthProposal -> evaluation -> approval -> publish -> observe
```

### 5.2 核心对象

#### GrowthProposal

```ts
export interface GrowthProposal {
  id: string;
  kind: 'workflow' | 'skill' | 'sop' | 'script' | 'rule';
  title: string;
  sourceRunIds: string[];
  sourceKnowledgeIds: string[];
  evidenceRefs: string[];
  targetScope: 'global' | 'department';
  targetRef?: string;
  draftContent: string;
  expectedBenefit: {
    repeatability: number;
    tokenSaving: number;
    failureReduction: number;
  };
  risk: 'low' | 'medium' | 'high';
  score: {
    recurrence: number;
    successRate: number;
    stepStability: number;
    tokenSaving: number;
    riskPenalty: number;
    total: number;
  };
  status: 'draft' | 'evaluated' | 'approval-required' | 'approved' | 'published' | 'rejected' | 'observing';
  createdAt: string;
  updatedAt: string;
}
```

#### GrowthObservation

```ts
export interface GrowthObservation {
  id: string;
  proposalId: string;
  publishedAssetRef: string;
  matchedRunIds: string[];
  hitCount: number;
  successRate: number;
  estimatedTokenSaving: number;
  regressionSignals: string[];
  observedAt: string;
}
```

### 5.3 模块设计

新增：

```text
src/lib/company-kernel/crystallizer.ts
src/lib/company-kernel/growth-proposal-store.ts
src/lib/company-kernel/growth-evaluator.ts
src/lib/company-kernel/growth-publisher.ts
src/lib/company-kernel/growth-observer.ts
```

同时改造：

```text
src/lib/evolution/generator.ts
src/lib/evolution/evaluator.ts
src/lib/evolution/publisher.ts
src/app/api/evolution/proposals/*
```

原则：

1. P5 不删除现有 evolution API。
2. P5 把 Company Kernel 的 GrowthProposal 作为更强输入。
3. 现有 workflow / skill proposal 逐步迁移为 GrowthProposal 的一种发布目标。

### 5.4 输入来源

#### RunCapsule

使用字段：

1. `reusableSteps`
2. `decisions`
3. `verifiedFacts`
4. `qualitySignals`
5. `outputArtifacts`
6. `tokenUsage`

#### KnowledgeAsset

使用字段：

1. `category`
2. `status`
3. `evidence`
4. `promotion`
5. `usageCount`
6. `source.runId`

#### MemoryCandidate

使用字段：

1. `kind=workflow-proposal / skill-proposal / pattern`
2. `score`
3. `evidenceRefs`
4. `promotedKnowledgeId`

#### Repeated runs

第一版不做全库后台扫描，只允许：

1. API 显式触发。
2. Ops 手动触发。
3. Agenda item 指向的 run cluster。
4. 低频 scheduler 触发，但必须经过 P4 budget。

### 5.5 Crystallization Score

```text
crystallizationScore =
  recurrence * 0.30
  + successRate * 0.25
  + stepStability * 0.20
  + tokenSaving * 0.15
  - riskPenalty * 0.10
```

动作：

1. `< 0.40` -> 不生成 proposal。
2. `0.40 - 0.60` -> SOP candidate。
3. `0.60 - 0.75` -> workflow / skill proposal。
4. `> 0.75` -> proposal + evaluation。
5. script 无论分数多高都必须 approval required。

### 5.6 生成规则

#### SOP proposal

触发：

1. reusableSteps 存在。
2. 过程稳定，但还不适合自动执行。
3. 风险低。

输出：

1. Markdown SOP。
2. evidence refs。
3. sourceRunIds。

#### Workflow proposal

触发：

1. 同类任务至少 3 次成功。
2. reusableSteps 高度稳定。
3. 输入输出边界明确。
4. tokenSaving 或 failureReduction 有收益。

输出：

1. workflow markdown / yaml draft。
2. skillRefs / required inputs。
3. verification criteria。

#### Skill proposal

触发：

1. 某段操作可作为独立能力复用。
2. 不依赖完整 workflow。
3. 有清晰使用说明和边界。

输出：

1. Skill draft。
2. examples。
3. evidence refs。

#### Script proposal

触发：

1. 重复任务需要工具脚本。
2. 脚本能显著降低 token 或失败率。

要求：

1. 默认 high risk。
2. 必须 sandbox / dry-run。
3. 必须 approval required。
4. 不允许自动发布。

### 5.7 API

新增或增强：

```text
POST /api/company/growth/proposals/generate
GET /api/company/growth/proposals
GET /api/company/growth/proposals/:id
POST /api/company/growth/proposals/:id/evaluate
POST /api/company/growth/proposals/:id/approve
POST /api/company/growth/proposals/:id/reject
POST /api/company/growth/proposals/:id/dry-run
POST /api/company/growth/proposals/:id/publish
GET /api/company/growth/observations
```

兼容：

1. 现有 `/api/evolution/proposals/*` 可继续存在。
2. 新 API 可内部复用 evolution store / publisher。
3. 长期可将 evolution API 标记为 legacy wrapper。

### 5.8 UI

CEO Office：

1. Growth Feed 显示：
   - 新 SOP proposal。
   - workflow proposal。
   - skill proposal。
   - observing 中的已发布能力。
2. 高风险 proposal 进入决策队列。

Knowledge：

1. MemoryCandidate 详情增加“生成 SOP / Workflow proposal”入口。
2. KnowledgeAsset 详情展示 linked GrowthProposal。
3. 支持按 `proposal / published / observing` 过滤。

Ops：

1. Growth evaluation 日志。
2. Proposal publish / observe 状态。
3. Script proposal dry-run 结果。

### 5.9 测试清单

新增：

```text
src/lib/company-kernel/crystallizer.test.ts
src/lib/company-kernel/growth-proposal-store.test.ts
src/lib/company-kernel/growth-evaluator.test.ts
src/lib/company-kernel/growth-publisher.test.ts
src/lib/company-kernel/growth-observer.test.ts
src/app/api/company/growth/proposals/route.test.ts
src/app/api/company/growth/proposals/[id]/evaluate/route.test.ts
src/app/api/company/growth/proposals/[id]/publish/route.test.ts
```

覆盖：

1. 连续 3 次同类日报 run -> workflow proposal。
2. reusableSteps -> SOP proposal。
3. promoted workflow candidate -> GrowthProposal。
4. 泛泛模板 proposal 被低分挡住。
5. high risk script -> `approval-required`。
6. publish 后写 observation。
7. 下次同类任务命中 published workflow / skill。
8. 不污染真实 DB。

### 5.10 Phase 5 验收

1. 连续 3 次同类日报或分析任务能生成具体 workflow proposal。
2. proposal 内容包含真实执行路径和 evidence refs。
3. 发布后下次同类任务能命中 workflow / skill。
4. 泛泛模板型 proposal 被评分挡住。
5. 高风险 script proposal 默认 approval required。
6. CEO Office / Knowledge 能展示增长 proposal。
7. `npm run build` 通过。
8. 相关 Vitest 通过。

---

## 6. 分阶段实施顺序

### Week 1-2: Phase 3

1. P3-A: Contracts + stores。
2. P3-B: run / scheduler / approval / knowledge signal producers。
3. P3-C: agenda builder + operating day。
4. P3-D: API routes。
5. P3-E: CEO Office / Ops minimal UI。
6. P3-F: tests + build + browser smoke。

### Week 3: Phase 4

1. P4-A: BudgetPolicy / BudgetLedger / CircuitBreaker contracts。
2. P4-B: stores。
3. P4-C: budget gate。
4. P4-D: scheduler / agenda dispatch 接入。
5. P4-E: Ops / Settings minimal UI。
6. P4-F: tests + build + API smoke。

### Week 4-5: Phase 5

1. P5-A: GrowthProposal contract + store。
2. P5-B: Crystallizer from RunCapsule / KnowledgeAsset。
3. P5-C: evaluator。
4. P5-D: approval / publish / observe。
5. P5-E: CEO Office / Knowledge Growth Feed。
6. P5-F: tests + build + real chain smoke。

---

## 7. 跨阶段约束

### 7.1 写入边界

1. P3 signal 可以由事件触发写入。
2. P4 budget ledger 可以由 dispatch / scheduler / run finalization 写入。
3. P5 proposal 只能由显式触发、低频 budgeted job 或人工动作生成。
4. 任何阶段不得在启动时全库扫描并写入。

### 7.2 后台边界

1. 不新增 5 秒 interval。
2. scheduler 触发必须走 P4 budget。
3. crystallizer 不常驻后台。
4. browser / UI 不做高频全量 polling。

### 7.3 Antigravity 兼容

P3-P5 不改变：

1. Antigravity workspace/server 扫描。
2. Language Server 查找。
3. Language Server 进程启动。
4. Antigravity conversation/cascade 接入。
5. Native Codex / Codex CLI / OpenAI-compatible provider 的执行协议。

### 7.4 测试隔离

1. 所有 store test 必须使用 Vitest 临时 HOME / AG_GATEWAY_HOME。
2. 不允许测试写真实 `~/.gemini/antigravity`。
3. 不允许测试创建真实 scheduler job。
4. 真实链路验证必须明确标注是否使用真实库。

---

## 8. 最终验收样例

P3-P5 全部完成后应能跑通以下真实链路：

```text
AI 日报 scheduler job 到点
-> 生成 routine signal
-> agenda builder 评估为 ready
-> budget gate 允许 dispatch
-> run 执行并生成 RunCapsule
-> MemoryCandidate 生成并等待晋升
-> repeated successful digest runs 被 Crystallizer 识别
-> 生成 AI 日报 workflow proposal
-> evaluation 通过
-> approval required
-> CEO 批准
-> publish workflow
-> 下次 AI 日报命中 workflow
-> observation 记录命中率、失败率、token saving
```

这条链路才表示 AI 公司开始有“受控自增长”能力。

---

## 9. 实现闭环记录

2026-04-26 已按本文完成 Phase 3-5 主线落地，并在二次复核后补齐以下缺口：

1. Approval lifecycle 已接入经营信号：提交审批会生成 `decision` signal，批准会生成 `opportunity` signal，拒绝或反馈会生成 `risk/decision` signal，并进入 agenda。
2. Scheduler 到点执行不再绕过预算：触发前先生成 routine agenda，再经过 budget gate；预算或熔断不允许时返回 `skipped`，不创建 run，并写入可解释 ledger。
3. Agenda dispatch 会先校验 target workspace，再 reserve budget；缺少 workspace 的 agenda 返回 `409`，不会泄漏 `reserved` ledger。
4. Agenda dispatch 创建 run 后会把 reservation ledger 绑定到 `runId`；run 进入 terminal 后统一 commit / release，ledger summary 不再重复计算 reserved + committed。
5. Run terminal failure 会更新 department、scheduler-job、provider、workflow 维度 circuit breaker；成功终态会 reset 对应 breaker。
6. Budget ledger 增加 `skipped` 决策，区分“没有执行但已解释跳过”和真正执行失败；growth generate/evaluate 会写 `growth-proposal` scope ledger。
7. Crystallizer 对三次以上同类成功 RunCapsule 生成 `workflow` proposal，两次同类成功仍生成 SOP candidate。
8. 高风险 GrowthProposal evaluate/publish 会创建 approval request，approval callback 可 publish/reject growth proposal。
9. Published workflow/skill GrowthProposal 会进入 Prompt Mode 执行解析，下一次相似任务可注入 canonical workflow/skill。
10. GrowthProposal 合约扩展到 `sop/workflow/skill/script/rule`，Observation 记录 hit count、success rate、估算 token saving 与 regression signals。
11. CEO Office 决策队列支持 agenda 详情态，展示 signals、evidence refs 与 linked run/workflow/budget。
12. Knowledge 增长提案区支持 generate / evaluate / approve / reject / publish / observe，候选记忆区保留独立详情审核态。
13. Ops scheduler 面板新增可筛选 Operating Signals 列表，支持 source / kind / status 过滤并显示 dedupeKey。
14. `control-plane` company routes 已从主 server 拆出并改为按请求懒加载 App Route handler，组合测试不再依赖提高 timeout 收口。
15. `next build` 阶段仍保持不读取真实 HOME AI config 的隔离策略。
16. `cooldownMinutesByKind` 已接入 budget gate，按 ledger `operationKind` 阻止冷却期内重复动作，并支持写入 `skipped` ledger。
17. 手动 CEO / `agent-runs` dispatch 已接入预算流水：先 reserve，拿到 `runId` 后 attach，终态统一 commit/release；手动任务不消耗 autonomous dispatch quota。
18. 公开 GrowthProposal publish API 不再接受 `force`；`script` proposal 必须通过 dry-run，审批 callback 的 force 也不能绕过 script dry-run。
19. Crystallizer 已补齐 repeated run cluster 的 `script` / `rule` proposal 生成路径，script 默认带 `DRY_RUN` guard。
20. Settings 已新增 `Autonomy 预算` 页签，支持组织级预算、并发、失败预算、operation cooldown 和 high-risk approval threshold 配置。
21. `autonomy-policy` 已接入 GrowthProposal evaluation/publish 判定：高风险和 script 仍强制审批，中风险可按组织阈值进入 approval-required。
22. Knowledge 深层旅程已闭合：MemoryCandidate 详情可生成 linked GrowthProposal，KnowledgeAsset 详情展示关联 GrowthProposal；`pattern` candidate 也可生成 SOP proposal。
23. CircuitBreaker 已补齐 `recoverAt` / `half-open` 生命周期：open breaker 冷却到期后会持久化为 half-open，成功终态 reset，half-open 失败会重新 open。
24. Settings `Autonomy 预算` 已补齐 Department budget defaults；未配置专属策略的新部门会从 `budget:department:default:day` 继承默认预算。
25. Crystallizer 已补齐 promoted `pattern/lesson` KnowledgeAsset 到 SOP GrowthProposal 的生成路径，并保留 promotion/evidence/sourceCandidate 关联。

### 9.1 本轮验收

通过：

```bash
npx eslint src/components/settings-panel.tsx src/components/knowledge-panel.tsx src/lib/company-kernel/autonomy-policy.ts src/lib/company-kernel/budget-policy.ts src/lib/company-kernel/circuit-breaker.ts src/lib/company-kernel/contracts.ts src/lib/company-kernel/growth-evaluator.ts src/lib/company-kernel/crystallizer.ts src/lib/company-kernel/index.ts src/lib/company-kernel/operating-kernel.test.ts src/lib/types.ts src/server/control-plane/company-routes.ts src/server/control-plane/server.ts src/server/control-plane/server.test.ts
```

```bash
npx vitest run src/lib/company-kernel src/app/api/company src/lib/agents/department-execution-resolver.test.ts src/lib/agents/scheduler.test.ts src/app/api/agent-runs/route.test.ts src/server/control-plane/server.test.ts src/lib/providers/provider-availability.test.ts src/lib/app-url-state.test.ts
```

结果：`13 files passed`，`92 tests passed`；`src/server/control-plane/server.test.ts` 本轮约 `488ms`，远离默认 `5s` 超时线。

```bash
npx tsc --noEmit --pretty false
```

结果：类型检查通过。

```bash
npm run build
```

结果：生产构建成功。

真实 smoke：

1. 复用既有 `localhost:3000`，未新开 dev/start/watch/worker 服务。
2. `GET /api/company/operating-day?limit=3` 返回 `200`，约 `0.176s`。
3. `GET /api/company/growth/proposals?pageSize=3` 返回 `200`，约 `0.078s`。
4. `bb-browser` 打开 `http://127.0.0.1:3000/` 后清空 JS error 记录，未发现新增页面错误。

### 9.2 后续 hardening

Phase 3-5 主线已闭合。后续不再把 hardening 混入 Phase 主线，单独排期处理：

1. 增加长期运行样本，观察 published workflow/skill proposal 在真实 scheduler / CEO prompt 中的命中率。
2. 为 Budget / CircuitBreaker 增加导出能力，但不改变当前执行 gate。
3. Settings Autonomy 后续可扩展为单部门专属策略编辑；当前已具备组织级策略和部门默认策略。
