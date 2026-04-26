# AI 公司自增长内核 Phase 6-7 剩余开发计划

**日期**: 2026-04-26  
**状态**: Implemented and verified  
**前置状态**: `ai-company-self-growth-kernel-long-term-plan-2026-04-25.md` 的 Phase 0-5 已完成主线落地；Phase 3-5 的细化实现与验收见 `ai-company-self-growth-kernel-phase-3-5-development-plan-2026-04-26.md` 与 `docs/PROJECT_PROGRESS.md`。  
**本文边界**: 本文规划并记录 Phase 6-7 的落地范围；最终已验收结果同步写入 `docs/PROJECT_PROGRESS.md`。

---

## 0. Implementation Status

2026-04-26 已完成 Phase 6-7 主线落地：

1. P6 `CompanyLoopPolicy` / `CompanyLoopRun` / `CompanyLoopDigest` 已进入 Company Kernel、SQLite schema、API、control-plane 懒加载 route、Scheduler 内置 cron、CEO Office、Ops 和 Settings。
2. P6 loop selector 已执行 Top-N 和 autonomous dispatch cap；高风险 dispatch 与 approval agenda 只进 digest，不会自动批准或自动派发。
3. P6 Settings `Autonomy 预算` 已支持 organization budget、department default budget、loop enabled、daily hour、weekly day/hour、Top-N、dispatch cap、allowed actions 与 growth review。
4. P7 `SystemImprovementSignal` / `SystemImprovementProposal` / `ProtectedCorePolicy` 已进入 Company Kernel、SQLite schema、API、approval callback、CEO Office 和 Ops。
5. P7 risk/planner/approval/observer 已形成 proposal-ready 闭环：可生成 signal/proposal、风险分级、测试计划、回滚计划、审批请求、测试证据和 observing 状态。
6. P7 第一版未提供 auto branch / auto commit / auto push / auto merge / auto deploy API；protected core 仍由人工审批和普通开发流程控制。
7. 验收补丁已修正 digest-only selected item 可能突破 `maxAgendaPerDailyLoop` 的边界，并新增回归测试。
8. Review 收口补丁已闭合 P6/P7 剩余断点：scheduler 内置 daily/weekly cron 由 `CompanyLoopPolicy` 的时间、时区和 enabled 状态驱动；`CompanyLoopRun.metadata.skippedAgenda` 持久化每个 skipped item 的结构化原因；`notificationChannels` 的 web/email/webhook 都会产生可追踪 delivery event，webhook 在配置 `COMPANY_LOOP_WEBHOOK_URL` 或 `AG_COMPANY_LOOP_WEBHOOK_URL` 后异步投递，email 可通过 `COMPANY_LOOP_EMAIL_WEBHOOK_URL` 或 `AG_COMPANY_LOOP_EMAIL_WEBHOOK_URL` 接入外部邮件投递器；CEO Office 可 pause/resume autonomous loop；Ops Self Improvement 卡片展示 evidence、test evidence、rollback plan、approval 和 affected files。
9. P7 审批边界已补强：high/critical `SystemImprovementProposal` 即使追加 passed test evidence，也不会在未审批前进入 `ready-to-merge`；审批会写入持久 `metadata.approvalStatus/approvedAt`，后续 failed -> passed 测试修复路径可正常恢复到 `ready-to-merge`。

---

## 1. 当前判断

Phase 0-5 已经让系统具备自增长底座：

1. RunCapsule / MemoryCandidate / KnowledgeAsset / GrowthProposal 已形成闭环。
2. Signal / Agenda / OperatingDay 已能承载经营信号。
3. Budget / CircuitBreaker 已接入 scheduler、agenda、manual dispatch 和 growth proposal。
4. Crystallizer 已能从 MemoryCandidate、KnowledgeAsset、repeated RunCapsule 生成 SOP / workflow / skill / script / rule proposal。
5. Publish / Approval / Dry-run / Observe 已具备第一版安全边界。

剩余主线不是继续堆单点能力，而是把这些能力组织成两个更高阶循环：

1. **Phase 6: Autonomous Company Loop v1**  
   让 AI 公司每天、每周按受控节奏观察、排序、少量派发、总结、沉淀，不产生后台风暴。

2. **Phase 7: Guarded Self-Improvement Mode**  
   让 AI CEO 能发现系统自身问题并提出改进 proposal，但核心代码变更必须经过风险分级、分支、测试、审批和回滚约束。

一句话：

> P6 让公司会稳定自运营；P7 让公司会安全地改进自己。

---

## 2. 非目标

P6-P7 明确不做：

1. 不做无限自治循环。
2. 不做自动修改主分支核心代码。
3. 不做启动时全库扫描写入。
4. 不恢复 5 秒全量查询或高频后台轮询。
5. 不让 scheduler / worker 在 web 壳层无条件启动。
6. 不把 Antigravity IDE / Language Server 逻辑改成通用逻辑。
7. 不把每次任务结果都写成文档。
8. 不让 AI 绕过 Approval、Budget、CircuitBreaker、Dry-run。
9. 不把 Provider、Execution Target、Runtime Profile 再拆成重复配置入口。

---

## 3. 总体路线

```text
P0-P5 已完成
  RunCapsule / Memory / Signal / Agenda / Budget / Crystallizer

P6 Autonomous Company Loop
  LoopPolicy -> LoopRun -> AgendaSelection -> BudgetedDispatch -> Daily/Weekly Report -> Growth Review

P7 Guarded Self-Improvement
  SystemSignal -> ImprovementProposal -> RiskPlan -> Branch/Task -> TestEvidence -> Approval -> Publish/Observe
```

### 3.1 P6 和 P7 的关系

P6 是运营循环，默认可以只处理普通业务任务、routine、知识增长和风险拦截。

P7 是系统改进循环，默认不能自动执行核心代码变更，只能生成 proposal。P7 依赖 P6 的 OperatingDay、Agenda、Budget、Approval 和 Observation 能力。

---

## 4. Phase 6: Autonomous Company Loop v1

### 4.1 目标

建立一个可解释、可暂停、可预算、可观察的 AI 公司日常运营循环：

1. 每日固定时间生成 CompanyOperatingDay。
2. 从 active signals / agenda 中选择 Top-N，而不是全量执行。
3. 对 routine、风险、知识候选、增长提案进行有限处理。
4. 将结果推送到 CEO Office / 后台消息 / 邮件体系。
5. 每周做一次能力增长和风险复盘。

P6 的关键不是“自动做更多”，而是“每天稳定做少量正确的事”。

### 4.2 核心对象

#### CompanyLoopPolicy

```ts
export interface CompanyLoopPolicy {
  id: string;
  scope: 'organization' | 'department';
  scopeId?: string;
  enabled: boolean;
  timezone: string;
  dailyReviewHour: number;
  weeklyReviewDay: number;
  weeklyReviewHour: number;
  maxAgendaPerDailyLoop: number;
  maxAutonomousDispatchesPerLoop: number;
  allowedAgendaActions: Array<'observe' | 'dispatch' | 'approve' | 'snooze' | 'dismiss'>;
  growthReviewEnabled: boolean;
  notificationChannels: Array<'web' | 'email' | 'webhook'>;
  createdAt: string;
  updatedAt: string;
}
```

#### CompanyLoopRun

```ts
export interface CompanyLoopRun {
  id: string;
  policyId: string;
  kind: 'daily-review' | 'weekly-review' | 'growth-review' | 'risk-review';
  status: 'running' | 'completed' | 'skipped' | 'failed';
  date: string;
  timezone: string;
  selectedAgendaIds: string[];
  dispatchedRunIds: string[];
  generatedProposalIds: string[];
  notificationIds: string[];
  budgetLedgerIds: string[];
  summary: string;
  skipReason?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  metadata?: Record<string, unknown>;
}
```

#### CompanyLoopDigest

```ts
export interface CompanyLoopDigest {
  id: string;
  loopRunId: string;
  date: string;
  title: string;
  operatingSummary: string;
  decisionsNeeded: string[];
  risksBlocked: string[];
  departmentHighlights: string[];
  capabilityGrowth: string[];
  budgetSummary: string[];
  linkedAgendaIds: string[];
  linkedRunIds: string[];
  linkedProposalIds: string[];
  createdAt: string;
}
```

### 4.3 模块设计

新增：

```text
src/lib/company-kernel/company-loop-policy.ts
src/lib/company-kernel/company-loop-run-store.ts
src/lib/company-kernel/company-loop-selector.ts
src/lib/company-kernel/company-loop-executor.ts
src/lib/company-kernel/company-loop-digest.ts
src/lib/company-kernel/company-loop-notifier.ts
```

职责：

1. `company-loop-policy.ts`
   - 默认 daily / weekly loop policy。
   - policy CRUD。
   - enable / pause。

2. `company-loop-run-store.ts`
   - 记录每次 loop run。
   - 提供分页查询。
   - 支持按 date / kind / status 查询。

3. `company-loop-selector.ts`
   - 从 agenda 中选择 Top-N。
   - 排除 dismissed / completed / snoozed。
   - 排除 budget blocked / circuit open。
   - 按 priority、score、age、risk、cost 排序。

4. `company-loop-executor.ts`
   - 执行 daily / weekly / growth review。
   - 对每个 agenda 做 dispatch-check。
   - 只对允许动作执行，其他写入 digest。
   - 所有 dispatch 走现有 budget gate。

5. `company-loop-digest.ts`
   - 从 OperatingDay、Agenda、BudgetLedger、GrowthProposal 聚合 digest。
   - 生成 CEO 可读摘要，不替代结构化数据。

6. `company-loop-notifier.ts`
   - 复用现有 approval / notification / digest 推送能力。
   - 只推送 loop digest，不绕过订阅系统。

### 4.4 SQLite 表

```sql
CREATE TABLE IF NOT EXISTS company_loop_policies (
  policy_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT,
  enabled INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_loop_policies_scope
ON company_loop_policies(scope, scope_id);

CREATE TABLE IF NOT EXISTS company_loop_runs (
  loop_run_id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_company_loop_runs_date ON company_loop_runs(date);
CREATE INDEX IF NOT EXISTS idx_company_loop_runs_kind ON company_loop_runs(kind);
CREATE INDEX IF NOT EXISTS idx_company_loop_runs_status ON company_loop_runs(status);

CREATE TABLE IF NOT EXISTS company_loop_digests (
  digest_id TEXT PRIMARY KEY,
  loop_run_id TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_company_loop_digests_date ON company_loop_digests(date);
```

### 4.5 Loop 选择算法

输入：

1. `CompanyOperatingDay`
2. active agenda
3. budget policies
4. circuit breakers
5. loop policy

输出：

1. selected agenda
2. skipped reasons
3. dispatch candidates
4. digest-only items

排序公式：

```text
loopSelectionScore =
  agenda.score * 0.45
  + priorityWeight * 0.20
  + ageWeight * 0.10
  + actionWeight * 0.10
  - riskPenalty * 0.10
  - costPenalty * 0.05
```

硬规则：

1. `maxAgendaPerDailyLoop` 默认 5。
2. `maxAutonomousDispatchesPerLoop` 默认 1。
3. `risk >= high` 不自动 dispatch，只进入 digest / approval。
4. `recommendedAction=approve` 不自动批准，只生成决策项。
5. `dispatch-check` 不通过的 agenda 进入 skipped summary。
6. 同一个 `dedupeKey` 当天只处理一次。
7. loop run 必须写 `CompanyLoopRun`，即使 skipped。

### 4.6 Scheduler 接入

新增两类内置 job：

1. `company-daily-loop`
   - 默认每天北京时间 20:05。
   - 在 AI 日报 job 之后执行，避免抢日报生成资源。

2. `company-weekly-review`
   - 默认每周五北京时间 20:30。
   - 只做复盘和 proposal review，不自动大规模派发。

实现要求：

1. 内置 job 不创建 5 秒 interval。
2. scheduler loop 不因 P6 新增第二套 worker。
3. 只在 `AG_ROLE=api` 或明确 scheduler runtime 中运行。
4. web 壳层只读 loop status，不初始化执行器。
5. 手动 Run Now 走同一条 `company-loop-executor`。

### 4.7 API

新增：

```text
GET /api/company/loops/policies
PUT /api/company/loops/policies/:id
GET /api/company/loops/runs
GET /api/company/loops/runs/:id
POST /api/company/loops/run-now
GET /api/company/loops/digests
GET /api/company/loops/digests/:id
POST /api/company/loops/runs/:id/retry
```

要求：

1. 全部分页，默认 `pageSize=20`，最大 `pageSize=100`。
2. `run-now` 需要先检查 loop policy 是否 enabled。
3. `retry` 只能重试 failed / skipped loop run。
4. control-plane route 继续采用懒加载，避免主 server import 成本回升。
5. `AG_ROLE=web` 必须代理到 control-plane。

### 4.8 UI

#### CEO Office

新增：

1. 今日公司循环卡片：
   - daily loop status。
   - last run time。
   - selected agenda count。
   - dispatched count。
   - skipped count。
   - digest link。

2. 经营摘要区：
   - decisions needed。
   - risks blocked。
   - capability growth。
   - department highlights。

3. 手动按钮：
   - Run daily review now。
   - Run growth review now。
   - Pause autonomous loop。

原则：

1. 不堆解释文案。
2. 状态靠图标、数字、下钻表达。
3. 所有卡片都能下钻到 loop run / agenda / budget ledger。

#### Ops

新增：

1. Company Loops 列表。
2. Loop run timeline。
3. Skipped reason / budget reason。
4. Notification delivery state。
5. 内置 scheduler job 状态。

#### Settings

在 Autonomy 预算页下新增 Loop Policy 小节：

1. enable / pause。
2. daily review time。
3. weekly review time。
4. max agenda per loop。
5. max autonomous dispatches per loop。
6. allowed agenda actions。
7. notification channels。

### 4.9 测试清单

新增：

```text
src/lib/company-kernel/company-loop-policy.test.ts
src/lib/company-kernel/company-loop-selector.test.ts
src/lib/company-kernel/company-loop-executor.test.ts
src/app/api/company/loops/route.test.ts
src/lib/agents/scheduler-company-loop.test.ts
```

覆盖：

1. 默认 loop policy 创建。
2. disabled policy 不执行 loop。
3. Top-N agenda selection 稳定。
4. 高风险 agenda 不自动 dispatch。
5. budget blocked agenda 进入 skipped summary。
6. dispatch cap 生效。
7. loop run 成功写入 selected agenda / budget ledger / digest。
8. loop failed 写入 error 且不丢状态。
9. scheduler 到点只触发一次，不创建重复 job。
10. web role 代理 control-plane。
11. 测试使用临时 HOME / AG_GATEWAY_HOME，不污染真实库。

### 4.10 验收门

P6 完成必须满足：

1. 每日 loop 可以手动运行一次并产出 digest。
2. loop 最多 dispatch policy 允许的 Top-N，不全量执行。
3. Ops 能解释每个 skipped item 的原因。
4. CEO Office 能看到 loop 摘要和下钻。
5. build / vitest / tsc 通过。
6. 不启动第二套 scheduler / worker。
7. 不产生 5 秒 interval job。

---

## 5. Phase 7: Guarded Self-Improvement Mode

### 5.1 目标

让 AI CEO 能提出系统改进，但不能无约束修改核心系统。

P7 的正确形态：

```text
发现问题
-> 形成 SystemImprovementSignal
-> 生成 ImprovementProposal
-> 风险分级
-> 生成实施计划与测试计划
-> 人类审批
-> 分支执行
-> 测试证据
-> 合并 / 发布 / 观察
```

P7 的核心不是“自动写代码”，而是“让系统知道如何安全地组织一次系统改进”。

### 5.2 核心对象

#### SystemImprovementSignal

```ts
export interface SystemImprovementSignal {
  id: string;
  source: 'performance' | 'ux-breakpoint' | 'test-failure' | 'runtime-error' | 'manual-feedback' | 'duplicate-work' | 'architecture-risk';
  title: string;
  summary: string;
  evidenceRefs: EvidenceRef[];
  affectedAreas: Array<'frontend' | 'api' | 'runtime' | 'scheduler' | 'provider' | 'knowledge' | 'approval' | 'database' | 'docs'>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recurrence: number;
  estimatedBenefit: {
    latencyReductionMs?: number;
    failureReduction?: number;
    maintenanceSaving?: number;
    uxImpact?: number;
  };
  createdAt: string;
}
```

#### SystemImprovementProposal

```ts
export interface SystemImprovementProposal {
  id: string;
  status:
    | 'draft'
    | 'needs-evidence'
    | 'approval-required'
    | 'approved'
    | 'in-progress'
    | 'testing'
    | 'ready-to-merge'
    | 'published'
    | 'rejected'
    | 'rolled-back'
    | 'observing';
  title: string;
  summary: string;
  sourceSignalIds: string[];
  evidenceRefs: EvidenceRef[];
  affectedFiles: string[];
  protectedAreas: string[];
  risk: 'low' | 'medium' | 'high' | 'critical';
  implementationPlan: string[];
  testPlan: string[];
  rollbackPlan: string[];
  branchName?: string;
  approvalRequestId?: string;
  linkedRunIds: string[];
  testEvidence: Array<{
    command: string;
    status: 'passed' | 'failed';
    outputSummary: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}
```

#### ProtectedCorePolicy

```ts
export interface ProtectedCorePolicy {
  id: string;
  protectedGlobs: string[];
  criticalGlobs: string[];
  requiresApprovalFor: Array<'database' | 'scheduler' | 'approval' | 'provider' | 'memory' | 'runtime' | 'security'>;
  maxFilesWithoutApproval: number;
  requireBranch: boolean;
  requireTests: boolean;
  requireRollbackPlan: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### 5.3 模块设计

新增：

```text
src/lib/company-kernel/self-improvement-signal.ts
src/lib/company-kernel/self-improvement-store.ts
src/lib/company-kernel/self-improvement-planner.ts
src/lib/company-kernel/self-improvement-risk.ts
src/lib/company-kernel/self-improvement-approval.ts
src/lib/company-kernel/self-improvement-observer.ts
```

职责：

1. `self-improvement-signal.ts`
   - 从 performance、runtime error、test failure、manual feedback 生成 signal。
   - 复用 EvidenceRef。

2. `self-improvement-store.ts`
   - proposal CRUD。
   - 分页查询。
   - status transition。

3. `self-improvement-planner.ts`
   - 将 signal 转成 proposal。
   - 生成 implementationPlan / testPlan / rollbackPlan。
   - 不直接修改代码。

4. `self-improvement-risk.ts`
   - 基于 affected files 和 protected policy 计算风险。
   - scheduler / provider / database / approval / memory / runtime 默认 high。

5. `self-improvement-approval.ts`
   - 高风险 proposal 创建 approval request。
   - approval callback 只改变 proposal 状态，不直接合并代码。

6. `self-improvement-observer.ts`
   - 发布后观察延迟、错误率、测试稳定性、用户反馈。

### 5.4 数据表

```sql
CREATE TABLE IF NOT EXISTS system_improvement_signals (
  signal_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  severity TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_improvement_signals_source
ON system_improvement_signals(source);

CREATE INDEX IF NOT EXISTS idx_system_improvement_signals_severity
ON system_improvement_signals(severity);

CREATE TABLE IF NOT EXISTS system_improvement_proposals (
  proposal_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  risk TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_improvement_proposals_status
ON system_improvement_proposals(status);

CREATE INDEX IF NOT EXISTS idx_system_improvement_proposals_risk
ON system_improvement_proposals(risk);
```

### 5.5 信号来源

第一版只接低风险、可解释来源：

1. **Performance**
   - 慢 API。
   - 响应体过大。
   - 高频轮询。
   - build / test import 成本异常。

2. **Runtime Error**
   - scheduler failed。
   - provider unavailable。
   - control-plane proxy failed。
   - JS runtime error。

3. **Test Failure**
   - vitest failed。
   - build failed。
   - lint failed。

4. **UX Breakpoint**
   - 页面缺数据。
   - 用户旅程断点。
   - 重复配置概念。

5. **Manual Feedback**
   - CEO 手动提交“这个设计不合理”。
   - 用户明确要求系统改进。

P7 不接入：

1. 自动扫描全部代码并生成大量 proposal。
2. 自动抓取外部依赖更新并改代码。
3. 自动在生产环境运行破坏性脚本。

### 5.6 风险分级

默认规则：

| 风险 | 条件 | 处理 |
|---|---|---|
| low | 文案、纯 docs、非核心 UI 小改 | 可生成 proposal，不自动执行 |
| medium | 普通 UI、非核心 API、局部数据展示 | 需要测试计划，可申请执行 |
| high | scheduler、provider、budget、approval、memory、database、runtime | 必须审批、必须测试、必须回滚计划 |
| critical | 删除数据、迁移真实 DB、后台 worker、权限、外部发送、核心代码自改 | 默认只生成 proposal，人工明确授权后才进入执行 |

受保护区域：

```text
src/lib/agents/scheduler.ts
src/server/workers/*
src/lib/company-kernel/budget-*
src/lib/company-kernel/circuit-breaker.ts
src/lib/company-kernel/memory-*
src/lib/company-kernel/*promotion*
src/lib/approval/*
src/lib/providers/*
src/lib/storage/*
src/app/api/company/*
server.ts
middleware.ts
```

### 5.7 API

新增：

```text
GET /api/company/self-improvement/signals
POST /api/company/self-improvement/signals
GET /api/company/self-improvement/proposals
POST /api/company/self-improvement/proposals/generate
GET /api/company/self-improvement/proposals/:id
POST /api/company/self-improvement/proposals/:id/evaluate
POST /api/company/self-improvement/proposals/:id/approve
POST /api/company/self-improvement/proposals/:id/reject
POST /api/company/self-improvement/proposals/:id/attach-test-evidence
POST /api/company/self-improvement/proposals/:id/observe
```

第一版不做：

1. 不提供自动 merge API。
2. 不提供自动 push API。
3. 不提供自动部署 API。

如果后续要做，必须另写 RFC。

### 5.8 UI

#### CEO Office

新增轻量入口：

1. System Improvement Signals。
2. High-risk improvement proposal count。
3. Needs approval。
4. Ready for testing。

CEO Office 只显示摘要，不展示完整代码计划。

#### Ops

新增系统改进工作面：

1. Signals 列表。
2. Proposal 列表。
3. 风险等级。
4. affected files。
5. test evidence。
6. rollback plan。
7. approval status。

#### Knowledge

系统改进后的 SOP / rule / known issue 可以进入 Knowledge，但不能把未验证的猜测晋升为长期知识。

### 5.9 执行边界

P7 第一版只允许到 “proposal ready”：

1. 可以生成 proposal。
2. 可以生成测试计划。
3. 可以创建 approval。
4. 可以记录测试证据。
5. 可以记录分支名和 runId。

不允许：

1. 自动创建 git branch。
2. 自动 commit。
3. 自动 push。
4. 自动 merge。
5. 自动修改 protected core。

如果用户明确要求 AI 执行某个 approved proposal，才进入普通开发流程，且仍要遵守现有 AGENTS 规则：测试、文档同步、进程回收、PROJECT_PROGRESS 只记录已验证结果。

### 5.10 测试清单

新增：

```text
src/lib/company-kernel/self-improvement-risk.test.ts
src/lib/company-kernel/self-improvement-planner.test.ts
src/lib/company-kernel/self-improvement-store.test.ts
src/app/api/company/self-improvement/route.test.ts
```

覆盖：

1. protected file -> high risk。
2. database / scheduler / provider -> high risk。
3. docs-only -> low risk。
4. missing evidence -> needs-evidence。
5. high risk proposal -> approval-required。
6. attach test evidence 后状态进入 testing / ready-to-merge。
7. rejected proposal 不能发布。
8. API 分页有效。
9. 测试不写真实 HOME。

### 5.11 验收门

P7 完成必须满足：

1. 能从慢接口、失败测试或用户反馈生成 improvement signal。
2. 能把 signal 生成 proposal。
3. proposal 包含 affectedFiles、risk、implementationPlan、testPlan、rollbackPlan。
4. high / critical proposal 必须创建 approval request。
5. 不存在自动 merge / push / deploy 入口。
6. Ops 可以查看 proposal 证据和状态。
7. build / vitest / tsc 通过。

---

## 6. Sidecar Hardening

P6-P7 之外还需要三个收尾项，但不应混入主线：

### 6.1 长期运行样本

目标：

1. 跑 7 天 company loop 样本。
2. 观察 scheduler 是否重复启动。
3. 观察 budget ledger 是否可解释。
4. 观察 workflow / skill 命中率。

产物：

1. `docs/research/company-loop-7-day-observation-*.md`
2. 指标表：
   - loop run count
   - skipped count
   - dispatch count
   - budget blocked count
   - proposal generated count
   - workflow hit count
   - errors

### 6.2 Budget / CircuitBreaker 导出

目标：

1. 支持 CSV / JSON 导出。
2. 用于运营审计，不影响执行 gate。

API：

```text
GET /api/company/budget/ledger/export
GET /api/company/circuit-breakers/export
```

第一版可以只做 JSON。

### 6.3 单部门专属预算编辑

当前 Settings 已支持组织级和部门默认预算。后续可补：

1. 选择部门。
2. 显示是否继承默认。
3. 创建专属 override。
4. 删除 override 回到默认。

不阻塞 P6-P7。

---

## 7. 实施顺序

### Milestone 6.1: Loop Policy / Run Store

文件：

```text
src/lib/company-kernel/company-loop-policy.ts
src/lib/company-kernel/company-loop-run-store.ts
src/lib/company-kernel/contracts.ts
src/lib/types.ts
```

交付：

1. CompanyLoopPolicy。
2. CompanyLoopRun。
3. CompanyLoopDigest。
4. SQLite schema。
5. store tests。

验收：

1. 默认 policy 可创建。
2. loop run 可写入和分页查询。
3. 不污染真实 DB。

### Milestone 6.2: Selector / Executor

文件：

```text
src/lib/company-kernel/company-loop-selector.ts
src/lib/company-kernel/company-loop-executor.ts
src/lib/company-kernel/budget-gate.ts
src/lib/company-kernel/agenda-store.ts
```

交付：

1. Top-N agenda selector。
2. dispatch cap。
3. budget skipped reason。
4. loop result summary。

验收：

1. 高风险不自动 dispatch。
2. budget blocked 写 skipped。
3. dispatch cap 生效。

### Milestone 6.3: API / Control Plane

文件：

```text
src/app/api/company/loops/*
src/server/control-plane/company-routes.ts
src/lib/api.ts
docs/guide/gateway-api.md
docs/guide/cli-api-reference.md
```

交付：

1. loop policy API。
2. loop run API。
3. run-now API。
4. control-plane 懒加载 route。

验收：

1. web role proxy 通过。
2. API 分页有效。
3. route test 不回到 5s 超时线。

### Milestone 6.4: Scheduler / Notification

文件：

```text
src/lib/agents/scheduler.ts
src/lib/agents/scheduler-types.ts
src/lib/company-kernel/company-loop-notifier.ts
```

交付：

1. daily loop scheduler action。
2. weekly review scheduler action。
3. notification dispatch。
4. no duplicate worker guard。

验收：

1. 手动 trigger 能跑。
2. 到点只跑一次。
3. 不新增 5s interval。

### Milestone 6.5: CEO Office / Ops / Settings UI

文件：

```text
src/components/ceo-office-cockpit.tsx
src/components/scheduler-panel.tsx
src/components/settings-panel.tsx
src/components/ui/company-loop-*.tsx
```

交付：

1. CEO Office loop card。
2. Ops loop runs。
3. Settings loop policy。
4. 尽量抽公共组件，避免继续膨胀巨型页面。

验收：

1. 无大段设计说明文案。
2. 数据来自真实 API。
3. bb-browser / API smoke 无 JS error。

### Milestone 7.1: Self Improvement Contracts / Store

文件：

```text
src/lib/company-kernel/self-improvement-*.ts
src/lib/company-kernel/contracts.ts
src/lib/types.ts
```

交付：

1. SystemImprovementSignal。
2. SystemImprovementProposal。
3. ProtectedCorePolicy。
4. store tests。

验收：

1. CRUD / pagination 通过。
2. status transition 稳定。

### Milestone 7.2: Risk / Planner

交付：

1. risk classifier。
2. proposal generator。
3. implementation/test/rollback plan generator。
4. evidence required gate。

验收：

1. protected files -> high risk。
2. no evidence -> needs-evidence。
3. docs-only -> low risk。

### Milestone 7.3: API / Approval / UI

交付：

1. self-improvement API。
2. approval integration。
3. Ops proposal view。
4. CEO Office summary card。

验收：

1. high risk proposal 创建 approval request。
2. UI 可查看 evidence / risk / test plan。
3. 没有 auto merge / push API。

---

## 8. 验证矩阵

每个 milestone 必跑：

```bash
npx eslint <changed-files>
npx vitest run <target-tests>
npx tsc --noEmit --pretty false
npm run build
```

涉及页面时追加：

```text
bb-browser 打开 http://127.0.0.1:3000/
检查 JS errors
检查目标 API 200
```

涉及 scheduler 时追加：

1. 不同时启动多套服务。
2. 优先复用既有 `localhost:3000`。
3. 不新建 5s interval job。
4. 测试结束确认 `vitest` / `next build` / 临时 node 进程已退出。

涉及数据库时追加：

1. 测试设置临时 `HOME` / `AG_GATEWAY_HOME`。
2. 不写真实 `~/.gemini/antigravity`。
3. 测试后删除临时目录。

---

## 9. 完成定义

P6 完成定义：

1. AI 公司每日 loop 可以稳定运行一次。
2. loop run 有结构化记录和 digest。
3. CEO Office / Ops / Settings 都有对应入口。
4. loop 所有 dispatch 都经过 budget / circuit breaker。
5. 没有后台风暴和重复 scheduler。

P7 完成定义：

1. 系统可以生成自我改进 proposal。
2. high / critical proposal 必须审批。
3. proposal 必须包含测试和回滚计划。
4. 没有自动改核心代码、自动 merge、自动 push。
5. Ops 能审计 proposal 生命周期。

总体完成定义：

1. P6-P7 与 P0-P5 共享同一套 EvidenceRef、Budget、Approval、Agenda。
2. UI 不伪造经营数据。
3. 文档、API、用户指南同步。
4. 测试和 build 全部通过。
5. `PROJECT_PROGRESS.md` 只在功能落地并通过验证后更新。

---

## 10. 验收记录

2026-04-26 本轮最终验收通过：

```bash
npx eslint src/lib/company-kernel src/app/api/company src/lib/agents/scheduler.ts src/lib/agents/scheduler-types.ts src/lib/agents/scheduler-company-loop.test.ts src/components/ceo-office-cockpit.tsx src/components/scheduler-panel.tsx src/components/settings-panel.tsx src/lib/api.ts src/lib/types.ts src/server/control-plane/company-routes.ts
```

```bash
npx vitest run src/lib/company-kernel src/app/api/company src/lib/agents/scheduler-company-loop.test.ts src/lib/agents/scheduler.test.ts src/server/control-plane/server.test.ts
```

结果：`13 files passed`，`71 tests passed`；`src/server/control-plane/server.test.ts` 约 `466ms`。

```bash
npx tsc --noEmit --pretty false
```

结果：类型检查通过。

```bash
npm run build
```

结果：生产构建成功，`/api/company/loops/*` 与 `/api/company/self-improvement/*` 均进入 Next route table。

真实 smoke：

1. 复用既有 `localhost:3000` 检查发现该进程 route manifest 未刷新，`/api/company/self-improvement/proposals` 仍返回 404；代码和 build 已包含 route，需重启既有服务后生效。
2. 启动隔离 `localhost:3999` smoke 服务，显式设置 `AG_ENABLE_SCHEDULER=0`、`AG_ENABLE_SCHEDULER_COMPANIONS=0`、`AG_DISABLE_BRIDGE_WORKER=1`，验证后已回收。
3. `GET http://127.0.0.1:3999/api/company/loops/runs?pageSize=1` 返回 `200`，约 `0.402s`。
4. `GET http://127.0.0.1:3999/api/company/self-improvement/proposals?pageSize=1` 返回 `200`，约 `0.410s`。
5. `GET http://127.0.0.1:3999/` 返回 `200`，约 `0.414s`。
6. `bb-browser` 打开 `http://127.0.0.1:3999/` 后 `errors --clear` 未发现新增 JS error。

进程确认：

1. 临时 `:3999` smoke 服务已停止，端口已释放。
2. 本轮没有新增 5s interval job，没有启动第二套 scheduler/worker。
3. 现有 `:3000` PID 93261 是本轮前已存在的服务，未被本轮重启或回收。

### 11.2 Review hardening verification

2026-04-26 追加修复 6 个 review finding 后，已验证：

1. `LoopPolicy` 的 `dailyReviewHour`、`weeklyReviewDay`、`weeklyReviewHour`、`timezone`、`enabled` 会驱动 scheduler 内置 daily/weekly company-loop cron。
2. `attachSystemImprovementTestEvidence` 不再允许 high/critical proposal 通过 passed test evidence 绕过 approval；审批状态持久化到 metadata 后，已审批 proposal 即使先追加 failed evidence，后续最新 passed evidence 也能推进到 `ready-to-merge`。
3. `CompanyLoopRun.metadata.skippedAgenda` 会持久化 digest-only、budget-blocked、no-target-workspace、growth-budget-blocked 等 skipped 明细。
4. `notificationChannels` 中的 `web`、`email`、`webhook` 均会产生 channel-specific notification id；webhook 配置 URL 后异步 POST digest payload。
5. Ops Self Improvement 卡片展示 proposal evidence/test/rollback/approval/affected files；CEO Office 提供 pause/resume loop policy。

验证命令：

```bash
npx eslint src/lib/agents/scheduler.ts src/lib/company-kernel/self-improvement-store.ts src/lib/company-kernel/company-loop-executor.ts src/lib/company-kernel/company-loop-notifier.ts src/components/settings-panel.tsx src/components/ceo-office-cockpit.tsx src/components/scheduler-panel.tsx 'src/app/api/company/loops/policies/[id]/route.ts' src/lib/agents/scheduler-company-loop.test.ts src/lib/company-kernel/company-loop.test.ts src/lib/company-kernel/self-improvement.test.ts
```

```bash
npx vitest run src/lib/agents/scheduler-company-loop.test.ts src/lib/company-kernel/company-loop.test.ts src/lib/company-kernel/self-improvement.test.ts src/app/api/company/loops-self-improvement.route.test.ts src/server/control-plane/server.test.ts
```

结果：`5 files passed`，`15 tests passed`。

```bash
npx tsc --noEmit --pretty false
```

结果：类型检查通过。

```bash
npm run build
```

结果：生产构建成功。

### 11.3 Self-improvement approval recovery hardening

2026-04-26 追加修复 high/critical 自改 proposal 的审批与测试证据状态机：

1. `approveSystemImprovementProposal` 会将审批事实写入 `metadata.approvalStatus`、`metadata.approvedAt`、`metadata.approvedBy`。
2. `attachSystemImprovementTestEvidence` 以最新 test evidence 决定当前测试态，历史 evidence 继续作为审计记录保留。
3. high/critical proposal 未审批时，passed evidence 仍不能进入 `ready-to-merge`。
4. 已审批 high/critical proposal 若先追加 failed evidence，后续最新 passed evidence 可恢复到 `ready-to-merge`。

验证命令：

```bash
npx eslint src/lib/company-kernel/self-improvement-store.ts src/lib/company-kernel/self-improvement-approval.ts src/lib/company-kernel/self-improvement.test.ts
```

```bash
npx vitest run src/lib/company-kernel/self-improvement.test.ts
```

结果：`1 file passed`，`5 tests passed`。

```bash
npx vitest run src/lib/agents/scheduler-company-loop.test.ts src/lib/company-kernel/company-loop.test.ts src/lib/company-kernel/self-improvement.test.ts src/app/api/company/loops-self-improvement.route.test.ts src/server/control-plane/server.test.ts
```

结果：`5 files passed`，`16 tests passed`；`src/server/control-plane/server.test.ts` 约 `806ms`。

```bash
npx tsc --noEmit --pretty false
```

结果：类型检查通过。

```bash
npm run build
```

结果：生产构建成功，`/api/company/self-improvement/*` route table 保持完整。
