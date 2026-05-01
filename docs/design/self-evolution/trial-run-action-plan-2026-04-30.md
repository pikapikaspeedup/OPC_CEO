# 软件自进化试运行行动计划

**日期**: 2026-04-30  
**状态**: 行动计划  
**目标**: 通过试运行验证当前软件自进化机制是否真实有效，而不是继续停留在机制存在和页面可见层面。  
**边界**: 本计划复用现有系统机制，不新增第二套运行模型。

## 1. 试运行目标

本轮试运行只验证四件事：

1. 内置平台工程部门能否作为真实责任主体接住 CEO 开发命令、项目异常和系统改进 proposal。
2. AI 情报室定时任务这条黄金路径能否完整产生 run、产物、知识、signal、agenda 和 proposal。
3. 系统能否从真实运行和用户场景缺口中生成一个可执行的系统改进项目。
4. 在不新增机制的前提下，准入、AI Loop、准出三段是否能闭环。

## 2. 范围与不做

### 本轮范围

1. 内置平台工程部门 contract。
2. 项目级纳入观察 / 主动提案开关。
3. AI 情报室黄金路径。
4. `signal -> proposal -> project` 链路。
5. 准出前验证矩阵。

### 本轮不做

1. 不新增独立自进化后端。
2. 不新增第二套 memory 或 loop。
3. 不做自动 merge / auto push / auto deploy。
4. 不做大规模 UI 重构。
5. 不先追求全系统覆盖。

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
-> Phase B 盘点 AI 情报室黄金路径现状
-> Phase C 跑一次真实链路审计
-> Phase D 建立 signal -> proposal -> project 闭环
-> Phase E 建立准出证据包
-> Phase F 决定是否进入代码级自进化试跑
```

## 5. 分阶段行动

### Phase A: 冻结内置部门 contract

目标：

1. 把内置平台工程部门定义成现有 Department 实例。
2. 明确它不引入新机制。
3. 明确它的默认 workspace、权限边界和治理策略。

输出：

1. `departmentId`
2. `workspaceUri`
3. 默认 `DepartmentConfig`
4. 默认 `CompanyLoopPolicy`
5. 默认 `Budget / Approval / Protected Core` 策略
6. 项目级两个开关：
   - 是否纳入观察
   - 是否允许主动提案

通过标准：

1. 能明确说出它复用哪些现有字段。
2. 不需要新建第二套 proposal、loop、memory、project 结构。

### Phase B: 黄金路径盘点

目标：

1. 只围绕 AI 情报室定时任务盘点当前真实运行链路。
2. 不先改代码。

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

输出：

1. 黄金路径现状报告
2. 断点清单
3. 最优先修复点

通过标准：

1. 对 AI 情报室链路有结构化事实，不靠猜。

### Phase C: 真实链路试运行

目标：

1. 手动或按现有调度触发一次真实 AI 情报室流程。
2. 观察现有 Company Kernel 是否已把链路信号吃进去。

需要核验：

1. `Project / Run`
2. `RunCapsule`
3. `MemoryCandidate / KnowledgeAsset`
4. `OperatingSignal / Agenda`
5. `CompanyLoopDigest`
6. `SystemImprovementSignal / Proposal`

输出：

1. 一次真实试运行记录
2. 是否有 signal
3. 是否有 proposal 候选
4. 哪一段断了

通过标准：

1. 至少一条真实链路进入 Company Kernel 的可观测层。

### Phase D: signal -> proposal -> project 闭环

目标：

1. 从真实断点或用户场景缺口生成一个 proposal。
2. proposal 由内置部门负责。
3. proposal 创建为真实 Project。

输入优先级：

1. AI 情报室真实断点
2. `User Story` 中高价值 `[不支持]` 项
3. 重复失败信号

输出：

1. 一个被纳入平台工程部门的系统改进 proposal
2. 一个真实 Project
3. 对应的 test plan 和 rollback plan

通过标准：

1. 系统能自己把问题转成项目，不靠手工重新描述一遍。

### Phase E: 准出验证矩阵

目标：

1. 为核心软件自进化建立统一准出证据包。
2. 确认“可运行”不是口头判断。

必须包含：

1. Static Gate
   - eslint
   - tsc
   - vitest
   - build
   - diff check
2. Boot Gate
   - worktree / 临时 HOME / 临时 DB
   - 真实启动命令
   - 健康检查
3. Golden Path Gate
   - 至少一条主链路 smoke
4. Rollback Gate
   - 回滚步骤
   - 重启/恢复顺序

输出：

1. `Exit Evidence Bundle` 模板
2. 按风险等级的最小验证矩阵

通过标准：

1. 核心变更的准出门槛固定，不再靠临时判断。

### Phase F: 决定是否进入代码级试跑

目标：

1. 基于前面几阶段的证据，决定是否进入真正的 AI Loop 开发试跑。

判断条件：

1. 内置部门 contract 已清楚
2. 黄金路径现状已盘点
3. 至少有一个真实 proposal 和 project
4. Exit Evidence Bundle 已定义

如果满足，再进入：

1. admitted
2. AI Loop implement / self-review / cross-review / verify
3. ready-for-exit

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

建议严格按这个顺序做：

1. 冻结内置部门 contract
2. 跑 AI 情报室黄金路径现状审计
3. 识别第一个真实断点
4. 生成第一个系统改进 proposal 和 project
5. 固化准出证据包

不建议先做：

1. 自进化大 UI
2. 自动 merge
3. 自动 deploy
4. 全系统级 sweep

## 8. 试运行完成的判定标准

满足以下条件，才算“软件自进化试运行有效”：

1. 内置平台工程部门成为真实责任主体。
2. AI 情报室黄金路径有真实运行证据。
3. 至少一个真实问题被自动转成 proposal。
4. proposal 被自动转成 project。
5. project 有明确 test plan / rollback plan。
6. 准出证据包结构被固定下来。

## 9. 当前最先执行的具体任务

当前立刻执行的第一个任务应是：

> 内置平台工程部门 contract + AI 情报室黄金路径现状审计

这是所有后续代码改造前必须先拿到的事实基线。
