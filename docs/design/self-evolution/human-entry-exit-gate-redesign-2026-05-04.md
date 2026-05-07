# 软件自迭代准入 / 准出重构方案

**日期**: 2026-05-04  
**状态**: 设计中  
**边界**: 本文只讨论主软件自迭代的准入 / 准出治理、AI 自修闭环和 CEO/Ops 的产品化承载。不讨论 AI 情报工作室等业务能力进化。

---

## 1. 目标

把当前“系统改进详情页 + 决策队列 + release gate”重构成一条更严格的治理主线：

```text
人类只做准入与准出
AI 负责执行、修复、重试、验证、补证据
CEO 看到的是产品化审批页
Ops 看到的是内部运行与异常页
```

目标不是让 CEO 理解 patch、worktree、diff 或 trailing whitespace，而是让 CEO 只判断：

1. 这个提升解决了什么问题
2. 会给系统带来什么能力变化
3. 风险是否可接受
4. AI 是否已经把所有技术问题处理完
5. 现在是否批准进入主线

---

## 2. 当前问题

### 2.1 人类决策对象错位

当前 CEO 待决策页里混入了大量 AI 中间态：

1. `approved`
2. `testing`
3. `mergeGate.ready-to-merge`
4. `mergeGate.blocked`
5. `releaseGate.preflight-failed`

这会导致 CEO 面板既像审批台，又像技术告警台。

### 2.2 后端状态语义冲突

当前 proposal 可能同时表现为：

1. `proposal.status = ready-to-merge`
2. `releaseGate.status = preflight-failed`

这说明：

1. proposal 主状态仍在表达“可进入准出”
2. release gate 又在表达“当前其实还不能准出”

两层状态没有统一口径。

### 2.3 release gate 没有 AI 自修层

当前 `preflight` 检查失败后，系统会直接把失败抛给 CEO/Ops 页面。

对于这类问题：

1. trailing whitespace
2. Markdown 文档补丁格式
3. patch regenerate
4. 轻量 lint / formatting

系统本应先自动修复，而不是上浮给人。

### 2.4 页面承载错位

当前“待决策点击出来的页面”本质还是一个技术详情页。

默认可见区虽然已经多轮收口，但仍然在表达：

1. 系统改进对象
2. 执行状态
3. release gate 失败项
4. 技术证据入口

这仍然不是 CEO 的审批工作台。

---

## 3. 重构原则

### 3.1 人类只做两次动作

1. **准入**
   - 是否允许这条提升进入平台工程执行
2. **准出**
   - AI 已经把所有技术问题处理干净后，是否允许进入主线

除这两次动作外，人类不参与：

1. patch 格式修正
2. 失败重跑
3. scope / diff / apply 问题定位
4. 补测试命令
5. 修 trailing whitespace

### 3.2 CEO 页面只表达产品化审批信息

CEO 准入 / 准出页默认只呈现：

1. 这次提升解决的问题
2. 带来的能力变化
3. 影响范围与风险
4. AI 是否已经跑完并处理完所有技术问题
5. 当前审批动作

不默认呈现：

1. patch 路径
2. worktree 路径
3. 命令行
4. diff check 失败
5. apply check 失败
6. 技术日志细节

### 3.3 Ops 页面负责运行与异常

Ops 页面应该承接：

1. AI 正在重试什么
2. 哪些任务自动修复失败
3. 哪些任务被 policy 阻塞
4. 哪些任务达到最大重试预算
5. 哪些任务需要人工介入调查

这类页面服务的是运维和系统治理，不是 CEO 审批。

### 3.4 准出只在“无技术问题”时出现

准出审批页只允许在以下条件同时满足时出现：

1. scope 通过
2. diff check 通过
3. apply check 通过
4. validation 通过
5. 测试证据通过
6. rollback 具备
7. release preflight 通过
8. AI 自动修复预算已清零或不再需要

如果以上任一条件不满足，这条提升不应进入 CEO 准出待办。

### 3.5 必要逻辑、可下沉逻辑与应删除旧逻辑

#### 必须保留

1. `SystemImprovementProposal`
   - 继续作为软件自迭代的治理对象，承载问题、目标、范围、风险、计划和最终准出证据。
2. 准入审批
   - `approval-required -> approved / rejected` 必须保留。
3. AI 执行与验证证据
   - 平台工程项目、run、Codex evidence、测试证据、merge gate、release gate 都必须保留。
4. 严格发布检查
   - scope、diff、apply、test、rollback、restart/health check 这些检查不能放松。

#### 应下沉到 AI / Ops 内部

以下能力保留，但不再上浮给 CEO 审批页：

1. `git diff --check`
2. `git apply --check --whitespace=error-all`
3. patch 路径 / worktree 路径
4. release command bundle
5. 详细失败检查项
6. Codex runner 的技术输出

这些信息属于内部执行质量与发布卫生，不属于 CEO 决策对象。

#### 当前应删除的旧逻辑

1. 前端自行猜测“是否需要人类决策”
   - 不能再通过 `proposal.status + mergeGate + releaseGate` 拼出待决策队列。
2. `proposal.status` 同时承担治理态和执行态
   - `testing / ready-to-merge / preflight-failed` 不应再决定 CEO 队列。
3. `mergeGate.ready-to-merge` 直接等于“进入 CEO 待决策”
   - 这是错误上浮。
4. `preflight-failed` 直接进入 CEO 页面
   - 失败项应先留在 AI / Ops 内部闭环。
5. 待决策页默认展示技术失败项、命令行和 patch 细节
   - CEO 页面只看产品化审批信息。

#### 第一批代码改动的收敛范围

本轮先做最小而正确的一批：

1. 新增 `humanGate`
2. 新增 `automationState`
3. CEO 队列只看 `humanGate`
4. 修正 `ready-to-merge + preflight-failed` 的状态冲突
5. 待决策抽屉改成准入 / 准出审批页，不再把 AI 中间失败态展示成 CEO 决策

自动修复、失败分类与重试预算仍保留在下一批实现中，不在本轮一次性混入。

#### 第二批代码改动的收敛范围

在第一批双门状态机之后，第二批只补一层最小 auto-remediation：

1. `releaseGate.failureCategory`
2. `releaseGate.remediationStatus`
3. `releaseGate.remediationAttempts`
4. `releaseGate.remediationSummary`
5. `preflight` 内联修复确定性的 trailing whitespace，并立即重跑 preflight

这一批仍然不引入新的长循环 worker，也不做自动 merge / push / deploy。

---

## 4. 目标状态机

建议把“Proposal 生命周期”和“AI 内部运行态”分开。

### 4.1 Proposal 生命周期

Proposal 生命周期只表达业务治理节点：

```text
draft
-> approval-required
-> approved
-> published
-> observing
-> rolled-back / rejected
```

这里不再把 `testing`、`ready-to-merge`、`preflight-failed` 这类内部执行态塞进 proposal 主状态。

### 4.2 AI 内部运行态

新增独立的 automation state：

```text
queued
-> executing
-> validating
-> remediating
-> blocked
-> exit-ready
```

语义：

1. `queued`
   - 已批准，等待执行
2. `executing`
   - 正在跑平台工程任务
3. `validating`
   - 正在做测试、scope、diff、apply、release preflight
4. `remediating`
   - 发现可自动修复问题，AI 正在自修
5. `blocked`
   - 自动修复预算耗尽，或碰到 policy / conflict / hard failure
6. `exit-ready`
   - 全部技术问题已清零，可以进入准出审批

### 4.3 Human Gate

新增独立的人类门状态：

```text
none
entry-approval-required
exit-approval-required
```

规则：

1. `entry-approval-required`
   - high / critical
   - protected core
   - 或 CEO 指定必须准入
2. `exit-approval-required`
   - automation state = `exit-ready`
3. 其他一律 `none`

CEO 决策队列只看这个字段，不再从 `proposal.status + mergeGate + releaseGate` 猜。

---

## 5. release gate 重构

### 5.1 失败分类

对 `preflight` 失败增加分类器：

1. `auto-fixable`
   - trailing whitespace
   - 文档 patch 格式问题
   - patch regenerate
   - 轻量 lint/format 失败
2. `quality-blocking`
   - tests failed
   - validation failed
   - restart / health check failed
3. `policy-blocking`
   - scope 越界
   - rollback 缺失
   - apply conflict
   - protected area violation
4. `infra-blocking`
   - CLI / workspace / filesystem / process 异常

### 5.2 自动修复闭环

`preflight` 不再直接产出“人类待决策”，而是：

```text
preflight failed
-> classify failures
-> if all auto-fixable:
     run remediation task
     rerun preflight
-> if passed:
     exit-ready
-> if retries exhausted:
     blocked
```

### 5.3 重试预算

建议新增：

1. `maxRemediationAttempts`
2. `remediationAttemptsUsed`
3. `lastRemediationReason`
4. `lastRemediationAt`

默认策略：

1. auto-fixable：最多 2~3 次
2. quality-blocking：最多 1 次重跑验证
3. policy-blocking：不自动重试，直接转 `blocked`

### 5.4 准出门收口

只有当：

1. `preflightStatus = passed`
2. `automationState = exit-ready`
3. `humanGate = exit-approval-required`

这条任务才进入 CEO 的“准出待办”。

---

## 6. CEO / Ops 承载重构

### 6.1 CEO 待决策队列

当前队列过滤规则要删除：

1. `proposal.status === approved`
2. `proposal.status === testing`
3. `mergeGate.status === blocked`
4. `mergeGate.status === ready-to-merge`
5. `releaseGate.status === preflight-failed`

改成只展示：

1. `humanGate = entry-approval-required`
2. `humanGate = exit-approval-required`

### 6.2 CEO 准入页

默认显示：

1. 这次提升解决什么问题
2. 为什么现在值得做
3. 风险等级
4. 影响范围
5. 批准后 AI 会自动做什么

动作：

1. 批准进入执行
2. 暂不推进
3. 拒绝

### 6.3 CEO 准出页

默认显示：

1. 这次提升解决了什么问题
2. 带来了什么能力变化
3. 影响范围与风险
4. AI 已完成哪些验证
5. 当前是否已达到可合入标准

动作：

1. 批准合入
2. 暂缓合入
3. 退回 AI 继续打磨

这里的“退回 AI 继续打磨”应表达产品意图，例如：

1. 价值不够大
2. 范围过宽
3. 风险不可接受
4. 当前优先级不足

而不是让 CEO 处理技术细节。

### 6.4 Ops 异常页

Ops 只看：

1. `automationState = blocked`
2. `remediating` 超时
3. infra / policy / quality 异常
4. 重试预算耗尽

Ops 页面默认可以看技术证据、命令、patch、worktree 和失败日志。

---

## 7. 数据模型调整

建议在 `SystemImprovementProposal` 上新增：

```ts
humanGate?: {
  state: 'none' | 'entry-approval-required' | 'exit-approval-required';
  reason?: string;
  summary?: string;
  updatedAt: string;
}

automationState?: {
  status: 'queued' | 'executing' | 'validating' | 'remediating' | 'blocked' | 'exit-ready';
  reason?: string;
  updatedAt: string;
}

remediation?: {
  attemptsUsed: number;
  maxAttempts: number;
  lastFailureClass?: 'auto-fixable' | 'quality-blocking' | 'policy-blocking' | 'infra-blocking';
  lastFailureSummary?: string;
  lastAttemptAt?: string;
}
```

建议在 `SystemImprovementReleaseGateSnapshot` 上新增：

```ts
failureClass?: 'auto-fixable' | 'quality-blocking' | 'policy-blocking' | 'infra-blocking';
readyForHumanExit?: boolean;
autoRemediationTriggered?: boolean;
autoRemediationRunId?: string;
```

---

## 8. 后端实现改动

### 8.1 `self-improvement-runtime-state.ts`

目标：

1. 不再让 `mergeGate.ready-to-merge` 直接推导出 proposal `ready-to-merge`
2. 把 `releaseGate` 结果纳入统一状态机
3. 统一推导：
   - `automationState`
   - `humanGate`

建议：

1. 弱化 `deriveProposalStatus()`
2. 新增：
   - `deriveAutomationState()`
   - `deriveHumanGate()`
3. `proposal.status` 只保留生命周期节点

### 8.2 `self-improvement-release-gate.ts`

目标：

1. preflight 不再直接产出 CEO 决策信号
2. 增加失败分类器
3. 自动修复后重跑

建议新增：

1. `classifyPreflightFailures()`
2. `shouldAutoRemediate()`
3. `runAutoRemediation()`
4. `rerunPreflightAfterRemediation()`

### 8.3 `self-improvement-codex-execution.ts`

目标：

1. 支持 remediation task
2. 支持带 remediation reason 的二次 patch 生成

建议：

1. task packet 里增加：
   - `remediationReason`
   - `failedChecks`
   - `preserveGoal`

### 8.4 `self-improvement-approval.ts`

目标：

1. 保持准入审批
2. 新增准出审批的提交与回调

建议：

1. entry gate 和 exit gate 使用不同 approval action
2. exit approval 不再要求 CEO 看到技术错误，只看产品化摘要

---

## 9. 前端实现改动

### 9.1 替换 `system-improvement-detail-drawer.tsx`

不再把它当“详情抽屉”，而是按两种模式拆开：

1. `SystemImprovementEntryReviewSheet`
2. `SystemImprovementExitReviewSheet`

如果保留一个组件，也必须由服务端直接提供 `reviewMode`：

1. `entry`
2. `exit`
3. `internal`（仅 Ops）

前端不再自己猜测决策模式。

### 9.2 `ceo-office-cockpit.tsx`

队列只看 `humanGate.state`，不再拼条件。

点击队列项时：

1. `entry-approval-required` -> 打开准入页
2. `exit-approval-required` -> 打开准出页

### 9.3 `ops-dashboard.tsx`

新增一个明确的 AI blocked / remediation 列表：

1. 自动修复中
2. 自动修复失败
3. policy blocked
4. infra blocked

这里保留技术细节和证据。

---

## 10. 需要删除的旧逻辑

为了避免腐朽代码继续增长，这次不是叠新逻辑，而是要删旧推导。

建议删除或废弃：

1. 前端所有基于 `mergeGate.status === ready-to-merge` 推导 CEO 决策项的逻辑
2. 前端所有基于 `preflight-failed` 直接展示 CEO 待决策的逻辑
3. `system-improvement-detail-drawer.tsx` 内部大量“根据 releaseGate / mergeGate 猜用户意图”的分支
4. proposal 主状态里对 `ready-to-merge` 的前端过度依赖
5. CEO 页面对 patch、worktree、命令、技术失败项的默认表达

原则是：

**状态判断收回后端，前端只消费明确的人类门状态。**

---

## 11. 实施顺序

### 阶段 1：状态语义纠偏

1. 引入 `humanGate`
2. 引入 `automationState`
3. 后端统一推导
4. CEO 队列只看 `humanGate`

### 阶段 2：release gate 自动修复

1. preflight 失败分类
2. auto-fixable 自动修复
3. remediation budget
4. blocked 与 exit-ready 分流

### 阶段 3：页面重构

1. 准入页
2. 准出页
3. Ops blocked 页
4. 技术证据彻底移出 CEO 默认视图

### 阶段 4：收尾清理

1. 删掉旧 detail drawer 分支
2. 删掉前端自猜决策态逻辑
3. 删掉重复状态投影

---

## 12. 最终结果

重构完成后，主链应变成：

```text
Signal / CEO command / story gap
-> Proposal
-> humanGate(entry)
-> AI execute / validate / remediate loop
-> all technical issues cleared
-> humanGate(exit)
-> approved into mainline
-> observe
```

CEO 看到的是：

1. 为什么做
2. 做了什么
3. 带来什么能力提升
4. 风险是否可接受
5. 现在是否批准

Ops 看到的是：

1. AI 在哪里卡住
2. 为什么卡住
3. 是否还在自动修
4. 是否需要运维介入

AI 自己处理的是：

1. patch 质量
2. whitespace
3. 重试
4. preflight
5. scope / diff / apply / test 闭环

这才符合“人类只准入与准出，AI 负责中间一切执行与修复”的目标。
