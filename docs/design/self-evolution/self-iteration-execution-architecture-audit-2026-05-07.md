# Self-Iteration 执行链架构审计（2026-05-07）

## 1. 目的

这份文档只回答 4 个问题：

1. 最近这轮软件自迭代架构问题，是否由最近改动引入。
2. 前后两条执行链分别是什么。
3. 哪些改动方向是正确的，哪些方向是错误的。
4. 现在应该如何重新收口，避免继续在错误主线上补丁。

本文不记录临时修复方案，不作为 `PROJECT_PROGRESS` 的已完成实现记录。

## 2. 结论

结论很明确：

1. 当前最严重的问题，主要由 `2026-05-04` 的执行链切换引入。
2. 问题不在于 `codex-cli` 这个工具本身，而在于它被接入软件自迭代主线的方式错了。
3. 我们这几轮并不是“全部都改错了”。
4. 真正走偏的是“执行主线”，不是“治理主线”。

更准确地说：

- **治理主线多数方向是对的**
  - CEO 准入 / 准出双门
  - `controlState`
  - `DecisionTarget`
  - 系统改进 proposal 详情与审批收口
  - `releaseGate` / `preflight` / evidence bundle
- **执行主线在 2026-05-04 之后走偏**
  - 软件自迭代执行从 Agent runtime 主线切到了控制器直起 `codex exec`
  - 这导致状态、取消、观察器、evidence 全部开始分裂

## 3. 审计范围

本次对比的核心对象：

- 旧执行链：
  - `src/lib/company-kernel/self-improvement-execution.ts`
- 新执行链：
  - `src/lib/company-kernel/self-improvement-codex-execution.ts`
  - `src/lib/platform-engineering-codex-runner.ts`
- 相关收口层：
  - `src/lib/company-kernel/self-improvement-approval.ts`
  - `src/lib/company-kernel/self-improvement-runtime-state.ts`
  - `src/lib/company-kernel/platform-engineering-observer.ts`
  - `src/app/api/agent-runs/[id]/intervene/route.ts`

关键提交：

- `35d4c716` `chore: checkpoint self-evolution and platform updates`
- `130a8c26` `checkpoint: stabilize self-evolution execution boundary`

## 4. 前后执行链差异

### 4.1 切换前：软件自迭代走 Agent runtime 主线

切换前的软件自迭代主线是：

1. CEO 准入审批通过
2. `approveSystemImprovementProposal()`
3. `ensureSystemImprovementProjectLaunched()`
4. 创建平台工程 Project
5. `executeDispatch(...)`
6. 进入正常 Agent run / Project / pipeline 主线
7. 后续执行、状态推进、取消、run 生命周期都挂在 Agent runtime 上

这条链的代表文件：

- `src/lib/company-kernel/self-improvement-execution.ts`

它的核心特征：

- 软件自迭代仍然是一个“平台工程 Agent 任务”
- `codex-cli` 没有成为主执行链事实源
- `Project / Run` 是主运行事实
- Proposal 只是治理对象，不直接驱动底层 CLI 生命周期

### 4.2 切换后：控制器直接起 Codex worktree runner

`35d4c716` 之后，审批主线被切成：

1. CEO 准入审批通过
2. `approveSystemImprovementProposal()`
3. `runApprovedSystemImprovementCodexTask()`
4. `self-improvement-codex-execution.ts` 内部自己创建 tracking project / tracking run
5. 直接调用 `runPlatformEngineeringCodexTask()`
6. `platform-engineering-codex-runner.ts` 直接调用 `codexExec()`
7. 执行完成后，再反向补 proposal / run / project / evidence / preflight

这条链的代表文件：

- `src/lib/company-kernel/self-improvement-codex-execution.ts`
- `src/lib/platform-engineering-codex-runner.ts`

它的本质变化不是“换了一个执行器”，而是：

- 软件自迭代不再以 Agent runtime 为主线
- 而是以“控制器 + worktree runner + CLI”作为主线

## 5. 最近改动到底改对了什么

这部分必须单独澄清。最近几轮不是所有改动都错了。

### 5.1 治理层改动，大方向是对的

以下方向是正确的，而且应该保留：

1. **CEO 准入 / 准出双门**
   - 人类只在准入和准出参与
   - 中间 AI 失败态不应反复进入 CEO 队列

2. **`controlState` 作为 CEO / Ops 控制面**
   - 用 `stage/currentOwner/nextAction/pageMode` 收口展示
   - 前端不再自己拼 proposal / run / release gate 原始状态

3. **`DecisionTarget -> 业务详情` 收口**
   - 决策队列与具体业务对象解绑是对的
   - Approval request 不应该承担完整业务上下文

4. **系统改进详情收口成决策页**
   - 技术证据下沉
   - 管理动作上浮
   - 对 CEO 不再暴露大片低层技术叙事

5. **`releaseGate / preflight / patch evidence`**
   - 代码准出需要显式 evidence
   - patch / apply-check / validation 这些事实应该存在

6. **平台工程 worktree runner 作为代码工具链**
   - worktree 隔离
   - scope check
   - diff check
   - validation evidence
   这些能力本身是对的

### 5.2 这些改动不是问题根源

下面这些不是当前架构混乱的主因：

- `controlState`
- `DecisionTarget`
- CEO/Ops 页面收口
- `releaseGate`
- `preflight`
- user-story-gap -> signal -> proposal

它们有实现细节可以再优化，但不是这次执行失控的根问题。

## 6. 最近改动到底改错了什么

### 6.1 最大错误：执行主线从 Agent runtime 切到了控制器直起 CLI

这是本次问题的根。

切换后，软件自迭代执行不再是：

- 平台工程 Agent 自己做事

而变成了：

- 控制器直接调 `codex exec`
- 再把结果缝回 run/project/proposal

这一步带来的后果是结构性的，不是小 bug：

1. run 状态不再等于真实执行状态
2. child process 生命周期不再挂在 Agent 主线
3. cancel 无法真正作用到底层执行
4. 观察器看见的只是“补出来的 run”，不是主线 run
5. proposal/runtime/evidence 开始互相倒推，事实源失真

### 6.2 错误二：把 tracking run 伪装成 `prompt`

在 `self-improvement-codex-execution.ts` 里，tracking run 被创建为：

- `executorKind: 'prompt'`
- `provider: 'codex-cli'`

这是一种过渡性伪装，不是合理建模。

它直接导致：

1. `/api/agent-runs/:id/intervene` 走错取消分支
2. `cancelPromptRun()` 只会取消 Agent session，不会碰真实 CLI child process
3. UI、runtime、intervene 路由对这条 run 的理解都不准确

这不是因为 `codex-cli` 应该升级成一级执行器，而是因为：

- 当前实现既没有让它成为真正 Agent tool session
- 也没有保留它只作为 Agent 内工具的边界

结果变成了一个介于两者之间的伪对象。

### 6.3 错误三：观察器递归生成新 self-improvement proposal

旧链路里，平台工程 project governance 会显式记录：

- `systemImprovementProposalId`

旧文件：

- `src/lib/company-kernel/self-improvement-execution.ts`

新链路里，`self-improvement-codex-execution.ts` 的 `buildProposalCreatedGovernance()` 没把这个事实带过去。

后果：

1. observer 无法稳定区分：
   - 普通平台工程失败
   - self-improvement 自己执行失败
2. self-improvement run fail 后，又会被当成新的平台工程失败信号
3. 然后生成新的 self-improvement proposal

这是一条错误的自反递归链。

### 6.4 错误四：旧 evidence 被当成当前运行事实

新链路里存在这样的逻辑：

- proposal metadata 中的 `codexRunnerEvidence`
- `codexEvidencePath`
- `codexWorktreePath`
- `codexBranch`

既是某次执行的结果物，又被拿来参与“当前执行态”判断。

后果：

1. rerun 后旧 evidence 容易污染当前状态
2. `already-running` 这种语义开始从旧结果物倒推出“当前在跑”
3. 运行态不再只由活跃 run / project 决定

这是运行态建模错误，不是展示层错误。

## 7. 为什么会让人感觉“改了十几轮，越改越乱”

因为前面很多轮在修的是**治理层表现**，但底层执行主线已经偏了。

具体表现是：

1. 决策队列、审批页、Ops 收口这些工作都在继续变好
2. 但一旦进入真实软件自迭代执行，就会暴露底层执行模型失真
3. 于是上层每修一轮，下一轮又被底层执行链拉回去

所以这不是“我们前面所有工作都没价值”，而是：

- 上层治理收口在往对的方向走
- 但底层执行主线已经在 2026-05-04 被切偏了

## 8. 旧链和新链，哪个更好

### 8.1 旧链的优点

旧链的优点是：

1. 执行主线在 Agent runtime 里
2. `Project / Run` 是天然事实源
3. cancel、观察器、run 生命周期都挂在同一套主线
4. 软件自迭代本质上还是“平台工程 Agent 任务”

### 8.2 旧链的缺点

旧链也有明显不足：

1. 缺少明确 worktree patch evidence
2. scope/diff/validation 证据不够强
3. 准出链没有后来这么清晰
4. `launchStatus` 这类解释型状态当时就已经存在

所以旧链不是“完美”，只是**执行边界更正确**。

### 8.3 新链的优点

新链不是一无是处。它带来了这些真实改进：

1. worktree 隔离执行
2. scope / diff / validation evidence 更强
3. preflight / patch / release gate 能真正落地
4. 平台工程代码执行证据比旧链更可审计

### 8.4 新链的致命问题

新链致命的问题不是代码质量差，而是**把 tool runner 提升成了实际主执行链**。

所以公平结论是：

- **旧链的执行主线正确**
- **新链的证据能力更强**
- **最应该保留的是新链的 worktree/evidence 能力**
- **最应该回退的是“控制器直接起 CLI 作为主执行链”这一步**

也就是说：

> 不是回到旧链的全部，而是回到旧链的主线边界，同时保留新链的 evidence 能力。

## 9. 哪些代码应该被视为“正确资产”

应该保留和复用的资产：

1. `platform-engineering-codex-runner.ts`
   - 作为代码执行工具链能力
   - 不是作为治理主线控制器

2. `releaseGate`
   - 作为准出证据与发布前检查机制

3. `controlState`
   - 作为 CEO/Ops 控制面读模型

4. `DecisionTarget`
   - 作为决策深链与业务对象定位能力

5. 双门审批
   - 准入 / 准出

这些都不是错的，不应该因为执行链走偏而一起推翻。

## 10. 哪些代码应该被视为“错误收口”

应该被视为方向错误的部分：

1. `self-improvement-codex-execution.ts` 作为软件自迭代主执行控制器
2. tracking run 伪装成 `executorKind='prompt'`
3. 用 proposal metadata 上的 Codex evidence 倒推当前运行态
4. self-improvement fail 后继续走普通平台工程失败观察与提案生成

## 11. 重新收口时应坚持的原则

重新收口时，原则应该非常简单：

1. **软件自迭代仍然是 Agent 主线任务**
2. **`codex-cli` 仍然只是 Agent 可调用工具**
3. **执行判断者是 Agent，不是 CLI**
4. **真实 child process 生命周期需要挂到 Agent 主线可取消对象上**
5. **self-improvement fail 只回写原 proposal，不递归再提新 self-improvement proposal**
6. **evidence 只是结果物，不是运行态事实源**

## 12. 最终判断

这次不是“全部乱改了”，也不是“我们白做了十几轮”。

更准确的判断是：

1. 我们在治理层做了大量正确收口。
2. 2026-05-04 之后，执行层主线被切错了。
3. 这个错误不是 `codex-cli` 工具本身的问题，而是它被放错了位置。
4. 现在要修的，不是推翻所有治理层成果，而是把执行主线重新挂回 Agent runtime。

一句话收口：

> 这轮真正的问题，不是“用了 Codex CLI”，而是“让控制器代替 Agent 主线直接管理 Codex CLI”。
