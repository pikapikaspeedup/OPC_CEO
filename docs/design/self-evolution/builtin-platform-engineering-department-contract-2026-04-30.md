# 内置平台工程部门 Contract

**日期**: 2026-04-30  
**状态**: Contract 基线  
**边界**: 本文冻结软件自进化主责任部门的定义，只复用现有 Department / Project / Company Kernel / Approval / Scheduler / Knowledge 机制，不新增第二套运行模型。

## 1. 定位

这个部门是软件自进化的默认责任主体。

它负责三类事情：

1. 接住 CEO 的主软件开发命令。
2. 持续观察被纳入范围的项目、定时任务和系统运行信号。
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

建议冻结为以下实例：

```json
{
  "departmentId": "department:platform-engineering",
  "name": "平台工程部",
  "type": "build",
  "description": "负责主软件核心、自进化闭环、运行治理、系统改进 proposal 与受控开发交付。",
  "provider": "codex",
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
      "docs/design/self-evolution/trial-run-action-plan-2026-04-30.md",
      "ARCHITECTURE.md"
    ]
  }
}
```

## 4. 为什么用同一套地方

这个部门的结构化真相源应该继续留在现有系统里：

1. SQLite 持久化继续承载 `Project / Run / Proposal / Approval / Budget / Signal / Knowledge`。
2. 文件镜像继续走现有 workspace 语义。
3. 这个部门自己的文件资产放在 `AG_GATEWAY_HOME` 下的系统工作区，而不是单独造第二套存储。

建议目录：

```text
$AG_GATEWAY_HOME/system-workspaces/platform-engineering/
```

原因很直接：

1. 它属于系统自身，不属于 CEO 个人工作区。
2. 它需要和 runtime、scheduler、company-kernel 共用同一套存储与恢复路径。
3. 它仍然是现有 workspace 体系的一部分，不是平行机制。

## 5. 它如何复用现有业务流

### 5.1 CEO 命令

CEO 发出主软件开发命令后，仍然走现有 CEO 路由和项目创建能力。

目标变化只有一件事：

1. 当命令被识别为主软件开发、修复、重构、运行治理、自进化相关任务时，默认路由到这个部门。

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

建议作为现有组织级 policy metadata 挂载：

1. `platformEngineeringEnabled`
2. `platformEngineeringObservationEnabled`
3. `platformEngineeringProposalEnabled`

这样仍然是同一套 autonomy policy，不是新设置系统。

### 7.2 项目级开关

放在 `Project` 的治理区。

建议只定义两个语义：

1. `纳入平台工程部观察`
2. `允许平台工程部主动提案`

这里不建议新建独立表。

当前 `Project` 结构里还没有通用 metadata / governance 容器，所以后续应优先做最小扩展，把这两个开关挂到现有 project record 上，而不是开新对象。

## 8. AI Loop 与人类边界

这个部门是软件自进化的执行者，但不拥有最终合并权。

治理边界固定如下：

1. 人类负责准入
2. AI Loop 负责中间全过程
3. 人类负责准出

这个部门内部应默认使用：

1. 自主需求补全
2. 自主技术方案细化
3. worktree / branch / 临时 HOME / 临时 DB 隔离执行
4. 自主编码、自审、交叉审查、测试、补证据
5. 输出 merge / restart / release 决策包

## 9. 当前系统里的直接映射

当前代码已经具备大部分 contract 底座：

1. `DepartmentConfig` 已支持 `departmentId / workspaceBindings / executionPolicy`
2. Company Kernel 已具备 `RunCapsule / Signal / Agenda / Loop / Proposal / Budget / Breaker`
3. `SystemImprovementProposal` 已具备 `affectedFiles / testPlan / rollbackPlan / branchName / linkedRunIds`
4. `Approval` 已能处理 self-improvement proposal 审批回调
5. `Project` 已能承接被路由的开发任务

这意味着我们现在缺的不是模型，而是把这个内置实例真正接到现有路由上。

## 10. 当前明确缺口

要让这个 contract 变成真实运行，还缺四个最小收口点：

1. 当前 departments 主入口仍然偏 workspace-scoped，内置部门实例还没有被正式注册为组织级默认部门。
2. 当前 `Project` 还没有项目级观察 / 主动提案的治理字段。
3. 当前 `SystemImprovementSignal` 主要还是手工 API 或测试驱动，尚未从真实运行自动收口。
4. 当前 `SystemImprovementProposal -> Project` 还没有自动创建闭环。

## 11. 结论

这个部门应该成为软件自进化的主责任主体。

但它成立的前提不是再造新机制，而是把现有机制全部挂到同一个内置部门语义下：

```text
CEO 命令 / 项目异常 / 用户场景缺口
-> 平台工程部
-> signal / agenda / proposal
-> project
-> AI Loop
-> 准出证据
-> merge / restart / observe
```

下一步不该再讨论“要不要新机制”，而是围绕这个 contract 做真实试运行和断点调试。
