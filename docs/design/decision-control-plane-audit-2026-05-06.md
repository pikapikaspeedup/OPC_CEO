# 决策控制面收敛结论（2026-05-06）

## 当前结论

CEO 决策入口已经收敛为唯一主线：

`DecisionItemView -> DecisionTarget -> 业务对象详情`

这不是新增一套审批系统，而是把既有 `SystemImprovementProposal / GrowthProposal / Project stage gate / ApprovalRequest` 收口成一个稳定控制面。前端不再各页面手写跳转，也不再把 Project 当全系统兜底页。

## 正式对象边界

`ApprovalRequest` 是审批事实。

它负责记录审批请求、CEO 响应、通知与 callback。它不再承载完整业务上下文，也不再决定用户应该跳到哪个页面；它必须带 `target`。

`DecisionTarget` 是路由协议。

它明确指向业务对象：

- `system-improvement-proposal`
- `growth-proposal`
- `project`
- `project-stage-gate`
- `run`
- `knowledge`
- `conversation`
- `ops`
- `settings`

`DecisionItemView` 是 CEO 决策队列读模型。

它由服务端统一派生，固定包含：标题、来源、状态、详情、优先级、当前 owner、下一动作和 `target`。

`Project` 只承载项目、阶段、运行和 gate。

软件自迭代不再把 Project 当主路径。`SystemImprovementProposal` 是治理对象，Project 只是执行容器。

## 已做收敛

新增 `GET /api/company/ceo/decisions`。

服务端现在只聚合三类正式业务决策：

- 系统改进准入 / 准出
- Growth proposal
- Project stage gate

CEO Office 决策队列只消费该接口，不再本地拼 agenda / project / growth / self-improvement 的跳转分支。

`ApprovalRequest.target` 已改为必填。所有 `submitApprovalRequest()` 调用点都显式传入 target；运行时创建缺失 target 会失败。

Approval 链接不再生成 `panel=approvals&approval=...`，统一生成紧凑 `DecisionTarget` deep link，例如 `?decision=si~<proposalId>`、`?decision=gp~<proposalId>`、`?decision=sg~<projectId>~<stageId>`。旧 URL 口径不再作为运行时入口保留；不能生成明确 target 的审批请求会被服务端拒绝。

系统改进审批仍在 `SystemImprovementDetailDrawer`。

Growth 审批新增 `GrowthProposalDetailDrawer`。

ApprovalPanel 只做通用审批收件箱，点击详情时按 `target` 进入业务对象，但不再承担正式决策控制面。

Projects 中不再通过 Project `goal` 正则反推系统改进 proposal。平台工程 Project 显式记录 `governance.platformEngineering.systemImprovementProposalId`，Run 仍保留 `taskEnvelope.constraints` 作为执行侧关联。

`releaseGate` 只以 `exitEvidence.releaseGate` 为运行事实源，不再继续写入 `metadata.releaseGate`。

## 当前用户旅程

CEO 打开决策队列。

每条 item 都来自服务端 `DecisionItemView`，点击后按 `DecisionTarget` 打开对应业务对象：

- 系统改进 -> 系统改进详情
- Growth -> Growth proposal 详情
- Project stage gate -> Project 工作台对应 stage

CEO 审批软件自迭代时看到的是问题、风险、范围和批准后行为；代码细节和运行证据只作为技术证据折叠保留。

AI / Ops 执行过程不要求 CEO 修代码。CEO 只做准入与准出。

准入审批一旦点击批准，接口只负责把审批事实落库并派发后台执行，不同步等待整条 Codex 链跑完。

审批响应也不再反向依赖 callback 成功与否。审批事实先落库，后续业务 callback 只做 best-effort；若目标 proposal 已不存在，接口仍返回已成功处理的审批结果。

## 保留机制

- `proposal.status`
- `humanGate`
- `automationState`
- `exitEvidence`
- `releaseGate`
- `ApprovalRequest`
- `Project / Run`

这些仍是事实源或执行对象，但 CEO/Ops 页面不再直接拿它们各自拼决策入口。

## 移除机制

- CEO Office 决策队列本地多来源拼接跳转
- Project 作为系统自迭代审批兜底入口
- Project `goal` 文本正则反推系统改进 proposal
- 长期依赖 callback payload 猜 target
- 继续写 `metadata.releaseGate`
- 无 target 的新审批请求
- `agenda-item` 进入 CEO 正式决策队列
- Project / Run 异常直接进入 CEO 正式决策队列
- 普通 stage failed/blocked/timeout 自动生成 CEO 审批

## 后续只允许补强的方向

后续若继续增强，应沿着同一条主线补能力：

- 更完整的业务对象详情页
- 更清晰的 `DecisionTarget` 打开策略
- 更强的服务端 `DecisionItemView` 排序与过滤
- AI / Ops 内部自动修复闭环

不应新增第二套审批对象、第二套决策队列或 Project 兜底入口。
