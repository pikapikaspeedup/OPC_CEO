# 软件自迭代产品化缺口

**日期**: 2026-05-01
**状态**: 已完成第一段产品化接线，剩余为准出后发布治理
**边界**: 本文只描述主软件自迭代从“runner 能跑”到“产品闭环可用”之间缺少的组件和可视化。不讨论业务上下文、Skill、Workflow 的业务能力进化。

## 1. 当前结论

当前 `Codex CLI worktree runner` 作为自我软件开发执行器这条链已经真实跑通，并且能产出可准出的 evidence。

已经证明的事实：

1. 能从当前仓库生成 snapshot 执行基线。
2. 能创建隔离 git worktree 和独立 `ai/platform-*` 分支。
3. 能调用成熟 Codex CLI 在 worktree 内真实改代码。
4. 能限制 allowlist，识别越界改动。
5. 能执行 `git diff --check` 和调用方验证命令。
6. 能把 evidence JSON 写入平台工程部 workspace。

第一段产品化接线已经完成：

```text
approved proposal
-> runPlatformEngineeringCodexTask()
-> normalized exitEvidence
-> CEO / Ops 准出视图
-> 人类确认 merge / restart
```

当前仍不自动 merge / restart；准出后的发布动作仍需要 CEO / Ops 显式确认。

## 2. 关键组件状态

### 2.1 董事长 / CEO 审批待办

已接入 CEO Office 现有决策队列。软件自迭代不建立第二套待办；所有需要 CEO 动作的 proposal 进入统一决策队列。

当前决策队列展示：

1. 待准入 proposal。
2. 已批准但未启动执行的 proposal。
3. 正在由平台工程部执行的 proposal。
4. 已生成 evidence、等待准出的 proposal。
5. blocked / failed / needs-retry proposal。

每个决策卡片至少展示：

1. 目标摘要。
2. 来源：CEO 命令、主软件用户场景缺口、运行失败、protected core 风险。
3. 风险等级。
4. 是否触及 protected core。
5. 预计影响文件。
6. allowlist。
7. 验证命令。
8. 回滚说明。
9. 当前建议动作：准入审批、进入准出、处理阻塞、打开 Ops 证据视图。

CEO Dashboard 的软件自迭代区域只保留证据和状态：

1. Codex worktree 执行状态。
2. 分支、worktree、changed files。
3. scope / validation / merge gate。
4. 关联项目入口。

### 2.2 Proposal 到 runner 的调度桥

已补受控调度桥：

```text
SystemImprovementProposal(approved)
-> build task packet
-> resolve baseMode
-> resolve allowlist
-> resolve validationCommands
-> runPlatformEngineeringCodexTask()
-> persist runner evidence
-> sync proposal exitEvidence
```

当前调度桥负责：

1. 去重：同一 proposal 不重复启动 runner。
2. 锁定：同一 affectedPaths 不并行执行冲突任务。
3. 风险校验：protected core 必须已有审批事实。
4. 输入收敛：不把长文档塞给 Codex CLI，只传短 task packet。
5. 输出归一：runner evidence 进入 proposal / project / run 的统一证据结构。

### 2.3 Evidence 正规化模型

已把 runner evidence 规范成可消费对象：

1. `summary`：一句话说明本轮改了什么。
2. `worktree`：路径、分支、baseMode、baseSha、snapshotSha。
3. `scope`：changedFiles、allowedPathPrefixes、disallowedFiles、scopeCheckPassed。
4. `quality`：diffCheckPassed、validationCommands、validation outputs。
5. `risk`：protected core、回滚方式、是否需要人工二次审查。
6. `decision`：blocked、testing、ready-to-merge、needs-retry。
7. `links`：proposal、project、run、evidence JSON、diff view。

### 2.4 Project / Run 状态同步

已能从 evidence 自动推进，不再靠人读 JSON 文件判断。

状态同步口径：

```text
runner started -> project run in-progress
runner evidence generated -> testing
all validations passed + scope passed -> ready-to-merge
validation failed / scope failed / no expected edits -> blocked
human requests retry -> needs-retry
human exits -> observing
```

### 2.5 CEO / Ops 准出视图

已补 CEO 待办和 Ops 准出证据视图。准出不是一个按钮，而是一个证据包工作台。

CEO 需要看：

1. 为什么要改。
2. 改了哪些文件。
3. 是否越界。
4. 测试是否通过。
5. 是否有回滚方案。
6. 是否可以合并。

Ops 需要看：

1. worktree 是否还存在。
2. 分支是否干净。
3. 验证命令和日志。
4. 是否需要重启。
5. 如果重启，影响哪些 scheduler / worker / runtime。
6. 是否有 stale worktree / stale evidence 需要清理。

### 2.6 人类准出后的 merge / restart 门

当前已把人工准出动作产品化为 Ops release gate。

release gate 已提供：

1. 查看 diff。
2. 查看测试输出。
3. 查看回滚步骤。
4. 生成 merge 指令或 PR。
5. 标记已合并。
6. 标记已重启。
7. 标记观察期开始。

这些动作必须显式触发，不能由 runner 自动完成。当前 `preflight` 会从 Codex worktree 生成 patch，并在主仓执行 `git apply --check`；`merge/restart/rollback` 记录为 CEO/Ops 准出后的状态与命令包，不静默修改主仓。

## 3. 最佳可视化形态

### 3.1 董事长首页：统一决策队列

软件自迭代不建立第二套待办。所有需要 CEO 动作的 proposal 都进入 CEO Office 现有统一决策队列。

推荐布局：

1. 顶部：待准入、执行中、待准出、blocked 四个计数。
2. 主区：统一决策队列中的 proposal 决策卡片。
3. 点击待准入项进入 approval inbox。
4. 点击待准出、testing、blocked 项进入 Ops 准出证据视图。
5. CEO Dashboard 软件自迭代区域只展示证据和状态，不承担决策队列职责。

### 3.2 Proposal 详情：单条链路时间线

每个 proposal 详情页应展示：

```text
Signal
-> Proposal
-> Approval
-> Platform Engineering Project
-> Runner Worktree
-> Evidence
-> Ready-to-merge
-> Human merge / restart
-> Observe
```

每个节点都要有状态、时间、产物链接和失败原因。

### 3.3 Evidence Drawer：准出证据包

准出证据包应是一个 drawer，不应该散落在多个页面。

核心区块：

1. Diff summary。
2. Changed files。
3. Disallowed files。
4. Validation results。
5. Codex output 摘要。
6. Worktree / branch / snapshot 信息。
7. Risk / rollback。
8. CEO / Ops 最终动作。

### 3.4 Ops：运行与清理视图

Ops 需要一个偏运维的列表：

1. 所有平台工程 worktree。
2. 所有 evidence bundle。
3. 过期 worktree。
4. blocked runner。
5. 等待人工 merge 的 ready-to-merge proposal。
6. merge 后待 restart / observe 的任务。

## 4. 当前剩余补齐路径

第一段四个产品组件已经补齐：

1. `ApprovedProposalRunnerDispatcher`
   - 已把 approved proposal 转成 `runPlatformEngineeringCodexTask()` 输入。
2. `SelfIterationEvidenceBundle`
   - 已把 runner JSON 归一到 proposal / project / run 可消费结构。
3. `CEO Decision Queue Integration`
   - 已把软件自迭代准入、准出和阻塞处理接入 CEO Office 统一决策队列。
4. `Ops Exit Evidence View`
   - 已补 worktree / evidence / validation / merge gate 运维视图。

当前剩余是准出后的人工动作产品化：

1. 查看 diff。
2. 生成 merge / PR 指令。
3. 标记已合并。
4. 标记已重启。
5. 标记进入观察期。

## 5. 当前不做

当前仍不做：

1. 自动 merge。
2. 自动 push。
3. 自动 deploy。
4. 自动 restart。
5. 无 allowlist 的大范围代码修改。
6. 无 evidence 的准出。
7. 把业务能力进化混入 self-evolution。
