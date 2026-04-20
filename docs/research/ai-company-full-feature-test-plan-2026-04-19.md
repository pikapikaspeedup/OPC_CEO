# AI Company 全特性测试计划（2026-04-19）

## 1. 背景

本测试计划对应的需求源文档是：

- `docs/design/ai-company-requirements-and-architecture-2026-04-19.md`

用户要求本轮测试不要再只覆盖：

- `Phase 4：Execution Profiles`

而是要回到整份 AI Company 需求稿，覆盖已经开发完成的核心特性，并优先采用：

- `Codex Native (OAuth)`

进行真实执行验证。

说明：

1. 仓库内当前存在的是 `.md` 文档，不是 `.mdk`
2. 本计划面向“接下来要执行的真实测试”，不是历史完成态总结
3. 本计划只把“当前已实现的能力”纳入通过标准，不把尚未实现的愿景能力误写成可测项

---

## 2. 测试目标

本轮测试要回答的不是“某个 API 能不能返回 200”，而是下面四个问题：

1. 需求稿里已经开发出来的能力，是否真的能跑通
2. 这些能力在真实业务链路里，是否能互相接起来
3. `Codex Native` 是否真的参与执行，而不是被其他 provider 暗中替代
4. 管理面、学习面、执行面、沟通面是否都能看到真实结果，而不是空壳 UI

---

## 3. 测试范围

## 3.1 需求范围映射

本计划按需求稿中的五组需求来组织测试。

### A. 组织与角色建模

对应当前实现：

1. `CEOProfile`
2. `DepartmentContract` / Department config
3. CEO state store
4. CEO event consumer
5. user feedback ingestion

### B. 多形态任务执行

对应当前实现：

1. `workflow-run`
2. `review-flow` 的推导与展示语义
3. `dag-orchestration`
4. `dispatch-execution-profile`
5. scheduler 按 execution profile 触发

### C. 长期知识沉淀与记忆管理

对应当前实现：

1. run 完成后提取 `KnowledgeAsset`
2. `Knowledge Store`
3. run 前 retrieval 注入
4. Knowledge Console
5. repeated execution -> proposal 信号

### D. CEO 与用户同步进化

对应当前实现：

1. CEO feedback 写入
2. recent decisions / active focus / pending issues
3. routine summary
4. approval / knowledge / project 事件进入 CEO 视图

### E. 经营级可视化管理与考核

对应当前实现：

1. CEO 总览
2. Department 经营页
3. Knowledge Console
4. KPI / OKR / risk dashboard
5. Evolution Pipeline 卡片

---

## 3.2 Phase 范围映射

### Phase 1：Knowledge Loop v1

要测：

1. `run -> extractor -> knowledge store -> retrieval -> next run`
2. `department-memory-bridge` 能否消费结构化知识
3. UI 是否能看到 recent/high reuse/stale/proposal signals

### Phase 2：CEO Actor v1

要测：

1. CEO state store 是否真实更新
2. event consumer 是否吃到 run/project/approval/scheduler/knowledge 事件
3. routine thinker 是否反映真实组织状态
4. user feedback 是否能写入并回显

### Phase 3：Management Console v1

要测：

1. CEO 总览是否展示真实经营数据
2. Department 经营页是否反映真实 throughput / workflow hit / OKR / risks
3. Knowledge Console 是否反映真实知识资产状态

### Phase 4：Execution Profiles

要测：

1. `workflow-run` 真实执行
2. `dag-orchestration` 真实执行
3. scheduler 的 `dispatch-execution-profile` 真实触发
4. run 列表与详情是否反映正确 profile

说明：

- `review-flow` 当前只测推导与展示，不作为独立 runtime target 的通过项

### Phase 5：Evolution Pipeline v1

要测：

1. proposal generation
2. replay evaluation
3. approval publish
4. rollout observe
5. approval callback 是否真实触发发布

---

## 3.3 本轮不纳入通过标准的项

以下能力在需求稿中存在，但当前实现还没有到“真实通过”口径，本轮只记录，不作为失败：

1. CEO 常驻 heartbeat / daemon thinker
2. CEO 主动通过 IM 长期催办的完整外呼闭环
3. `review-flow` 的独立 runtime 创建能力
4. CEO 拟合趋势与偏差的独立经营页面
5. 完整的部门级自我迭代和 CEO 自我进化闭环

---

## 4. 测试原则

1. **必须真实运行**
   - 至少关键链路不能只靠单测或 mock
2. **必须显式确认 provider**
   - 每条关键 run 都要验证 `native-codex`
3. **必须跨平面验证**
   - execution 成功后，要继续看 learning / management / communication 是否同步
4. **必须保留证据**
   - runId / projectId / jobId / approvalId / proposalId / 文件路径 / 截图
5. **必须避免污染生产数据**
   - 优先使用隔离 workspace 与隔离 `AG_GATEWAY_HOME`

补充说明：

- organization-level approval / governance state 当前是全局共享资源
- 因此不要把组织级 `pendingApprovals` 是否“只包含当前测试实例数据”作为通过标准
- approval 相关断言应优先使用：
  - `approvalId`
  - `workspace` 过滤
  - `CEOProfile.pendingIssues`

---

## 5. 测试环境与前置条件

## 5.1 基础环境

1. 本地 gateway 可启动
2. 默认测试地址：
   - `http://127.0.0.1:3000`
3. `Codex Native` 登录态有效：
   - `~/.codex/auth.json` 存在
4. 本地机器可访问 OpenAI Codex Native 所需网络

## 5.2 数据隔离建议

建议使用：

1. 独立测试 workspace
2. 独立 `AG_GATEWAY_HOME`
3. 独立测试 department 配置
4. 可回滚的测试用 `.department/config.json`

说明：

- 以上隔离建议主要用于：
  - runs
  - projects
  - generated assets
  - local workspace side effects
- 不适用于当前设计下的 organization-global approval store

## 5.3 Provider 前置条件

测试前必须确认：

1. 目标 workspace 的 `.department/config.json` 中：
   - `provider = native-codex`
2. 或测试期间通过 `ai-config` / department override 明确切换到 `native-codex`
3. run 完成后要检查：
   - `provider`
   - `sessionProvenance.backendId`
   - conversation/session handle

---

## 6. 测试策略

本轮采用四层测试结构。

### L0. 环境与 Provider 冒烟

目标：

先证明 `Codex Native` 可用，再进入业务测试。

验证：

1. Native Codex 登录态
2. 本地会话链 `/api/conversations`
3. prompt-mode 最小 run

### L1. 执行面真实链路

目标：

证明 Phase 4 不是只有合同和 UI，而是真的能跑。

验证：

1. `workflow-run`
2. `dag-orchestration`
3. scheduler `dispatch-execution-profile`

### L2. 学习与治理闭环

目标：

证明 Phase 1 和 Phase 5 的中间态不是“只写库不消费”。

验证：

1. knowledge extraction
2. retrieval injection
3. proposal generation
4. approval publish
5. rollout observe

### L3. 管理面与 CEO 面

目标：

证明 Phase 2 和 Phase 3 不是静态卡片。

验证：

1. CEO profile / routine / events
2. management overview
3. knowledge console
4. department dashboard

---

## 7. 详细测试矩阵

## Suite A：Codex Native 基础连通性

### A1. Native Codex 登录态检查

步骤：

1. 调用 provider 状态接口
2. 确认 `native-codex` installed / loggedIn

通过标准：

1. 能明确读到 auth 文件状态
2. 不需要手工重新登录

证据：

1. API 返回
2. auth 文件路径

### A2. 本地会话链 smoke test

步骤：

1. 调 `POST /api/conversations`
2. 创建 `native-codex` 本地会话
3. 调 `POST /api/conversations/:id/send`
4. 调 `GET /api/conversations/:id/steps`

通过标准：

1. 返回 `provider = native-codex`
2. `sessionHandle` 被记录
3. steps 可回看

证据：

1. conversationId
2. provider
3. steps 摘要

---

## Suite B：Phase 1 Knowledge Loop

### B1. Prompt run 产生知识资产

步骤：

1. 在测试部门触发一个真实 prompt-mode run
2. 等待 run 完成
3. 查询 `/api/knowledge`

通过标准：

1. 新 run 完成
2. 自动新增 `KnowledgeAsset`
3. 资产带有 workspace/category/status/source

证据：

1. runId
2. knowledgeId
3. knowledge metadata

### B2. Retrieval 注入生效

步骤：

1. 连续执行两次同类任务
2. 第二次执行前确保已有相关 knowledge
3. 对比第二次 run 的历史或 artifact

通过标准：

1. 第二次 run 记录了 knowledge retrieval
2. run history 中存在 retrieval 注入痕迹
3. 访问计数 / lastAccessedAt 发生变化

证据：

1. retrieval history
2. knowledge usageCount 变化

### B3. Knowledge Console 读侧验证

步骤：

1. 打开 Knowledge Console
2. 查看默认总览

通过标准：

1. `Recent Additions` 有真实数据
2. `High Reuse` 有真实数据
3. `Stale / Conflict` 正常显示
4. `Proposal Signals` 可显示 proposal 类信号

证据：

1. 页面截图
2. 对应 API 返回

---

## Suite C：Phase 2 CEO Actor

### C1. CEO 命令后状态更新

步骤：

1. 通过 CEO 命令派发一个真实任务
2. 查询 `/api/ceo/profile`

通过标准：

1. `recentDecisions` 增加
2. `activeFocus` 更新

证据：

1. CEO profile before / after

### C2. 用户反馈 ingestion

步骤：

1. 调 `POST /api/ceo/profile/feedback`
2. 再查 `GET /api/ceo/profile`

通过标准：

1. feedback 被写入
2. 时间戳和类型正确

证据：

1. feedback payload
2. CEO profile 回显

### C3. Event consumer 与 routine thinker

步骤：

1. 制造至少一条：
   - completed run
   - approval event
   - knowledge event
2. 查询：
   - `/api/ceo/events`
   - `/api/ceo/routine`

通过标准：

1. CEO events 中能看到上述事件
2. routine summary 里能反映：
   - highlights
   - digest
   - reminders / escalations

证据：

1. event records
2. routine payload

### C4. Pending issues 联动

步骤：

1. 制造 blocked/failed run 或待审批请求
2. 查询 CEO profile / routine

通过标准：

1. `pendingIssues` 增加
2. routine escalation 增加

证据：

1. pendingIssues
2. routine escalations

---

## Suite D：Phase 3 Management Console

### D1. CEO 总览数据一致性

步骤：

1. 在执行与治理链上制造：
   - active project
   - pending approval
   - recent knowledge
2. 查询 `/api/management/overview`
3. 打开 CEO Dashboard

通过标准：

1. API 指标非空
2. 页面卡片数值与 API 一致
3. OKR / risk 卡片正常渲染

证据：

1. overview payload
2. CEO Dashboard 截图

### D2. Department 经营页

步骤：

1. 打开测试部门详情
2. 查看经营指标区块

通过标准：

1. `throughput30d`
2. `workflowHitRate`
3. `recentKnowledge`
4. `pendingApprovals`
5. `okrProgress`
6. `risks`

都能看到真实值或合理空态

证据：

1. API 返回
2. 页面截图

---

## Suite E：Phase 4 Execution Profiles

### E1. `workflow-run` 真实执行

步骤：

1. 调 `POST /api/agent-runs`
2. 传 `executionProfile.kind = workflow-run`
3. 目标部门 provider 明确使用 `native-codex`

通过标准：

1. run 成功完成
2. `provider = native-codex`
3. `executionProfileSummary.label = Workflow Run`

证据：

1. runId
2. run detail
3. artifact / result

### E2. `dag-orchestration` 真实执行

步骤：

1. 调 `POST /api/agent-runs`
2. 传 `executionProfile.kind = dag-orchestration`

通过标准：

1. project/run 创建成功
2. run 真正执行
3. 列表和详情均显示 `DAG Orchestration`

证据：

1. projectId
2. runId
3. stage/progress 状态

### E3. Scheduler 触发 execution profile

步骤：

1. 创建 scheduler job：
   - 一个 `workflow-run`
   - 一个 `dag-orchestration`
2. 手动 trigger

通过标准：

1. job 创建成功
2. trigger 后生成真实 run
3. 对应 run 的 profile summary 正确

证据：

1. jobId
2. triggered runId
3. scheduler panel / API 数据

### E4. `review-flow` 读侧验证

步骤：

1. 找到已有 `review-loop` stage run
2. 查询 run 列表和详情

通过标准：

1. profile 可被推导为 `review-flow`
2. UI 展示正确

说明：

- 本项不要求“新建独立 review-flow runtime”

---

## Suite F：Phase 5 Evolution Pipeline

### F1. Proposal generation

步骤：

1. 用 `native-codex` 连续执行 3 次以上相似 prompt-mode 任务
2. 调 `POST /api/evolution/proposals/generate`

通过标准：

1. 生成 `draft` proposal
2. evidence 来自：
   - repeated runs
   - 或 knowledge proposal signal

证据：

1. proposalId
2. evidence
3. source runIds

### F2. Replay evaluation

步骤：

1. 对 proposal 调 `POST /api/evolution/proposals/:id/evaluate`

通过标准：

1. 返回 `evaluation`
2. 包含：
   - `sampleSize`
   - `matchedRunIds`
   - `successRate`
   - `blockedRate`
   - `recommendation`

证据：

1. evaluation payload

### F3. Approval publish

步骤：

1. 调 `POST /api/evolution/proposals/:id/publish`
2. 获取 `approvalRequestId`
3. 通过 approval API 批准

通过标准：

1. 产生 `proposal_publish` 审批请求
2. 批准后 proposal 状态变为 `published`
3. canonical asset 真实落盘

证据：

1. proposalId
2. approvalId
3. 发布后的文件路径

### F4. Approval callback 真实发布

步骤：

1. 批准后检查 proposal
2. 检查 canonical workflows / skills

通过标准：

1. 不是只改审批状态
2. 确实调用 publisher 完成发布

证据：

1. proposal 状态
2. 文件内容

### F5. Rollout observe

步骤：

1. 发布后再执行一次命中新资产的任务
2. 调 `POST /api/evolution/proposals/:id/observe`

通过标准：

1. `hitCount` 增加
2. `matchedRunIds` 增加
3. `lastUsedAt` 更新

证据：

1. rollout payload before / after

---

## 8. 端到端业务场景

本轮至少执行三条真实 E2E 场景。

### Scenario 1：CEO 即时派发 -> Prompt Run -> Knowledge -> Dashboard

链路：

1. 用户向 CEO 下达即时任务
2. CEO 派发到部门
3. 部门用 `native-codex` 完成 prompt-mode run
4. run 自动沉淀 knowledge
5. CEO / Management / Knowledge Console 同步可见

覆盖：

1. A
2. B
3. C
4. D
5. E

### Scenario 2：Scheduler Routine -> Execution Profile -> Department 经营页

链路：

1. scheduler 创建 `dispatch-execution-profile`
2. 手动 trigger
3. 任务执行完成
4. throughput / workflow hit / knowledge 进入 Department 页

覆盖：

1. B
2. C
3. E

### Scenario 3：Repeated Runs -> Proposal -> Evaluate -> Approve -> Publish -> Observe

链路：

1. 多次同类 run
2. 生成 proposal
3. evaluate
4. approval publish
5. canonical asset 落盘
6. 新 run 命中已发布资产
7. observe 更新

覆盖：

1. C
2. D
3. E
4. Phase 5

### Scenario 4：失败/阻塞 -> Approval / Pending Issue -> CEO Routine

链路：

1. 制造 blocked/failed run
2. 自动生成或手动生成审批
3. CEO pending issues 增加
4. routine escalations 增加
5. risk dashboard 增加

覆盖：

1. A
2. D
3. E

---

## 9. 证据清单

每个通过项都必须至少保留下列证据中的两类。

### API 证据

1. 请求 payload
2. 响应 payload
3. 关键对象 ID

### Runtime 证据

1. `runId`
2. `projectId`
3. `jobId`
4. `approvalId`
5. `proposalId`
6. `knowledgeId`

### 文件证据

1. 输出 artifact 路径
2. canonical workflow/skill 路径
3. knowledge mirror 路径

### UI 证据

1. CEO Dashboard 截图
2. Department 页截图
3. Knowledge Console 截图
4. Approval 面板截图

说明：

- 页面访问、交互、截图优先使用 `bb-browser`

---

## 10. 通过标准

本轮测试完成后，只有满足下面条件，才可以宣称“需求稿中当前已开发的特性可用”。

1. 至少一条 `workflow-run` 真实走完，且 provider 确认为 `native-codex`
2. 至少一条 `dag-orchestration` 真实走完，且 profile 读侧正确
3. 至少一条 scheduler `dispatch-execution-profile` 真实触发成功
4. 至少一条 run 完成后产生 knowledge，并被后续 run retrieval 命中
5. 至少一条 blocked/approval 事件进入 CEO routine / pending issues / management risk
6. 至少一条 evolution proposal 真实走完：
   - generate
   - evaluate
   - approve
   - publish
   - observe
7. CEO Dashboard、Department 页、Knowledge Console 都能看到真实数据，而不是全空态

---

## 11. 失败分类

测试过程中所有失败必须按层归类，避免模糊汇报。

### F0. 环境失败

示例：

1. `native-codex` 未登录
2. gateway 未启动
3. 网络不可达

### F1. Provider 路由失败

示例：

1. 任务实际落到非 `native-codex`
2. 模型或 provider fallback 不符合预期

### F2. Execution Plane 失败

示例：

1. run 创建成功但执行失败
2. scheduler trigger 无法产出 run
3. profile 分流错误

### F3. Learning Plane 失败

示例：

1. 没有提取 knowledge
2. retrieval 没有命中
3. proposal 无法生成或无法发布

### F4. Management / Communication Plane 失败

示例：

1. approval 有记录但 callback 不执行
2. CEO routine 不反映事件
3. dashboard 与真实数据不一致

---

## 12. 执行顺序建议

建议按下面顺序执行，避免前置条件缺失导致误判：

1. L0 环境与 Native Codex 冒烟
2. Phase 4 执行链
3. Phase 1 知识链
4. Phase 2 CEO Actor
5. Phase 3 Management Console
6. Phase 5 Evolution Pipeline
7. UI 冒烟与截图
8. 汇总证据与结论

---

## 13. 本文档的直接用途

这份文档接下来可以直接作为：

1. 真实实跑 checklist
2. 测试执行记录模板
3. 最终验收报告骨架

如果下一步开始正式测试，建议在本文档基础上再追加一份：

- `AI Company 全特性实测结果（日期）`

用于记录每一项的真实 runId / proposalId / approvalId / 截图与结论。
