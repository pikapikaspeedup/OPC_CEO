# Scheduler & CEO Command Convergence RFC（2026-05-10）

> **状态**：调研结论 + 推荐方案。等用户决策后入"第 1 档"执行 / 或下放"第 3 档"暂缓。
> **关联**：[Architecture Review T5-2](./architecture-review-2026-05-09.md#第-2-档调研中待-rfc-决策)
>
> **核心要回答**：
> > "今天系统跑的事 / 用户下的指令，能不能 100% 知道走的哪条路？"
>
> **结论先行**：当前**做不到**。用户从下达指令到看到落地需要跨 3 个面板查；自主决策与手动决策无法区分；4 张表的留痕没有统一视图。推荐**方案 B（DecisionDispatch 中间层 + decision_dispatch_log 表 + 决策追踪 UI）**，~ 200-300 LOC，2-3 周。

---

## 一、现状摸底（事实基础）

### 1. Scheduler 双入口

| 入口 | 文件 | 触发方式 | 落地表 | 审计事件 |
|------|------|---------|--------|---------|
| **A. `/api/scheduler/jobs`** | `src/app/api/scheduler/jobs/route.ts` | 用户主动 POST | `scheduled_jobs`（gateway-db 内存 Map）| `appendAuditEvent({ kind: 'scheduler:created' })` → ops_audit_events |
| **B. `runCompanyLoop()`** | `src/lib/company-kernel/company-loop-executor.ts` | 既被 A 中 `action.kind='company-loop'` 的 job 触发，也被 `/api/company/ceo/decisions` GET 时 `syncAllActiveSystemImprovementProposals()` 触发 | `company_loop_runs` + `company_loop_digests` + `operating_agenda_items` + `operating_signals` | `appendCEOEvent({ kind: 'scheduler' })` → ceo_events |

**关键发现**：
- 两个入口**不共享**任何表
- 两套**完全不同的审计事件流**：scheduler 走 ops_audit；company-loop 走 ceo_events
- 唯一连接点：scheduler.ts 第 768 行 `runCompanyLoop({ kind, source: 'scheduler' })` —— 一根细绳连接两条路

### 2. CEO 三决策入口

| UI 入口 | 调用 API | 底层函数 | 数据来源 |
|---------|---------|---------|---------|
| `ceo-dashboard.tsx` | `GET /api/company/ceo/decisions?limit=50` | `listCEODecisionItems(limit)` | `system_improvement_proposals` + `projects.stage.gateApproval` |
| `ceo-office-cockpit.tsx` (82KB) | 无独立 chat 指令入口；增强展示同样 DecisionItemView | 同上 | 同上 |
| `/api/ceo/routine` | 代理至 control-plane 的 `handleCEORoutineGet()` | 自动定时任务（BUILT_IN_COMPANY_DAILY_LOOP_ID）| 不产生面向 CEO 的决策项 |

**关键发现**：
- 三个 UI 入口**最终都从同一个 API 拉数据**（DecisionItemView），但**下达**指令的路径分散在不同组件
- `/api/ceo/routine` 严格说不是"决策面板"，是定时例行任务

### 3. 审计闭环（用户视角）

CEO 下达一条指令（譬如"加一个每周日报"），完整留痕路径：

```
1. 前端 POST /api/scheduler/jobs
2. createScheduledJob() 写 scheduled_jobs 内存 Map
3. persistScheduledJob() 写 SQLite
4. appendAuditEvent({ kind: 'scheduler:created' }) → ops_audit_events
5. appendCEOEvent({ kind: 'scheduler' }) → ceo_events
6. 若涉及议程：observeScheduledJobForAgenda()
   → upsertOperatingSignal() → operating_signals
   → upsertOperatingAgendaItem() → operating_agenda_items
```

**4 张表**：`scheduled_jobs` / `ops_audit_events` / `ceo_events` / `operating_signals` & `operating_agenda_items`

**反查难度**：用户问"我刚才下的指令呢"需要：
1. Scheduler Panel → `GET /api/scheduler/jobs` 看任务列表
2. CEO Dashboard → `GET /api/company/ceo/decisions` 看是否产生了议程
3. Ops Audit / CEO Event Store → 检查事件日志（**无前端入口直接暴露**）

→ **3 层跨面板跳跃 + 1 处无 UI 死角**

### 4. 自主决策可见性盲区

- `system_improvement_proposals` 自动生成 → CEO Dashboard 通过 `buildSystemImprovementDecision()` 能看到 ✅
- `company-loop` 自动触发的议程 → 落到 `operating_agenda_items` 表，**前端无独立看板** ❌
- CEO Dashboard 只展示 `controlState.currentOwner === 'ceo'` 的待决策项；`agenda_items` 完整列表视图缺失

---

## 二、痛点确认

| 痛点 | 程度 | 证据 |
|------|------|------|
| 用户下达的指令最终落到哪 | 🔴 高 | 跨 4 张表 + 3 个面板，反查困难 |
| 区分自主 vs 手动触发 | 🔴 高 | `company-loop` 议程项无 source 字段；scheduler vs 手动调用语义混淆 |
| 跨入口统一审计 | 🟡 中 | 两套独立事件流（ops_audit vs ceo_events），无 join 关系 |
| 面板分散 | 🟡 中 | CEO chat / dashboard / cockpit / scheduler-panel 4 个 UI，各自展示部分数据 |

**核心问题**：**下达不难，反查极难**。指令进入系统后变成"黑盒分裂"。

---

## 三、三方案对比

### 方案 A：选一条主线废弃另一条

| 子方案 | 迁移代价 | 副作用 |
|--------|---------|--------|
| 废弃 `/api/scheduler/jobs`，全走 company-loop | 🔴 高 | 需把所有 ScheduledJob 映射到 CompanyLoopRunKind / OperatingAgendaItem；前端 scheduler-panel 重写或下线；前向数据迁移 |
| 废弃 `runCompanyLoop()` 直接触发，保留 scheduler 唯一入口 | 🟡 中 | 改造 scheduler.ts 中的 company-loop action handler；company-loop-executor 降级为测试函数；行为语义变化 |

**评估**：A 子方案 1 需要数据迁移（高风险），子方案 2 改调用链（中等成本）。**两个子方案都不解决"反查难"的根本问题**——只是把问题从两套表合并成一套表。

### 方案 B：保留双入口 + DecisionDispatch 中间层 + 统一审计 ⭐ 推荐

**核心构造**：

```
                    ┌─── 用户指令（4 个 UI 入口）
                    │
                    ▼
          ┌────────────────────┐
          │ DecisionDispatch  │  ← 新增中间层
          │  (新文件 ~150 LOC) │
          └────────┬───────────┘
                   │ 同时 dispatch 到底层 + 写 decision_dispatch_log
        ┌──────────┼──────────────┐
        ▼          ▼              ▼
   scheduler.ts  company-loop  其他写路径
   (不动)        (不动)        (不动)
```

**新增数据结构**：
```ts
interface DecisionDispatchLog {
  id: string;
  source: 'scheduler-api' | 'company-loop-api' | 'ceo-manual' | 'self-improvement-auto' | 'company-loop-auto';
  sourceId?: string;          // 用户 ID / job ID
  targetKind: 'scheduled-job' | 'agenda-item' | 'system-improvement-proposal' | 'project-gate';
  targetId: string;
  status: 'dispatched' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
}
```

新表 `decision_dispatch_log`，支持按 sourceId / targetId / 时间窗反查。

**新增 API**：
- `GET /api/decisions/audit-trail?correlationId=X` —— 按指令 ID 反查全生命周期
- `GET /api/decisions/by-source?source=X&limit=N` —— 看某个入口最近下达的所有指令

**新增 UI**：
- `<DecisionAuditTrail>` 组件嵌入 CEO Dashboard 顶部
- "我刚下的指令" tab：按时间倒序显示用户最近 24 小时的所有指令 + 落地状态

**改动清单**：
| 文件 | 改动 |
|------|------|
| `src/lib/company-kernel/decision-dispatch.ts` | **新建**，~150 LOC，封装 `dispatchDecision()` |
| `src/lib/storage/gateway-db.ts` | **加表 + 加 4 个写函数**，~80 LOC |
| `src/app/api/scheduler/jobs/route.ts` | 调用 `dispatchDecision()` 替代直接 `createScheduledJob()`（保留向后兼容）| ~15 LOC |
| `src/lib/company-kernel/company-loop-executor.ts` | runCompanyLoop 内部产物落地时调 `dispatchDecision()` | ~20 LOC |
| `src/app/api/decisions/audit-trail/route.ts` | **新建** | ~40 LOC |
| `src/components/decision-audit-trail.tsx` | **新建** UI 组件 | ~150 LOC |
| `src/components/ceo-dashboard.tsx` | 嵌入 `<DecisionAuditTrail>` | ~10 LOC |

**总投入**：~465 LOC + 1 张表 + 2-3 周

### 方案 C：保持现状 + 文档化

只写一份 `docs/RUNTIME_FLOWS.md` 的扩展章节，明确"指令到 4 张表"的映射。

**评估**：解决"新人理解"，**不解决用户反查**。痛点 1 / 2 / 4 不动。

---

## 四、推荐：方案 B

### 理由

1. **A 不可行**：现有代码已深度耦合双入口（scheduler 内置任务强引用 company-loop），删任一端代价 > 收益
2. **B 直接解决核心痛点**：通过 `decision_dispatch_log` 透明化，"我下的指令呢" 1 个 API + 1 个 UI 解决
3. **B 不破坏现有结构**：scheduler.ts 与 company-loop-executor.ts 都不动；只在它们之上加薄壳
4. **B 顺带解决可观测性**：下一步 T3-2 的 distributed trace 可以基于 `dispatchId` 关联 → 与 RFC T3-2 共生
5. **C 治标不治本**：文档解决不了反查的体验问题

### 不做的代价

- 用户每问一次"我下的指令呢" → 跨 3 面板 + 1 个无 UI 表查
- CEO autonomous loop 跑得越多，自主 vs 手动指令的边界越模糊
- 下一次"指令丢了 / 重复执行了"故障定位 30 分钟起步

### 触发条件

- **现在做（推荐）**：CEO autonomous loop 已在跑，每天产生 N 条决策，下个月可能问"为什么这条没执行"
- **延后做**：单用户 / 低决策频次 / 不在意反查体验

---

## 五、实施路径（如果做）

**Week 1**：
- 实现 `decision-dispatch.ts` 中间层 + 数据 schema
- 改造 `/api/scheduler/jobs` 与 `runCompanyLoop` 调用点
- 单测覆盖 dispatch + 表写入

**Week 2**：
- 实现 `/api/decisions/audit-trail` API
- 写 `<DecisionAuditTrail>` 组件
- 嵌入 CEO Dashboard

**Week 3**：
- 走查 + 微调 + 文档

**验收标准**：
- 用户从 CEO Dashboard 看到"我下的指令"列表 → 点击任一条 → 看到完整生命周期（dispatched → 落地表 → 状态）
- 自主决策（自动生成的 self-improvement proposal）与手动决策在同一视图区分显示

---

## 六、风险与缓解

| 风险 | 缓解 |
|------|------|
| `decision_dispatch_log` 表膨胀 | 加 TTL（30 天）+ 归档 jsonl |
| 中间层引入性能损耗 | 写操作都是单条插入，benchmark 应在 <1ms |
| 现有调用方漏改 | 加 lint rule：禁止业务代码直接调 `createScheduledJob()`，必须经 `dispatchDecision()` |

---

## 七、决策选项

请用户选：

- **A**. 同意做 B 方案，加入第 1 档执行（~3 周投入）
- **B**. 暂时不做，转入第 3 档，等 CEO loop 跑出明显反查痛点再启动
- **C**. 只做最小子集（方案 B 中的 `decision_dispatch_log` + audit-trail API，不做 UI），1 周
- **D**. 其他想法

> 维护：本 RFC 是 2026-05-10 调研快照。如方案推进，进度写到 `docs/PROJECT_PROGRESS.md` 并反向引用本文 T5-2。
