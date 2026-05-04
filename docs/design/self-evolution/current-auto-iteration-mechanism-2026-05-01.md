# 当前软件自迭代机制

**日期**: 2026-05-01
**状态**: 当前机制说明
**边界**: 本文只描述主软件自我开发、自我修复和自我改进的当前机制。业务上下文、Skill、Workflow 的改进属于业务能力进化，不归入 self-evolution。

## 1. 当前结论

当前项目已经形成一条可证明的软件自迭代骨架：

```text
主软件问题 / 主软件用户场景缺口 / CEO 开发命令
-> SystemImprovementSignal
-> SystemImprovementProposal
-> CEO 准入审批
-> 内置平台工程部 Project / Run
-> Codex CLI worktree runner
-> 测试与 evidence
-> proposal.status/testing/ready-to-merge
-> CEO / Ops 查看准出证据
```

当前自动边界截止于 `ready-to-merge` 证据聚合。merge / push / deploy / restart 是 CEO / Ops 准出后的人工或外部发布动作，不属于当前自动机制。

当前 `Codex CLI worktree runner` 作为自我软件开发执行器这条链已经真实跑通，并且已接入产品化主线：

```text
approved proposal
-> runPlatformEngineeringCodexTask()
-> normalized exitEvidence
-> CEO / Ops 准出视图
```

## 2. 责任主体

当前软件自我迭代的责任主体是内置平台工程部：

```text
departmentId = department:platform-engineering
workspace = $AG_GATEWAY_HOME/system-workspaces/platform-engineering/
```

平台工程部是普通 Department，不是新增的一套软件自迭代后端。

它复用：

1. Department
2. Project
3. Company Kernel
4. Approval
5. Scheduler
6. Knowledge / Memory
7. Ops
8. CEO Office

平台工程部负责：

1. 接 CEO 的主软件开发命令。
2. 接系统改进 proposal。
3. 观察项目 run 失败并生成改进信号。
4. 将 approved proposal 转成受控开发 Project。
5. 调用 Codex CLI 在隔离 worktree 中执行代码修改。
6. 产出准出 evidence。

平台工程部不负责：

1. 绕过 CEO 准入。
2. 直接改主仓库。
3. 自行合并主分支。
4. 自行发布或重启主软件。
5. 覆盖目标仓库自己的 `AGENTS.md`。

## 3. 输入来源

当前软件自迭代机制可以接收这些输入：

1. CEO 直接命令。
2. User Story 中的 `[不支持]` 主软件用户场景。
3. 被平台工程部观察的 Project 失败 run。
4. 主软件运行、构建、验证、调度或工作台链路暴露的问题。
5. protected core 相关风险。

protected core 当前包括：

1. scheduler
2. provider
3. approval
4. database
5. runtime
6. company API
7. 主软件执行链路

## 4. Proposal 主线

当前系统改进主线使用：

1. `SystemImprovementSignal`
2. `SystemImprovementProposal`
3. `ApprovalRequest`
4. `Project`
5. `Run`
6. `exitEvidence`

proposal 生命周期：

```text
generate / evaluate
-> approval-required
-> approve / reject
-> in-progress
-> testing
-> ready-to-merge
-> observe
```

当前规则：

1. high / critical proposal 必须有持久 approval metadata。
2. protected core 任务必须创建 approval request。
3. passed test evidence 不能绕过审批状态。
4. proposal 被 approve 后，会自动创建平台工程部 Project / Run 跟踪壳，并调用 Codex CLI worktree runner。
5. proposal 详情会聚合 `project / latestRun / codex / testing / mergeGate` 作为准出证据包。
6. auto merge / auto push / auto deploy API 不属于当前 proposal 主线。

## 5. 执行主线

当前代码级软件自迭代使用 Codex CLI worktree runner。

相关代码：

1. `src/lib/platform-engineering-codex-runner.ts`
2. `src/lib/bridge/codex-adapter.ts`
3. `src/lib/platform-engineering.ts`

执行路径：

```text
平台工程部任务
-> 选择 checkpoint / snapshot 基线
-> 创建独立 git worktree
-> 构造短 task packet
-> codex exec --cd <worktreePath> --sandbox workspace-write
-> 收集 changedFiles / disallowedFiles / validations
-> 写入 evidence JSON
```

运行资产：

```text
$AG_GATEWAY_HOME/system-workspaces/platform-engineering/worktrees/
$AG_GATEWAY_HOME/system-workspaces/platform-engineering/evidence/codex-runs/
```

当前执行合同：

1. 默认 `baseMode = checkpoint`。
2. 需要包含当前未提交状态时，使用 `baseMode = snapshot`。
3. 每次运行生成独立 `runId`。
4. 每次运行创建独立 worktree 和独立 `ai/platform-*` 分支。
5. task packet 只包含目标、allowlist、预期改动和验证命令。
6. Codex CLI 自己读取仓库、搜索文件并遵守目标仓库 `AGENTS.md`。
7. Codex CLI 不属于 Provider 层。
8. Codex adapter 优先选择成熟 `codex-cli x.y.z` 二进制。

## 6. Evidence 规则

当前 runner 会收集：

1. `baseSha`
2. `headSha`
3. `branch`
4. `worktreePath`
5. `changedFiles`
6. `disallowedFiles`
7. `scopeCheckPassed`
8. `diffCheckPassed`
9. `validations`
10. `evidencePath`

判失败的情况：

1. Codex CLI 非零退出。
2. `expectEdits = true` 但没有任何改动。
3. 改动超出 allowlist。
4. `git diff --check` 失败。
5. 调用方传入的验证命令失败。
6. evidence 无法写入。

判可进入准出的最低条件：

1. Codex CLI 执行成功。
2. `changedFiles` 符合预期。
3. `disallowedFiles = []`。
4. `git diff --check` 通过。
5. 验证命令通过。
6. evidence JSON 已写入平台工程部 workspace。
7. proposal 的 exit evidence 能被 CEO / Ops 消费。

## 7. 当前已验证机制

当前已经验证的机制包括：

1. 平台工程部 workspace bootstrap。
2. Department memory injection。
3. `native-codex -> pi-ai -> Claude Engine` 主线 run。
4. run/result/artifact 持久化。
5. Provider Adapter 与 ExecutionTool 边界收口。
6. Codex CLI `--cd <worktreePath> --sandbox workspace-write` 调用。
7. checkpoint / snapshot 执行基线。
8. no-edit 失败判定。
9. allowlist scope 判定。
10. `git diff --check` 判定。
11. runner evidence 写入平台工程部 workspace。
12. 临时 git repo 上真实 Codex CLI runner 端到端验证。
13. 本项目 snapshot worktree 上真实软件自开发验证：`self-software-dev-platform-engineering-path-constants` 只修改 `src/lib/platform-engineering.ts`，`disallowedFiles = []`，`git diff --check`、`npx eslint src/lib/platform-engineering.ts`、`npx tsc --noEmit` 均通过。
14. approved proposal 到 `runPlatformEngineeringCodexTask()` 的调度桥已经接入。
15. `exitEvidence.codex` 已包含 worktree、branch、changedFiles、scope、validation 和 evidencePath。
16. CEO Office 决策队列已接入软件自迭代决策项；准入、准出、阻塞处理都进入统一决策队列。
17. CEO Dashboard 的软件自迭代区域只作为证据 / 状态视图，不再作为第二套待办入口。
18. Ops 已提供准出证据视图，可查看 Codex worktree evidence 并对阻塞任务重跑 Codex。
19. Ops release gate 已接入：`preflight` 会从 Codex worktree 生成 patch，并对当前主仓执行 `git apply --check`。
20. CEO/Ops 可显式记录准出、已合并、已重启、观察开始和回滚状态；这些状态写入 `exitEvidence.releaseGate`。

## 8. 当前范围外能力

以下内容不声明为当前自动机制能力：

1. 静默自动 merge / push / deploy / restart。
2. 平台工程部 canonical workflow 对 runner 的更细粒度编排。
3. `contextDocumentPaths` 到平台工程部 workspace 的确定性 context snapshot / mirror。
4. 不经过 CEO/Ops 准出就修改主仓或重启主软件。

这些内容不是第二套机制，也不作为本文的当前可用能力描述。

产品化缺口见 [软件自迭代产品化缺口](</Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/self-evolution/software-self-iteration-productization-gap-2026-05-01.md>)。

## 9. 当前防重复口径

当前机制必须避免重复做同一件事。

创建新 proposal 前必须检查：

1. 是否已有同主题 open proposal。
2. 是否已有同主题 `in-progress / testing / ready-to-merge` 项目。
3. 是否已有同 `taskKey` 的平台工程 evidence。
4. User Story 对应场景是否已经是 `[支持]`。
5. 当前主仓库是否已有未提交改动覆盖同一目标。

当前去重键：

```text
sourceType + sourceId + normalizedGoal + affectedPaths
```

如果检测到重复：

1. 不创建新 proposal。
2. 把新信号追加到 existing proposal 的 evidenceRefs。
3. 如果原任务 blocked，进入 retry / follow-up，而不是新建并行任务。

## 10. 当前禁止事项

当前机制明确禁止：

1. 平台工程部直接改主仓库。
2. 把 Codex CLI 做成 Provider。
3. 给 Codex CLI 传超长上下文。
4. 没有 allowlist 就做高风险代码任务。
5. 没有 evidence 就进入准出。
6. 没有 CEO 准出就 merge / push / deploy / restart。
7. 用 passed test evidence 绕过 high / critical approval。
8. 在 CEO Office 里为软件自迭代建立第二套待办队列。

## 11. 文档维护口径

本文只记录当前软件自迭代机制。

更新规则：

1. 机制已经接通，更新本文。
2. 代码行为已验证，更新 `docs/PROJECT_PROGRESS.md`。
3. 架构事实稳定后，同步 `ARCHITECTURE.md`。
4. 一次性执行记录不写入本文。
