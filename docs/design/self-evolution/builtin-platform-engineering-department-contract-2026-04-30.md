# 内置平台工程部门 Contract

**日期**: 2026-04-30  
**状态**: Contract 基线，已按 2026-05-01 运行现状校准
**边界**: 本文冻结主软件自迭代责任部门的定义，并记录当前已落地的 Codex CLI worktree runner / evidence 基线；业务上下文、Skill、Workflow 的改进属于业务能力进化，不归入本 contract。

## 1. 定位

这个部门是主软件自迭代的默认责任主体。

它负责三类事情：

1. 接住 CEO 的主软件开发命令。
2. 持续观察被纳入范围的主软件项目、运行任务和系统运行信号。
3. 把真实断点转成 proposal、project、验证和准出证据。

它不是超级后门，也不是独立子系统。

它就是现有系统中的一个内置 `Department` 实例。

## 2. 设计结论

这个部门必须直接使用当前系统已有机制：

1. `DepartmentConfig / workspaceBindings / executionPolicy`
2. `Project / AgentRun / pipelineState`
3. `RunCapsule / MemoryCandidate / KnowledgeAsset`
4. `OperatingSignal / OperatingAgendaItem / CompanyOperatingDay`
5. `CompanyLoopPolicy / CompanyLoopRun / CompanyLoopDigest`
6. `SystemImprovementSignal / SystemImprovementProposal`
7. `BudgetPolicy / BudgetLedger / CircuitBreaker`
8. `Approval`

不新增：

1. 新的部门模型
2. 新的 memory 系统
3. 新的 loop 引擎
4. 新的 proposal 体系
5. 新的 project 体系

新增的只是一个内置实例、默认路由和更严的治理口径。

## 3. 内置实例

当前内置实例已经冻结为以下语义：

```json
{
  "departmentId": "department:platform-engineering",
  "name": "平台工程部",
  "type": "build",
  "description": "负责主软件核心、自迭代闭环、系统改进 proposal、受控开发与准出证据。",
  "skills": [
    {
      "skillId": "guarded-core-development",
      "name": "主软件受控开发",
      "category": "delivery"
    },
    {
      "skillId": "system-improvement-proposal",
      "name": "系统改进提案",
      "category": "platform-evolution"
    }
  ],
  "templateIds": [
    "development-template-1",
    "coding-basic-template"
  ],
  "workspaceBindings": [
    {
      "workspaceUri": "file://$AG_GATEWAY_HOME/system-workspaces/platform-engineering",
      "alias": "platform-engineering",
      "role": "primary",
      "writeAccess": true
    }
  ],
  "executionPolicy": {
    "defaultWorkspaceUri": "file://$AG_GATEWAY_HOME/system-workspaces/platform-engineering",
    "contextDocumentPaths": [
      "docs/design/self-evolution/README.md",
      "docs/design/self-evolution/current-auto-iteration-mechanism-2026-05-01.md",
      "ARCHITECTURE.md"
    ]
  }
}
```

`native-codex` 作为 Department 主线 provider 进入 Claude Engine / pi-ai；`codex` 不再写成部门 provider，而是在需要外部代码执行时作为 Claude Engine `ExecutionTool` 或平台工程部受控 runner 的 Codex CLI 执行工具使用。

## 4. 为什么用同一套地方

这个部门的结构化真相源应该继续留在现有系统里：

1. SQLite 持久化继续承载 `Project / Run / Proposal / Approval / Budget / Signal / Knowledge`。
2. 文件镜像继续走现有 workspace 语义。
3. 这个部门自己的文件资产放在 `AG_GATEWAY_HOME` 下的系统工作区，而不是单独造第二套存储。

已固定目录：

```text
$AG_GATEWAY_HOME/system-workspaces/platform-engineering/
$AG_GATEWAY_HOME/system-workspaces/platform-engineering/worktrees/
$AG_GATEWAY_HOME/system-workspaces/platform-engineering/evidence/codex-runs/
```

原因很直接：

1. 它属于系统自身，不属于 CEO 个人工作区。
2. 它需要和 runtime、scheduler、company-kernel 共用同一套存储与恢复路径。
3. 它仍然是现有 workspace 体系的一部分，不是平行机制。
4. 代码任务的临时 worktree 和准出证据已经落到这个 workspace 下，不再停留在抽象设想。

## 5. 它如何复用现有业务流

### 5.1 CEO 命令

CEO 发出主软件开发命令后，仍然走现有 CEO 路由和项目创建能力。

目标变化只有一件事：

1. 当命令被识别为主软件开发、修复、重构、运行治理、自迭代相关任务时，默认路由到这个部门。

### 5.2 运行观察

这个部门主动了解项目状态，不应靠新 watcher。

它应该复用当前链路：

1. scheduler 触发 run
2. run 写入 `RunCapsule`
3. `RunCapsule` 进入 `OperatingSignal / Agenda`
4. knowledge/memory 候选进入治理面
5. company loop 负责挑选 Top-N 信号与议程

### 5.3 proposal

主动向 CEO 提 proposal，不应开新通道。

直接复用：

1. `SystemImprovementSignal`
2. `SystemImprovementProposal`
3. `Approval`
4. CEO Office 中已有的 agenda / proposal 面板

### 5.4 project

proposal 被批准后，不应再手工重写一遍需求。

应该直接复用现有 `Project`：

1. proposal 提供标题、摘要、影响文件、测试计划、回滚计划
2. project 负责承接 AI Loop 开发
3. run 和验证证据继续落回现有 project / run / artifact 体系

## 6. 记忆与上下文归属

不引入新 memory。

这个部门的上下文和记忆应该拆成两层，且都用现有机制：

### 6.1 结构化层

继续使用：

1. `RunCapsule`
2. `MemoryCandidate`
3. `KnowledgeAsset`
4. `OperatingSignal`
5. `SystemImprovementProposal`
6. `Approval`
7. `BudgetLedger`

这些对象天然可被 CEO Office、Ops、Knowledge、Projects 共同消费。

### 6.2 文件层

继续使用：

1. 该部门 workspace 下的 `.department/config.json`
2. 该部门 workspace 下的 `.department/memory/`
3. project mirror
4. run artifacts
5. proposal / runbook / rollback 文档

## 7. 开关应该放哪里

不能藏在“Project 点部门再启用”的深路径里。

应该只用现有页面和现有对象扩展两个层级。

### 7.1 组织级开关

放在 `Settings -> 预算策略 / autonomy` 现有组织级策略入口。

组织级 policy metadata 使用以下语义：

1. `platformEngineeringEnabled`
2. `platformEngineeringObservationEnabled`
3. `platformEngineeringProposalEnabled`

这样仍然是同一套 autonomy policy，不是新设置系统。

### 7.2 项目级开关

放在 `Project` 的治理区。

项目级开关只定义两个语义：

1. `纳入平台工程部观察`
2. `允许平台工程部主动提案`

这里不新建独立表。

当前 `Project` 已经具备 `governance.platformEngineering`：

1. `observe`
2. `allowProposal`
3. `departmentId`
4. `source`
5. `updatedAt`

平台工程部 workspace 内创建的项目会默认开启观察和主动提案；由系统改进 proposal 自动创建的项目会带上 `source = proposal-created`。因此这里已经不是“缺少字段”，而是后续需要在具体项目与 UI 入口上把治理状态展示清楚。

## 8. AI Loop 与人类边界

这个部门是主软件自迭代的执行者，但不拥有最终合并权。

治理边界固定如下：

1. 人类负责准入
2. AI Loop 负责中间全过程
3. 人类负责准出

这个部门内部当前已经具备两层执行能力。

第一层是 Department / Project 主线：

1. 自主需求补全
2. 自主技术方案细化
3. 自主编码、自审、交叉审查、测试、补证据
4. 输出 merge / restart / release 决策包

第二层是已落地的 Codex CLI worktree runner：

1. `runPlatformEngineeringCodexTask()` 每次创建独立 git worktree 与独立 `ai/platform-*` 分支。
2. 支持 `checkpoint` 与 `snapshot` 两种执行基线。
3. Codex CLI 只在 worktree 内通过 `codex exec --cd <worktreePath> --sandbox workspace-write` 执行。
4. 运行前生成小 task packet，包含目标、allowlist、预期改动和验证命令。
5. 运行后收集 `changedFiles / disallowedFiles / git diff --check / validationCommands`。
6. `expectEdits = true` 但没有产生改动时，会生成失败证据。
7. evidence JSON 写入 `$AG_GATEWAY_HOME/system-workspaces/platform-engineering/evidence/codex-runs/`。

无论走哪一层，当前仍不自动 merge、push、restart 或 deploy。

## 9. 当前系统里的直接映射

当前代码已经具备 contract 底座：

1. `DepartmentConfig` 已支持 `departmentId / workspaceBindings / executionPolicy`
2. Company Kernel 已具备 `RunCapsule / Signal / Agenda / Loop / Proposal / Budget / Breaker`
3. `SystemImprovementProposal` 已具备 `affectedFiles / testPlan / rollbackPlan / branchName / linkedRunIds`
4. `Approval` 已能处理 self-improvement proposal 审批回调
5. `Project` 已能承接被路由的开发任务
6. 内置平台工程部 workspace 已通过 workspace catalog 注册，并会自动补齐 `.department/config.json`、rules、memory 和 context document paths
7. `Project.governance.platformEngineering` 已承载项目级观察 / 主动提案开关
8. 平台工程观察器已能把被观察项目的 `failed / blocked / timeout` run 转成 `SystemImprovementSignal`，并在允许提案时生成 `SystemImprovementProposal`
9. 系统改进 proposal 审批后已能自动创建平台工程部 Project 并派发首个 run
10. Codex CLI worktree runner 已具备隔离执行、范围检查、验证命令与 evidence JSON

这意味着我们现在缺的不是模型，也不是内置 owner，而是把真实业务断点稳定接到同一条 owner / project / evidence 主线上。

## 10. 当前明确缺口

要让这个 contract 继续从可运行变成可持续运行，还缺四个最小收口点：

1. `executionPolicy.contextDocumentPaths` 目前主要体现在 runtime read roots，还没有被确定性镜像或注入为 in-workspace context artifact。
2. 平台工程部 Codex CLI runner 已落地，但仍需要接入到已批准 proposal 的项目执行主线，而不是只停留在独立 helper / 探针路径。
3. 自动信号已有失败 run 与 User Story 缺口来源，但具体业务链路仍要逐条确认真实 scheduler run 是否稳定生成可消费的 signal / proposal。
4. 准出证据已能落地和展示，但 merge / restart / release 仍应保持人类准出后的显式动作，不进入自动化默认路径。

## 11. 当前使用口径

这个部门是主软件自迭代的主责任主体。

它不引入新机制，而是把现有机制全部挂到同一个内置部门语义下：

```text
CEO 命令 / 主软件项目异常 / 主软件用户场景缺口
-> 平台工程部
-> signal / agenda / proposal
-> project
-> AI Loop
-> 准出证据
-> merge / restart / observe
```

当前 contract 用来约束主软件自迭代链路：主软件运行、构建、验证或工作台链路暴露断点时，应能被解释为同一条 `signal -> proposal -> project -> runner evidence -> 准出包` 链路。
