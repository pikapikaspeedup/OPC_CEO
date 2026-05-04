# 软件自迭代试运行行动计划

**日期**: 2026-04-30  
**状态**: 历史试运行计划，当前机制已覆盖主要执行链路
**目标**: 记录 2026-04-30 当时用于验证主软件自迭代机制是否真实有效的试运行路线，并说明这些阶段在 2026-05-01 后分别由哪些已落地机制承接。
**边界**: 本计划复用现有系统机制，不新增第二套运行模型。

## 0. 当前覆盖结论

截至 2026-05-01，本计划不再作为待执行清单使用。它的历史价值是解释平台工程部自开发链路为什么要按准入、AI Loop、准出三段收口；实际执行已经由当前机制承接：

1. 内置平台工程部已经作为系统默认部门落地，复用现有 Department / Workspace Catalog / Project / AgentRun / Company Kernel，不再需要单独冻结一套 contract。
2. 系统改进 proposal 批准后已经能自动映射为平台工程部 Project，并派发首轮 AI Loop run。
3. proposal 运行态、最新 run、测试证据和 merge gate 已经同步到 CEO Office / Ops 的准出证据视图。
4. Codex CLI worktree runner 已经成为代码级试跑的执行基线：每个任务创建独立 worktree 和 `ai/platform-*` 分支，运行前生成 task packet，运行后收集 changed files、allowlist 检查、`git diff --check`、验证命令和 evidence JSON。
5. 因此，“是否进入代码级试跑”的判断已经被当前 Codex CLI worktree runner 与平台工程部机制取代；后续只需要围绕具体 proposal / project 按现有准入和准出门槛执行。

## 1. 试运行目标

本轮试运行在当时只验证四件事。它们现在的状态如下：

1. 内置平台工程部门作为真实责任主体接住 CEO 开发命令、项目异常和系统改进 proposal：已由平台工程部 workspace bootstrap、项目治理字段、平台工程观察器和 proposal 自动立项覆盖。
2. 主软件运行链路能产生 run、产物、signal、agenda 和 proposal：已由 Project / Run / Company Kernel / SystemImprovement 主线承接。
3. 系统从真实运行和主软件用户场景缺口中生成可执行系统改进项目：已由平台工程观察器、SystemImprovementSignal、SystemImprovementProposal 和批准后自动立项覆盖。
4. 在不新增机制的前提下闭环准入、AI Loop、准出三段：已由 proposal 审批、平台工程 Project / Run、Codex CLI worktree runner 和 exit evidence 覆盖。

## 2. 范围与不做

### 本轮范围

1. 内置平台工程部门 contract：已落地为内置平台工程部 workspace 和 Department 注册。
2. 项目级纳入观察 / 主动提案开关：已落地为 `governance.platformEngineering.observe / allowProposal`。
3. 主软件黄金路径：保留为软件自迭代审计样本。
4. `signal -> proposal -> project` 链路：已由平台工程观察器和系统改进执行编排覆盖。
5. 准出前验证矩阵：已由 runtime-synced `exitEvidence` 和 Codex CLI runner evidence 承接。

### 本轮不做

1. 不新增独立软件自迭代后端。
2. 不新增第二套 memory 或 loop。
3. 不做自动 merge / auto push / auto deploy。
4. 不做大规模 UI 重构。
5. 不追求脱离平台工程部治理的全系统 sweep。

## 3. 现有机制复用清单

本轮只复用现有机制：

1. DepartmentConfig / workspace bindings / executionPolicy
2. Project / AgentRun / Project diagnostics / reconcile
3. RunCapsule / MemoryCandidate / Promotion / KnowledgeAsset
4. OperatingSignal / OperatingAgendaItem / CompanyOperatingDay
5. BudgetPolicy / BudgetLedger / CircuitBreaker
6. GrowthProposal / SystemImprovementProposal
7. CompanyLoopPolicy / CompanyLoopRun / CompanyLoopDigest
8. Approval / Approval events / signed approval links
9. Scheduler jobs / manual trigger / trigger context
10. CEO Office / Ops / Projects / Knowledge / Settings

## 4. 试运行总路线

```text
Phase A 先冻结内置部门 contract
-> Phase B 盘点主软件黄金路径现状
-> Phase C 跑一次真实链路审计
-> Phase D 建立 signal -> proposal -> project 闭环
-> Phase E 建立准出证据包
-> Phase F 进入代码级试跑执行基线
```

当前状态：

1. Phase A、Phase D、Phase E、Phase F 已被平台工程部机制和 Codex CLI worktree runner 覆盖。
2. Phase B、Phase C 仍有历史价值，适合作为主软件黄金路径的专项审计模板，但不再作为代码级自开发试跑的前置条件。

## 5. 分阶段行动

### Phase A: 冻结内置部门 contract

历史目标：

1. 把内置平台工程部门定义成现有 Department 实例。
2. 明确它不引入新机制。
3. 明确它的默认 workspace、权限边界和治理策略。

当前覆盖：

1. 已有内置平台工程部 workspace bootstrap，固定落在系统 workspace 路径下。
2. 已通过 Workspace Catalog / DepartmentConfig 注册为系统默认部门。
3. 已有项目治理字段承接项目级开关：
   - 是否纳入观察
   - 是否允许主动提案
4. 已复用现有 Project、AgentRun、Company Kernel、Approval 和 Budget 结构，没有引入第二套运行模型。

保留价值：

1. 作为判断后续自开发能力是否绕开现有系统结构的对照基线。
2. 如果未来新增平台工程部权限字段，应继续遵守“不新增第二套 proposal、loop、memory、project 结构”的边界。

### Phase B: 主软件黄金路径盘点

历史目标：

1. 只围绕一条主软件黄金路径盘点当前真实运行链路。
2. 在改动代码前先拿到事实基线。

盘点项：

1. scheduler job 是什么
2. 触发频率和最近 7 天运行情况
3. 是否每次都有 run
4. 是否有 terminal 状态
5. 产物落在哪里
6. knowledge 是否回流
7. CEO Office 是否可见
8. Ops 是否可见
9. 失败是否可追踪、可重试

当前覆盖：

1. 这部分仍是主软件黄金路径专项审计模板，不等同于平台工程部通用代码级试跑基线。
2. 平台工程部通用链路已由 Project / Run / proposal runtime sync / exit evidence 承接。
3. 如果主软件黄金路径出现断点，应作为具体软件链路问题进入平台工程部 proposal / project，而不是阻塞全部自开发机制。

保留价值：

1. 对主软件黄金路径有结构化事实，不靠猜。

### Phase C: 真实链路试运行

历史目标：

1. 手动或按现有调度触发一次真实主软件流程。
2. 观察现有 Company Kernel 是否已把链路信号吃进去。

需要核验：

1. `Project / Run`
2. `RunCapsule`
3. `MemoryCandidate / KnowledgeAsset`
4. `OperatingSignal / Agenda`
5. `CompanyLoopDigest`
6. `SystemImprovementSignal / Proposal`

当前覆盖：

1. 平台工程部通用执行链路已经有真实 Project / Run / proposal 运行态同步作为证据载体。
2. 主软件真实链路试运行仍可用于验证软件黄金路径是否持续健康。
3. 断点应沉淀为 SystemImprovementSignal，并通过现有 proposal / project 编排进入修复。

保留价值：

1. 至少一条真实链路进入 Company Kernel 的可观测层。

### Phase D: signal -> proposal -> project 闭环

历史目标：

1. 从真实断点或用户场景缺口生成一个 proposal。
2. proposal 由内置部门负责。
3. proposal 创建为真实 Project。

输入优先级：

1. 主软件真实断点
2. `User Story` 中高价值 `[不支持]` 项
3. 重复失败信号

当前覆盖：

1. 平台工程观察器已经能从失败 run 和用户场景缺口生成 SystemImprovementSignal。
2. 系统改进 proposal 批准后已经自动创建平台工程部 Project，并派发首轮 run。
3. taskEnvelope 会携带风险、影响文件、实施计划、测试计划和回滚计划。

保留价值：

1. 系统能自己把问题转成项目，不靠手工重新描述一遍。

### Phase E: 准出验证矩阵

历史目标：

1. 为核心软件自迭代建立统一准出证据包。
2. 确认“可运行”不是口头判断。

当前覆盖：

1. Static Gate 仍应按风险执行：
   - eslint
   - tsc
   - vitest
   - build
   - diff check
2. Boot Gate 仍应在需要启动服务时执行：
   - worktree / 临时 HOME / 临时 DB
   - 真实启动命令
   - 健康检查
3. Golden Path Gate 仍作为主链路 smoke：
   - 至少一条主链路 smoke
4. Rollback Gate 仍要求可恢复：
   - 回滚步骤
   - 重启/恢复顺序
5. 当前 evidence 载体已经落到 proposal `exitEvidence`、平台工程 Project / Run、Codex CLI runner evidence JSON 和验证命令输出。

保留价值：

1. 核心变更的准出门槛固定，不靠临时判断。
2. 每次代码级自开发必须留下可复核 evidence，而不是只留下口头结论。

### Phase F: 代码级试跑执行基线

历史目标：

1. 为真正的 AI Loop 开发试跑定义进入门槛。

当前覆盖：

1. 进入门槛已经被当前准入机制取代：proposal 批准后自动进入平台工程部 Project / Run。
2. 代码级执行已经由 Codex CLI worktree runner 承接。
3. runner 的核心准出证据包括独立 worktree、独立分支、task packet、allowlist 检查、changed files、`git diff --check`、validation commands 和 evidence JSON。
4. 如果 `expectEdits = true` 但没有产生文件改动，runner 会把它记录为失败证据。

保留价值：

1. Phase F 是当前平台工程部代码级执行基线的历史来源。
2. 后续讨论应直接落到具体 proposal / project 的 admitted、implement、review、verify、ready-for-exit 状态。

## 6. 角色分工

### 人类只负责两件事

1. 准入
2. 准出

### AI Loop 负责中间全过程

1. 需求补全
2. 技术方案细化
3. 代码实现
4. 自审
5. 交叉审查
6. 自动验证
7. 失败后修复再跑
8. 形成证据包

## 7. 近期优先顺序

本节原本是 2026-04-30 的近期执行顺序。当前不再作为待办使用，改为历史约束：

1. 平台工程部 contract、项目观察、proposal 自动立项、准出证据和代码级 worktree runner 已落地。
2. 主软件黄金路径现状审计仍可作为软件专项审计启动，但不是平台工程部代码级试跑的前置条件。
3. 后续不应再从这份文档领取“先做 contract / 再决定是否试跑”的任务；应从具体 SystemImprovementProposal 或平台工程 Project 进入执行。
4. 当前机制禁止绕过治理直接做软件自迭代大 UI、自动 merge、自动 deploy 或全系统级 sweep。

## 8. 试运行完成的判定标准

这组标准现在用于解释 2026-04-30 试运行计划如何被当前机制覆盖：

1. 内置平台工程部门成为真实责任主体：已覆盖。
2. 主软件黄金路径有真实运行证据：作为软件黄金路径审计项保留，不阻塞通用自开发机制。
3. 至少一个真实问题被自动转成 proposal：已由平台工程观察器和系统改进 proposal 链路覆盖。
4. proposal 被自动转成 project：已由批准后自动立项覆盖。
5. project 有明确 test plan / rollback plan：已由系统改进执行编排的 taskEnvelope 承接。
6. 准出证据包结构被固定下来：已由 proposal `exitEvidence`、CEO/Ops 准出证据视图和 Codex CLI runner evidence 承接。

## 9. 当前使用方式

这份文档当前只用于：

1. 回看软件自迭代试运行的历史分阶段设计。
2. 判断新增机制是否偏离“不新增第二套运行模型”的边界。
3. 为主软件黄金路径审计提供检查项。
4. 解释当前平台工程部和 Codex CLI worktree runner 为什么是代码级自开发试跑的执行基线。

这份文档不再用于发起待办。新的自开发任务应通过 SystemImprovementProposal、平台工程 Project 和 Codex CLI worktree runner 执行。
