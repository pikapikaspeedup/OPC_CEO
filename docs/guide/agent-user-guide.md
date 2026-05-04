# Agent System 使用指南

> Antigravity Gateway Multi-Agent 自治交付系统（当前版）
>
> 当前公共编排契约已经统一为 `templateId + stageId`。
> `groupId`、`/api/agent-groups`、scheduler `dispatch-group` 都不再是当前公共 API 的一部分。

---

## 1. 快速上手

### 方式一：CEO 命令

适合自然语言调度：

```bash
curl -X POST http://localhost:3000/api/ceo/command \
  -H "Content-Type: application/json" \
  -d '{"command":"每天工作日上午 9 点让研发部创建日报任务项目"}'
```

适用场景：

1. 创建定时任务
2. 让某个部门启动临时任务
3. 查询公司、项目、部门状态

### 方式二：直接派发 Run

适合明确知道要跑哪个模板：

```bash
curl -X POST http://localhost:3000/api/agent-runs \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "coding-basic-template",
    "workspace": "file:///Users/you/project",
    "prompt": "修复登录 token 刷新问题"
  }'
```

如果需要从模板里的指定阶段开始：

```bash
curl -X POST http://localhost:3000/api/agent-runs \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "development-template-1",
    "stageId": "product-spec",
    "workspace": "file:///Users/you/project",
    "prompt": "输出产品规格草案"
  }'
```

### 方式三：先建 Project 再编排

```bash
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Task Manager",
    "goal": "构建一个任务管理系统",
    "workspace": "file:///Users/you/project"
  }'
```

如果要把项目纳入平台工程部观察并允许自动提案，可以在创建时附带：

```json
{
  "governance": {
    "platformEngineering": {
      "observe": true,
      "allowProposal": true
    }
  }
}
```

Project 适合：

1. 多阶段交付
2. fan-out / join 并行编排
3. 需要审批、checkpoint、resume 的长链任务

### 方式四：桌面新建部门

普通浏览器不能可靠打开 macOS 原生文件夹选择器。当前桌面态通过 Tauri v2 提供本机目录选择能力：

```bash
npm run dev          # 启动 opc-api + opc-web
npm run desktop:dev  # 打开 Tauri 桌面壳，加载本机 3000
```

在 Tauri 桌面壳中：

1. 进入 CEO Office。
2. 点击“新建部门”。
3. 先选择一个主目录，系统调用 `/api/workspaces/import` 注册主 workspace。
4. 自动打开部门配置弹窗。
5. 在弹窗里继续补齐部门名称、类型、skills、OKR、运行偏好。
6. 如有需要，再为该部门继续绑定更多执行目录、上下文目录和潜在上下文文档。

这个流程不会启动 Antigravity，也不会触发 Language Server；它只是把目录加入 OPC workspace catalog。后续是否走 Antigravity / Codex Native / Codex CLI，仍由部门配置和执行 provider 决定。

补充说明：

1. Web 模式下不会再弹浏览器原生 `prompt`。
2. 当前改为产品内路径输入对话框。
3. 如果需要系统原生文件夹选择器，仍建议从 Tauri 桌面壳进入。

---

## 2. 核心对象

| 概念 | 说明 |
|------|------|
| `Template` | 顶层编排蓝图，定义 `pipeline[]` 或 `graphPipeline` |
| `Stage` | 模板中的执行阶段，直接内联 `executionMode`、`roles`、`sourceContract` |
| `Role` | 单个执行角色，绑定 workflow、timeout、review 行为 |
| `Workflow` | `assets/workflows/*.md` 下的角色指令脚本 |
| `Run` | 一次实际执行实例 |
| `RunCapsule` | Run 完成或关键状态变化后的结构化事实胶囊 |
| `MemoryCandidate` | 从 RunCapsule 生成的记忆候选，需显式晋升才进入长期知识 |
| `OperatingSignal` | 从 run / scheduler / knowledge / approval 派生的经营信号 |
| `OperatingAgendaItem` | CEO 可处理的经营议程，带推荐动作、优先级和预算状态 |
| `OperatingBudgetPolicy` | 组织/部门/scheduler/growth 的预算、并发和失败预算策略 |
| `CircuitBreaker` | 失败或风险过高时阻止继续 dispatch 的熔断器 |
| `GrowthProposal` | 从真实 run、知识和候选记忆沉淀出的 SOP / workflow / skill / script / rule 提案 |
| `CompanyLoopPolicy` | 控制 daily/weekly/growth/risk loop 的节奏、Top-N、dispatch cap 和通知渠道 |
| `CompanyLoopRun` / `CompanyLoopDigest` | 公司循环执行记录与 CEO 可读摘要 |
| `SystemImprovementSignal` | 性能、UX、测试失败、运行错误、用户反馈等系统改进信号 |
| `SystemImprovementProposal` | 带风险分级、实施计划、测试计划、回滚计划和审批状态的系统改进 proposal |
| `Project` | 多个 Run 的容器，承载 pipelineState、journal、checkpoint、deliverables |
| `Department` | 一个组织单元，可绑定一个或多个 workspace，带 provider、skills、token quota、执行目录编排和上下文文档配置 |

当前最重要的理解是：

1. **Template 决定编排**
2. **Stage 决定执行配置**
3. **Run 是一次执行**
4. **Project 是多 Run 容器**
5. **RunCapsule / MemoryCandidate 是执行后的学习层**
6. **OperatingSignal / Agenda / Budget / Growth / Loop 是 AI 公司自运营层**
7. **SystemImprovement 是受控自我改进层，不是自动改代码层**

Company Kernel 约束：

1. 自动沉淀不会再直接 append `.department/memory/*.md`。
2. run 完成后的经验先进入 `MemoryCandidate`。
3. 只有显式 promote 后才会写入结构化 `KnowledgeAsset`。
4. 这层不改变 Antigravity IDE / Language Server / Provider 启动逻辑。
5. Signal / Agenda 只做观察、排序和推荐，不会无限自循环。
6. Agenda dispatch、scheduler dispatch、manual CEO / `agent-runs` dispatch、growth generate/evaluate 都先过 budget gate 和 circuit breaker；手动任务不消耗 autonomous dispatch quota，但会记录 token/runtime ledger。
7. Budget reservation 会绑定到创建出来的 `runId`，run 到达终态后统一 commit / release，避免 reserved 和 committed 重复计数；缺少 target workspace 的 agenda 不会预占预算。
8. Approval lifecycle 会进入经营信号：提交审批、批准、拒绝、反馈都会成为可解释的 agenda 来源。
9. Run terminal failure 会更新 department、scheduler-job、provider、workflow 熔断器；`recoverAt` 到期后 open breaker 会进入 `half-open` 探测态，成功终态会 reset 对应 breaker。
10. `cooldownMinutesByKind` 会按 ledger `operationKind` 生效，冷却未结束的动作会被 gate 拦截并可写入 `skipped`。
11. GrowthProposal 高风险发布默认必须人工 approve；script proposal 还必须先通过 dry-run，公开 publish API 不接受 force 绕过。
12. 三次以上同类成功 RunCapsule 可生成 workflow proposal；重复脚本化任务和重复规则约束可生成 script / rule proposal。
13. Published workflow/skill proposal 会进入 Prompt Mode 执行解析，下一次相似任务可自动注入 canonical workflow/skill。
14. Knowledge 页面提供候选记忆详情态和增长提案入口，支持 refresh、promote、reject、generate、evaluate、approve、dry-run、publish、observe，不做高频轮询。
15. 候选记忆详情可以直接触发 GrowthProposal 生成；KnowledgeAsset 详情会展示 linked GrowthProposal，避免增长提案和来源证据脱节。
16. Company Loop 只处理 Top-N agenda，默认每轮最多 autonomous dispatch 1 个；`approve` 不会被自动批准，高风险 dispatch 只进 digest / approval。
17. Scheduler 内置 company daily/weekly loop 使用 cron job，不创建 5 秒 interval，不启动第二套 worker。
18. SystemImprovement 在 proposal 被 approve 后，会自动在内置平台工程部创建受控开发 Project，并派发 `development-template-1` 首跑；proposal 之后会沿着 `approved -> in-progress -> testing -> ready-to-merge` 随平台工程项目状态和测试证据自动收口；第一版仍然没有 auto merge、auto push、auto deploy API。
19. Settings 的 `Autonomy 预算` 是自治策略入口，用于维护组织级 budget、部门默认 budget、loop policy、并发、失败预算、operation cooldown 与 high-risk approval threshold。
20. 平台工程部是内置 Department 实例，workspace 位于 `AG_GATEWAY_HOME/system-workspaces/platform-engineering/`；它继续复用 Project / Company Kernel / Approval / Scheduler，不引入第二套自进化机制。
21. 平台工程部项目默认开启 `governance.platformEngineering.observe = true` 与 `allowProposal = true`；这类项目出现 `failed / blocked / timeout` run 时，系统会自动生成 `SystemImprovementSignal`，并可继续自动生成 proposal 给 CEO。
22. `User Story` 中的 `[不支持]` 场景会被同步成平台工程部的长期改进信号池；第一版默认不批量自动生成 proposal，避免直接淹没 CEO 决策面。

---

## 3. 常用模板

| 模板 ID | 用途 | 说明 |
|---------|------|------|
| `coding-basic-template` | 简单编码 | 单阶段 coding，适合修 bug、小功能、重构 |
| `development-template-1` | 完整产研链 | `product-spec -> architecture -> dev` |
| `ux-driven-dev-template` | 交互驱动产研 | 先 UX 审计，再进入产研链 |
| `large-project-template` | 大型项目拆分 | 规划、fan-out、join、集成 |
| `universal-batch-template` | 通用批量研究 | 并行分支研究与汇总 |
| `adhoc-universal` | 通用兜底 | 无法唯一确定模板时的轻量 fallback |

说明：

1. 模板持久化现在是 **inline-only**
2. 不再保存 `groups{}`
3. 如果旧文档还在讨论 `groupId`，那是历史概念，不是现行公共契约

---

## 4. 主要 API

### 4.1 派发

`POST /api/agent-runs`

最常用字段：

| 字段 | 说明 |
|------|------|
| `templateId` | 模板 ID，当前主入口 |
| `stageId` | 可选，指定从哪个 stage 开始 |
| `workspace` | `file://` workspace URI |
| `prompt` | 目标描述 |
| `projectId` | 可选，挂到已有项目 |
| `templateOverrides` | 运行时覆写模板参数 |
| `model` | 可选模型 |

### 4.2 列表接口

以下列表接口统一支持 `page` / `pageSize`，并返回：

```json
{
  "items": [],
  "page": 1,
  "pageSize": 50,
  "total": 0,
  "hasMore": false
}
```

统一分页的列表包括：

1. `GET /api/conversations`
2. `GET /api/projects`
3. `GET /api/agent-runs`
4. `GET /api/scheduler/jobs`
5. `GET /api/company/run-capsules`
6. `GET /api/company/memory-candidates`
7. `GET /api/company/signals`
8. `GET /api/company/agenda`
9. `GET /api/company/budget/policies`
10. `GET /api/company/budget/ledger`
11. `GET /api/company/circuit-breakers`
12. `GET /api/company/growth/proposals`
13. `GET /api/projects/:id/checkpoints`
14. `GET /api/projects/:id/journal`

### 4.3 Company Kernel

```bash
GET  /api/company/run-capsules
GET  /api/company/run-capsules/:runId
GET  /api/company/memory-candidates
GET  /api/company/memory-candidates/:id
POST /api/company/memory-candidates/:id/promote
POST /api/company/memory-candidates/:id/reject
GET  /api/company/signals
GET  /api/company/signals/:id
POST /api/company/signals/:id/dismiss
GET  /api/company/agenda
GET  /api/company/agenda/:id
POST /api/company/agenda/:id/snooze
POST /api/company/agenda/:id/dismiss
POST /api/company/agenda/:id/dispatch-check
POST /api/company/agenda/:id/dispatch
GET  /api/company/operating-day
GET  /api/company/budget/policies
GET  /api/company/budget/policies/:id
PUT  /api/company/budget/policies/:id
GET  /api/company/budget/ledger
GET  /api/company/circuit-breakers
POST /api/company/circuit-breakers/:id/reset
GET  /api/company/growth/proposals
POST /api/company/growth/proposals/generate
POST /api/company/growth/proposals/:id/evaluate
POST /api/company/growth/proposals/:id/approve
POST /api/company/growth/proposals/:id/reject
POST /api/company/growth/proposals/:id/dry-run
POST /api/company/growth/proposals/:id/publish
GET  /api/company/growth/observations
POST /api/company/growth/observations
GET  /api/company/loops/policies
GET  /api/company/loops/policies/:id
PUT  /api/company/loops/policies/:id
GET  /api/company/loops/runs
GET  /api/company/loops/runs/:id
POST /api/company/loops/run-now
GET  /api/company/loops/digests
GET  /api/company/loops/digests/:id
POST /api/company/loops/runs/:id/retry
GET  /api/company/self-improvement/signals
POST /api/company/self-improvement/signals
GET  /api/company/self-improvement/proposals
POST /api/company/self-improvement/proposals/generate
GET  /api/company/self-improvement/proposals/:id
POST /api/company/self-improvement/proposals/:id/evaluate
POST /api/company/self-improvement/proposals/:id/approve
POST /api/company/self-improvement/proposals/:id/reject
POST /api/company/self-improvement/proposals/:id/attach-test-evidence
POST /api/company/self-improvement/proposals/:id/observe
```

使用建议：

1. 用 RunCapsule 看一次 run 被系统确认下来的事实、证据、blockers 和 quality signals。
2. RunCapsule 重建时会合并既有 WorkingCheckpoint，不覆盖已记录的生命周期证据。
3. 用 MemoryCandidate 审核自动沉淀出来的候选经验。
4. promote 后才会生成 `KnowledgeAsset`，并带上 evidence / promotion 元数据。
5. reject 只改变候选状态，不删除 run 或 capsule；已 promote/rejected/archived 的闭合候选不会被后续自动重生成回滚。
6. 即便系统侧启用 auto-promote，空证据、高冲突、volatile 或低分候选也不会自动晋升。
7. 用 `OperatingSignal` 看系统观察到了什么，用 `OperatingAgendaItem` 看 CEO 当前应该处理什么。
8. 用 `dispatch-check` 解释“为什么这个任务不能跑”，不要绕开 budget / circuit breaker。
9. Scheduler 手动触发或到点触发如果被 budget / circuit 拦截，会返回 `skipped` 并写 ledger，不会创建 run。
10. 用 `GrowthProposal` 审核自增长候选；generate/evaluate 也会写 budget ledger。
11. `publish` 才会写 canonical workflow/skill/rule、workflow script 或 SOP knowledge；workflow/skill 发布后会参与后续 Prompt Mode 解析。
12. 在 Settings `Autonomy 预算` 调整组织默认策略、部门默认预算和 loop policy，不要直接改库；该页保存后会影响 budget gate、cooldown、Company Loop cadence/timezone/enabled、通知通道和 GrowthProposal 审批阈值。
13. 用 `CompanyLoopRun` 追踪 daily/weekly/growth/risk loop 的 selected、dispatch、skipped、ledger 和 digest；`metadata.skippedAgenda` 是解释 skipped 原因的结构化来源，不要用新增后台轮询替代 loop run。
14. 用 `SystemImprovementProposal` 管理系统自我改进，protected core 涉及 scheduler、provider、approval、database、runtime、company API 时必须走 approval 和测试证据；high/critical proposal 不能只靠 passed test evidence 进入 `ready-to-merge`。

`MemoryCandidate` 关键字段：

| 字段 | 说明 |
|------|------|
| `kind` | `decision` / `pattern` / `lesson` / `domain-knowledge` / `workflow-proposal` / `skill-proposal` |
| `status` | `candidate` / `pending-review` / `promoted` / `auto-promoted` / `rejected` / `archived` |
| `evidenceRefs` | 支撑该候选的 run、artifact、result envelope、API response 等证据 |
| `score` | evidence / reuse / specificity / stability / novelty / risk 的结构化评分 |
| `volatility` | `stable` / `time-bound` / `volatile` |
| `conflicts` | 与现有 KnowledgeAsset 的相似冲突，`high` 冲突必须人工审核 |

`OperatingSignal` 关键字段：

| 字段 | 说明 |
|------|------|
| `source` | `run` / `scheduler` / `approval` / `knowledge` / `system` 等来源 |
| `kind` | `opportunity` / `risk` / `routine` / `failure` / `learning` / `decision` |
| `score` | 由 urgency、value、confidence、risk 计算出的排序分 |
| `dedupeKey` | 幂等合并键，避免同一事件反复刷屏 |
| `status` | `observed` / `triaged` / `dismissed` / `converted` |

`OperatingAgendaItem` 关键字段：

| 字段 | 说明 |
|------|------|
| `recommendedAction` | `dispatch` / `ask_user` / `approve` / `observe` / `snooze` / `dismiss` |
| `priority` | `p0` / `p1` / `p2` / `p3` |
| `estimatedCost` | dispatch 前参与预算 gate 的 tokens / minutes |
| `budgetDecisionId` | 最近一次 budget gate 结果 |
| `blockedReason` | 被预算或熔断拦截时的解释 |

`GrowthProposal` 关键字段：

| 字段 | 说明 |
|------|------|
| `kind` | `sop` / `workflow` / `skill` / `script` / `rule` |
| `risk` | `low` / `medium` / `high`；高风险默认必须 approve |
| `sourceRunIds` | 真实 run 证据 |
| `sourceKnowledgeIds` | 已晋升知识证据 |
| `evaluation` | 评估结论与原因 |
| `publishedAssetRef` | 发布后关联的 canonical asset 或 knowledge asset |

GrowthProposal 生成口径：

1. 三次以上同类成功 RunCapsule 可以生成 `workflow` proposal。
2. 两次同类成功、单次稳定 reusable steps，或 promoted `pattern/lesson` KnowledgeAsset 更偏向 SOP proposal。
3. 高风险 proposal 先进入 `approval-required`，不直接 publish。
4. 发布后用 observation 记录命中率、成功率、token saving 和回归信号。

`CompanyLoopRun` 关键字段：

| 字段 | 说明 |
|------|------|
| `kind` | `daily-review` / `weekly-review` / `growth-review` / `risk-review` |
| `status` | `running` / `completed` / `skipped` / `failed` |
| `selectedAgendaIds` | 本轮 Top-N 选择结果 |
| `dispatchedRunIds` | 本轮实际创建的 queued run |
| `budgetLedgerIds` | 本轮 budget gate / growth review 相关 ledger |
| `summary` | 结构化摘要，详细证据仍看 agenda / ledger / digest |
| `metadata.skippedAgenda` | 每个 skipped agenda 的 id、reason、status、priority、recommendedAction、cost 和 evidence |

`SystemImprovementProposal` 关键字段：

| 字段 | 说明 |
|------|------|
| `risk` | `low` / `medium` / `high` / `critical` |
| `protectedAreas` | 命中的受保护区域，如 `database`、`scheduler`、`provider` |
| `implementationPlan` | 建议实施步骤，不代表已执行 |
| `testPlan` | 必须补齐的测试命令或验证动作 |
| `rollbackPlan` | 回滚策略 |
| `testEvidence` | 已实际执行的测试证据 |
| `approvalRequestId` | 高风险/critical proposal 的审批请求；未审批前 passed test evidence 不会把状态推进到 `ready-to-merge` |
| `metadata.approvalStatus` / `metadata.approvedAt` | 持久审批事实；已审批 proposal 可在 failed evidence 后通过最新 passed evidence 恢复到 `ready-to-merge` |
| `metadata.improvementProjectId` / `metadata.improvementRunId` | approve 后自动创建的平台工程 Project 与首个执行 Run |
| `metadata.improvementTemplateId` / `metadata.launchStatus` | 自动执行所选模板与当前派发状态 |
| `exitEvidence.project` / `latestRun` | 当前平台工程 Project 与最新 Run 的执行快照 |
| `exitEvidence.testing` | 测试计划、已提交证据、最近一次测试状态 |
| `exitEvidence.mergeGate` | 准出 gate 汇总，明确 approval / delivery / tests / rollback 是否齐备 |

### 4.4 审批

```bash
GET   /api/approval
GET   /api/approval/events
PATCH /api/approval/:id
POST  /api/approval/:id/feedback
```

`ApprovalRequest` 关键字段：

| 字段 | 说明 |
|------|------|
| `id` | 审批请求 ID |
| `type` | 审批类型，例如 `proposal_publish` / `pipeline_approval` |
| `workspace` | 发起请求的 workspace URI |
| `urgency` | `low` / `normal` / `high` / `critical` |
| `status` | `pending` / `approved` / `rejected` / `feedback` |
| `response` | CEO 响应内容、响应时间和响应通道 |
| `notifications` | 各通知通道 delivery 结果，包含 `channel`、`success`、`messageId`、`sentAt`、`error` |

### 4.4 定时任务

```bash
GET  /api/scheduler/jobs
POST /api/scheduler/jobs
POST /api/scheduler/jobs/:id/trigger
```

补充说明：

1. `cron` 任务支持可选 `timeZone` 字段，例如 `Asia/Shanghai`。
2. `GET /api/scheduler/jobs` 返回分页结果，并附带 `nextRunAt`、`lastRunAt`、`lastRunResult`；任务已过触发点但尚未执行时，`nextRunAt` 返回当前时间，表示应立即补跑。
3. `DELETE /api/scheduler/jobs/:id` 会同步删除 SQLite 中的持久化记录。
4. 默认同设备部署由 `opc-api` 承载 cron scheduler；如需临时关闭，设置 `AG_ENABLE_SCHEDULER=0`。
5. fan-out / approval / CEO event consumer 等 companion 后台默认不随 `opc-api` 启动；需要恢复类后台时设置 `AG_ENABLE_SCHEDULER_COMPANIONS=1`。
6. 首页和 management overview 不再只看启用中的 job 数；`schedulerRuntime.status` 会明确显示 `running` / `idle` / `disabled` / `stalled`，避免把“库里有定时任务”误显示成“调度正在运行”。
7. dispatch 类 scheduler job 触发前会生成 routine agenda 并经过 budget gate；预算不足或熔断打开时记录 `skipped`，不创建 run。

---

## 5. Project 生命周期

典型链路：

```text
创建 Project
  -> 派发入口 Stage
  -> 上游完成后自动触发下游
  -> 审批 / 干预 / 恢复
  -> 完成并沉淀交付物
```

### Resume / Recover / Intervention

`POST /api/projects/:id/resume`

| action | 用途 |
|--------|------|
| `recover` | 从已有 artifacts 恢复同一个 run 的完成态 |
| `nudge` | 对 stale-active run 发继续提示 |
| `restart_role` | 在同一 run 内新建子会话接管 |
| `cancel` | 终止并标记取消 |
| `skip` | 跳过当前 stage，不触发下游 |
| `force-complete` | 强制标记完成，并触发下游 |

关键边界：

1. `recover` 只适用于当前 stage-centric 持久化数据
2. 旧的 `groupId`-only 持久化状态不再参与恢复

---

## 6. Department 与 CEO

部门配置位于：

```text
<workspace>/.department/config.json
```

常见字段：

| 字段 | 说明 |
|------|------|
| `departmentId` | 部门稳定 ID，同一部门会镜像写入多个已绑定 workspace |
| `name` | 部门名 |
| `type` | `build` / `research` / `operations` / `ceo` |
| `templateIds` | 该部门允许使用的模板 |
| `skills` | 技能声明 |
| `provider` | 默认 provider |
| `tokenQuota` | 每日 / 每月额度与申请策略 |
| `workspaceBindings` | 绑定的 workspace 列表，`role` 支持 `primary` / `execution` / `context` |
| `executionPolicy.defaultWorkspaceUri` | 默认主执行目录 |
| `executionPolicy.contextDocumentPaths` | 任务执行时附加的潜在上下文文档路径 |

当前 Department 不再等于“单一 workspace”，而是：

1. 至少有一个 `primary` workspace
2. 可以附加多个 `execution` workspace
3. 可以附加多个 `context` workspace
4. 任务默认只在主执行目录写入，其他目录更适合作为补充上下文

相关 API：

```bash
GET /api/departments?workspace=<uri>
PUT /api/departments?workspace=<uri>
GET /api/departments/quota
GET /api/departments/memory
POST /api/departments/sync
```

说明：

1. `GET /api/departments` 会返回归一化后的 `workspaceBindings` 与 `executionPolicy`
2. `PUT /api/departments` 会把同一份部门配置镜像写入所有已绑定 workspace 的 `.department/config.json`

内置平台工程部补充约束：

1. `departmentId = department:platform-engineering`
2. workspace 固定在 `AG_GATEWAY_HOME/system-workspaces/platform-engineering/`
3. 基础记忆放在 `.department/memory/shared|codex|claude-engine/`
4. 平台工程部自身 workspace 创建出来的项目，会默认开启平台工程治理字段
5. 代码级自开发任务不直接改平台工程部 workspace，也不直接改主仓库；runner 会从目标仓库创建独立 git worktree，并把 evidence 写回平台工程部 workspace

### 6.1 Project 治理字段

`Project` 当前新增平台工程治理字段：

| 字段 | 含义 |
|------|------|
| `governance.platformEngineering.observe` | 是否纳入平台工程部观察 |
| `governance.platformEngineering.allowProposal` | 是否允许平台工程部基于真实运行自动生成系统改进 proposal |
| `governance.platformEngineering.departmentId` | 当前治理归属的稳定部门 ID |
| `governance.platformEngineering.source` | 字段来源，当前支持 `default` / `manual` / `proposal-created` |
| `governance.platformEngineering.updatedAt` | 最近一次治理配置更新时间 |

CEO 命令的当前职责：

1. 状态查询
2. 创建 ad-hoc project
3. 创建 scheduler job
4. 把任务路由到目标部门

CEO Office 首页的例行任务来自 `GET /api/ceo/routine` 的结构化 `actions[]`：

| 字段 | 说明 |
|------|------|
| `id` | 首页动作稳定 ID |
| `type` | `approval` / `project` / `scheduler` / `knowledge` / `focus` |
| `status` | `done` / `pending` / `attention` |
| `priority` | `low` / `medium` / `high` |
| `target` | 下钻目标，包含目标 section 与可选 request/project/job/knowledge/workspace ID |

前端只按 action target 下钻，不再自己编造完成态或泛跳到无关页面。

首页展示约束：

1. 全量 agent state 刷新周期为 60 秒，不再 5 秒拉取 projects / runs / servers / workspaces。
2. “今日关注”显示需处理/待确认数量，不把 action 列表伪装成用户已完成清单。
3. 顶部入口只展示真实能力；没有全局搜索或语音能力时，不显示 `⌘K` 搜索或“语音指令”。
4. 指标卡只展示当前可验证状态，不在前端编造“较昨日”趋势。
5. “最新部门日报”会从已知 workspace 的 digest 候选中按日期与活动量选择，不再固定取前 6 个 workspace 的第一个结果。

---

## 7. Conversation 与 Agent Run 的区别

### Conversation

面向聊天壳层：

1. `POST /api/conversations`
2. `POST /api/conversations/:id/send`
3. `GET /api/conversations/:id/steps`

它既支持：

1. Antigravity 真正的 Cascade conversation
2. Gateway 本地 conversation

### Agent Run

面向交付编排：

1. 模板与阶段调度
2. 隐藏子对话执行
3. project 关联
4. review、approval、resume、deliverables

简单说：

1. **Conversation 更像聊天壳层**
2. **Agent Run 更像任务执行与交付流水线**

---

## 8. AI Provider 与本机执行工具

### 8.0 AI Provider

| Provider | 适用场景 | 说明 |
|----------|----------|------|
| `antigravity` | IDE 原生路径 | 走 language server / gRPC；这是当前 `Native` 的真实语义 |
| `native-codex` | 无 IDE 的本地/云执行 | Department 主链和本地 conversation 都已走 Claude Engine runtime；文本 / tool 主线 transport 固定为 `pi-ai` |
| `claude-api` | 进程内 API 执行 | 由 Gateway 自管 transcript 与工具链 |
| `openai-api` / `gemini-api` / `grok-api` / `custom` | 云端 provider | 统一接到 Department runtime contract；transport/profile 由组织级配置决定 |

### 8.0.1 本机执行工具

| Tool | 适用场景 | 说明 |
|------|----------|------|
| `codex` | 本机 coding / shell / 文件改动 | 由 Claude Engine `ExecutionTool` 统一调用；底层可按 session 续接 |
| `claude-code` | 本机 Claude Code CLI 执行 | 同样走 `ExecutionTool` 合同，不参与 Provider 选择 |

当前实现边界：

1. `native-codex` 的 Department / `agent-runs` 主链已经走新 runtime
2. `native-codex` 的本地 conversation 也已统一走 `api-provider-conversations` / Claude Engine transcript
3. `codex / claude-code` 现在属于执行工具层，不再作为 provider fallback 轨道暴露；是否调用它们由 Claude Engine toolset 与运行时策略决定
4. `Native` 不再表示“我们手写的一般 provider transport”；它只保留给 `Antigravity IDE/runtime` 这类平台专有路径
5. 平台工程部调用 Codex CLI 修改主软件时，使用独立 worktree、短 task packet、allowlist、`git diff --check` 和调用方验证命令生成准出 evidence；Codex CLI 不进入 Provider 层

### 8.1 Provider transport 与模型目录

组织级配置现在除了 `defaultProvider / layers / scenes`，还支持 `providerProfiles`：

```json
{
  "defaultProvider": "antigravity",
  "activeCustomProviderId": "baogaoai-glm",
  "customProviders": [
    {
      "id": "baogaoai-glm",
      "name": "BaogaoAI GLM",
      "baseUrl": "https://new.baogaoai.com/v1",
      "defaultModel": "glm-4-flash-250414"
    }
  ],
  "providerProfiles": {
    "antigravity": { "transport": "native", "authMode": "runtime" },
    "native-codex": {
      "transport": "pi-ai",
      "authMode": "codex-oauth",
      "supportsImageGeneration": true,
      "enableImageGeneration": true,
      "imageGenerationModel": "gpt-5.5"
    },
    "openai-api": {
      "transport": "pi-ai",
      "authMode": "api-key",
      "supportsImageGeneration": true,
      "enableImageGeneration": true,
      "imageGenerationModel": "gpt-image-1"
    }
  }
}
```

使用规则：

1. `defaultProvider / layers / scenes` 只决定“业务路由到哪个 provider/model”。
2. `providerProfiles` 负责 provider 的认证与能力细节；除 `antigravity` 外，API-backed provider 在 Claude Engine 主线上固定走 `pi-ai`。
3. `providerProfiles[provider].enabled = false` 表示“从当前系统移除这个已检测到的本机 Provider”，不会删除机器上的 CLI / OAuth 登录态。
4. `customProviders[]` 保存多个兼容端点；运行时只把 `activeCustomProviderId` 对应的接入物化到 `customProvider`，保持旧模块兼容。
5. `Settings -> Provider 配置` 与 `Scene 覆盖` 现在都会消费 provider model catalog。
6. 模型目录优先来自 `pi-ai registry`、`custom /v1/models` 或运行时发现，无法发现时才回退到手动模型。
7. 遗留 `codex / claude-code` 配置值会在保存和加载时自动归一为 `native-codex`；CLI coder 不再属于组织级 Provider 配置。
8. Claude Engine 的 `coding / full` toolset 会自动挂载统一的 `ExecutionTool`；它对上只暴露“列出 / 调用执行工具”，单轮与多轮差异由底层 executor 自己处理。

### 8.2 Settings 模型选择器

`Settings` 里的默认模型、layer 模型、scene 模型不再只靠手填字符串；并且首次接入 provider 的主旅程已经收敛到同一页。

当前行为：

1. `Settings -> Provider 配置` 现在收敛成两段主旅程：
   - `AI 接入`：添加或管理可用接入
   - `默认配置`：选择默认 Provider / 默认模型，并在同一卡里展开 `高级设置`
2. `AI 接入` 放在最上面：
   - API provider 直接在这里填写 `API Key`、测试连接、保存接入
   - 自定义服务在这里填写 `name / baseUrl / apiKey / defaultModel`
   - 本机已检测到的 `native-codex` 会直接出现在“已接入”列表
   - `codex / claude-code` 会出现在单独的“本机执行工具”区块，只表示运行时可调用，不参与 Provider 选择
   - 本机 Provider 支持 `移除 / 恢复`，但只影响当前系统显示，不会删除本机登录态
   - 不再要求用户在 `Provider 配置` 和 `凭证中心` 两个入口之间来回跳
3. `默认配置` 只负责“使用哪一个”：
   - 默认 Provider
   - 默认模型
   - 同卡内折叠的 `高级设置`
4. 默认配置首屏不再重复露出 `刷新模型`；模型目录会随 provider 变化自动读取，主页面只保留选择行为。
5. 模型目录仍按内部来源工作：
   - `pi-ai registry`
   - `remote-discovery`
   - `manual`
6. 图像 Model 选择器会按 capability 过滤模型；例如 `native-codex` 当前会显示 `GPT-5.2 / GPT-5.4 Mini / GPT-5.5` 这类已标记图像能力的模型。
7. `custom` provider 在 `baseUrl/apiKey` 缺失时，允许继续手动输入 `defaultModel` 作为目录回退。
8. `native-codex / claude-api / openai-api / gemini-api / grok-api / custom` 的运行时主链固定走 `pi-ai` transport；transport 属于底层实现细节，当前不再在 Settings 主界面暴露。
9. `图像生成` 与 `按层覆盖` 统一收进 `默认配置` 卡内的折叠 `高级设置`。首次接入 provider 时，用户只需要完成 `添加接入 -> 选择默认 Provider / 模型 -> 保存默认配置`。
10. `AI 接入` 现在有完整的已接入管理闭环：
   - 已保存的 API Provider 可以 `编辑 / 复测 / 删除`
   - 兼容端点可以保存多个接入，并且支持 `设为当前 / 编辑 / 复测 / 删除`
   - 不完整的兼容端点草稿会显示为 `待完成`，不会被计入已接入，也不会进入默认 Provider 选择。

### 8.3 Knowledge 与图像生成

同一套 provider routing 已经延伸到非对话型 AI 动作：

1. `POST /api/knowledge/:id/summary` 通过 `knowledge-summary` scene 生成并回写 Knowledge 摘要。
2. `Settings -> 图像生成` 通过 `POST /api/provider-image-generation` 对已配置的图像 provider 做 smoke test；当前已接通 `native-codex`、`openai-api`、`custom`。
3. `native-codex` 图像链通过 Codex subscription auth 走 Responses `image_generation` tool；如果 UI 传入较小尺寸，provider 层会自动提升到 `1024x1024` 以满足上游最小像素预算。
4. `knowledge-summary / knowledge-image` scene 继续复用同一份 provider model catalog，不存在独立的 Knowledge provider 配置页。

---

## 9. Department Runtime Contract

如果要显式声明部门边界，可在 `POST /api/agent-runs` 里传：

```json
{
  "departmentRuntimeContract": {
    "workspaceRoot": "/Users/you/project",
    "readRoots": ["/Users/you/project"],
    "writeRoots": ["/Users/you/project/docs"],
    "artifactRoot": "/Users/you/project/demolong/runs/run-123",
    "executionClass": "delivery",
    "toolset": "coding",
    "permissionMode": "acceptEdits"
  }
}
```

常用字段：

| 字段 | 说明 |
|------|------|
| `workspaceRoot` | 主工作目录 |
| `additionalWorkingDirectories` | 额外挂载目录 |
| `readRoots` | 可读根路径 |
| `writeRoots` | 可写根路径 |
| `artifactRoot` | 产物根目录 |
| `executionClass` | `light` / `artifact-heavy` / `review-loop` / `delivery` |
| `toolset` | `research` / `coding` / `safe` / `full` |
| `permissionMode` | `default` / `dontAsk` / `acceptEdits` / `bypassPermissions` |

目前真正主消费这套 contract 的是 Claude Engine 路径，覆盖：

1. `native-codex`
2. `claude-api`
3. `openai-api`
4. `gemini-api`
5. `grok-api`
6. `custom`

补充边界：

1. `coding / full` toolset 会在 Claude Engine session 上附加 `ExecutionTool`
2. `codex / claude-code` 通过这层进入运行时，不再单独作为 provider/backend 出现在组织级配置平面

---

## 10. 关键路径

| 内容 | 路径 |
|------|------|
| 主数据库 | `~/.gemini/antigravity/gateway/storage.sqlite` |
| 模板 | `~/.gemini/antigravity/gateway/assets/templates/*.json` |
| 工作流 | `~/.gemini/antigravity/gateway/assets/workflows/*.md` |
| 项目状态 | `~/.gemini/antigravity/gateway/projects/` |
| Run 历史 | `~/.gemini/antigravity/gateway/runs/{runId}/run-history.jsonl` |
| 部门配置 | `workspace/.department/config.json` |
| AI Provider 配置 | `~/.gemini/antigravity/ai-config.json` |
| Provider 模型目录缓存 | `~/.gemini/antigravity/provider-model-catalog.json` |

构建期配置隔离：

| 环境变量 | 说明 |
|------|------|
| `AG_ALLOW_BUILD_HOME_CONFIG=1` | 允许 `next build` 静态收集阶段读取真实 HOME 下的 AI Provider 配置。默认不读取，使用内置 default config。 |

---

## 11. 常见问题

### Q: 为什么没有 `/api/agent-groups` 了？

因为公共编排接口已经迁移到 `templateId + stageId`。Group 是历史实现阶段的概念，不再作为当前公共 API 对象暴露。

### Q: `GET /api/agent-runs` 为什么不直接给完整超大对象？

因为列表接口已经收口为分页 list view，只保留摘要字段；完整大对象请走 `GET /api/agent-runs/:id`。

### Q: 首页 / 设置 / CEO / 部门会不会被 runtime 拖慢？

在 split 模式下，`web` 只做壳层与代理，控制面与运行时已经拆开；目的就是降低这类相互污染。

### Q: 现在还需要依赖 Antigravity IDE 吗？

如果走 `antigravity` provider，就仍然依赖本机 IDE 与 language server。
如果走部分本地或云端 provider，则对话壳层和 Department runtime 可以不完全依赖 IDE。
