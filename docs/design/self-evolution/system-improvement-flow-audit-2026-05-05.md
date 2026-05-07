# 系统改进链路正式方案（2026-05-05）

## 目标

软件自迭代链路必须满足四个条件：

1. 人类只参与准入与准出
2. AI 承担中间全部执行、验证、修复、补证据
3. CEO 能在一个稳定控制面中看清当前 owner、当前阶段、下一动作
4. Ops 的执行进度对 CEO 默认可见，不依赖跨页跳转才能判断系统是否真的推进

本文件只回答四件事：

- 哪些现有机制保留
- 哪些现有机制去掉
- 哪些现有机制修改
- 这些变更会影响什么

不保留历史推演，不保留临时方案。

---

## 现有机制中应保留的事实源

当前系统底层机制已经足够支撑正式方案，下面这些都应保留。

### 1. `SystemImprovementProposal`

职责：

- 系统改进的唯一业务对象
- 承载问题、范围、风险、计划、测试、回滚、关联执行

结论：

- 保留
- 不新增第二套 proposal 对象

### 2. `ApprovalRequest`

职责：

- 记录准入审批与审批结果
- 驱动批准 / 拒绝回调

结论：

- 保留
- 不把它变成页面主状态对象

### 3. 执行事实

包括：

- `project`
- `run`
- `codex runner evidence`
- `testEvidence`
- `mergeGate`

职责：

- 记录 AI 实际做了什么、做到了哪一步

结论：

- 保留
- 不新增另一套 AI 执行状态体系

### 4. `releaseGate`

职责：

- 记录 preflight、准出、合并、重启、观察、回滚

现有状态已经包括：

- `not-started`
- `preflight-failed`
- `ready-for-approval`
- `approved`
- `merged`
- `restarted`
- `observing`
- `rolled-back`

结论：

- 保留
- 不新增第二套 Ops 发布对象

---

## 当前机制的核心问题

当前不是“机制太少”，而是“机制太多、控制面没有收敛”。

### 问题 1：控制面没有唯一状态源

同一条系统改进现在同时被这些状态表达：

- `proposal.status`
- `approvalRequest.status`
- `humanGate.state`
- `automationState.status`
- `releaseGate.status`
- `project.status`
- `latestRun.status`

结果：

- 同一条改进在不同页面看起来像不同阶段
- 用户必须自己理解多个对象之间的关系
- 页面只能靠说明文字补洞

### 问题 2：准入审批与 proposal 的关系没有被产品化表达

审批是独立对象，proposal 也是独立对象。  
审批通过后，proposal 会立即自动进入执行。

如果用户事后看 proposal，只会看到执行中的 proposal，不会自然理解：

- 这条已经准入审批过
- 是何时批的
- 由谁批的

### 问题 3：preflight 没有进入自动主线

当前 preflight 已经有机制，但不是正常主线路径的一部分。

这会造成典型中间态：

- 准入已通过
- AI 执行完成
- merge gate 已 ready
- release gate 还没启动

这种状态对 CEO 来说最混乱，因为它既不是“待准出”，也不是“已发布”，也不是“AI 还没做完”。

### 问题 4：详情页承担了三种不同职责

当前一个详情页同时承担：

1. 准入审批
2. 准出审批
3. 发布跟踪

这三者用户问题完全不同，混在一起必然导致：

- 状态口径漂移
- 按钮时有时无
- 解释性文案变多
- 用户搞不清当前到底该做什么

### 问题 5：解释性文案在替代状态设计

例如：

- “这条改进当前留在 AI / Ops 内部处理”
- “等待 Ops 完成合并与发布动作”

这些话的存在本身就说明：

- 当前状态模型不够直接
- 页面不能只靠事实本身表达当前阶段

---

## 正式方案判断

正式方案不是再加一批新对象。  
正式方案是：

- 保留事实源
- 增加统一控制面解析层
- 把 preflight 接回自动主线
- 让页面只消费统一读模型

---

## 增加哪些机制

### 机制 A：`SystemImprovementControlStateResolver`

新增一个正式控制面解析器。

它的职责只有一个：

- 从现有事实源解析出唯一控制面状态

输入：

- `proposal`
- `approvalRequest`
- `automationState`
- `mergeGate`
- `releaseGate`
- `project`
- `latestRun`

输出：

- `stage`
- `currentOwner`
- `nextAction`
- `pageMode`
- `headline`
- `subline`
- `milestones`

建议阶段集合固定为：

- `entry-review`
- `ai-executing`
- `ai-preflight`
- `exit-review`
- `ops-merge`
- `ops-restart`
- `observing`
- `done`
- `rolled-back`
- `blocked`

判断：

- 必须新增
- 这是正式控制面层，不是临时补丁

### 机制 B：preflight 自动推进钩子

新增自动推进规则：

- 当 `mergeGate.status === ready-to-merge`
- 且 `releaseGate` 不存在或 `preflightStatus === not-run`
- 自动执行现有 `preflight`

判断：

- 必须新增
- 这是当前链路唯一明确缺失的主线机制

### 机制 C：统一里程碑视图 contract

控制面解析器需要稳定输出同一条里程碑线：

- 准入审批
- AI 实现
- AI preflight
- 准出审批
- Ops 合并
- Ops 重启
- 观察 / 完成

判断：

- 必须新增
- 但它是解析 contract，不是新增持久化对象

---

## 去掉哪些机制

### 去掉 1：前端各页面自行解释状态

应去掉当前这种机制：

- 每个页面自己看 `proposal.status`
- 自己看 `humanGate`
- 自己看 `automationState`
- 自己看 `releaseGate`
- 自己拼标题、标签、文案、动作

结论：

- 必须去掉
- 所有页面只允许消费统一解析结果

### 去掉 2：把手工 preflight 当作正常路径

手工 preflight 可以保留，但只能作为：

- 重跑
- 修复后重试
- 运维干预

它不能继续作为 happy path 的必经步骤。

结论：

- 必须去掉其“正常路径人工步骤”的身份

### 去掉 3：用说明性文案补状态洞

应去掉这类表达：

- “这条改进当前留在 AI / Ops 内部处理”
- “等待 Ops 完成合并与发布动作”

这类文案不是事实表达，而是在解释机制。

结论：

- 必须去掉
- 页面应只显示事实、状态、动作

### 去掉 4：把 `proposal.status` 当成 CEO 主状态

`proposal.status` 可以保留，但不再直接驱动 CEO 页的主视图逻辑。

结论：

- 必须去掉这层用法

---

## 修改哪些机制

### 修改 1：`proposal.status` 的职责

修改后只承担：

- 粗粒度生命周期事实

不再承担：

- 当前 owner
- 当前页面模式
- 当前操作
- 控制面标题

### 修改 2：`humanGate` 的职责

修改后只承担：

- 当前是否需要人类决策

保留：

- `entry-approval-required`
- `exit-approval-required`
- `none`

不再承担：

- 页面标题生成
- 兜底说明文案

### 修改 3：`automationState` 的职责

修改后只承担：

- AI 内部自动执行阶段

不再承担：

- CEO 已批但待 Ops 合并
- Ops 已合并待重启
- 发布后阶段

### 修改 4：`releaseGate` 的职责

修改后明确为：

- 唯一发布事实源

也就是：

- 是否已 preflight
- 是否可准出
- 是否已准出
- 是否已合并
- 是否已重启
- 是否在观察
- 是否已回滚

### 修改 5：详情页机制

修改后必须拆成三种明确模式：

- `entry-review`
- `exit-review`
- `release-progress`

可以共用一个壳组件，但不能再共用一套自由拼接逻辑。

### 修改 6：proposal 与 approval 的展示关系

proposal 详情必须直接吸收审批历史，至少要默认可见：

- 准入审批是否完成
- 谁批准 / 拒绝
- 时间
- 审批说明

不再要求用户自己拿 proposal id 和 approval id 来回比对。

---

## 不应该新增的机制

为了让方案成熟且可控，下面这些不应新增。

### 不新增第二套 proposal / release / ops 对象

原因：

- 现有 `proposal` 和 `releaseGate` 已经足够承载事实

### 不新增持久化 `currentOwner` / `nextAction` 字段

原因：

- 这两个概念属于控制面解析结果
- 不是底层事实源

第一阶段应由 resolver 推导，而不是直接写入数据库。

### 不新增第二套详情页协议

原因：

- 现有 API 足够
- 问题不在协议数量，而在页面读模型不统一

---

## 关联影响

### 影响 1：后端读模型层

涉及：

- `src/lib/company-kernel/self-improvement-runtime-state.ts`
- 新增控制面解析器
- `src/lib/types.ts`
- `src/lib/api.ts`

判断：

- 中等影响
- 不需要数据库迁移

### 影响 2：前端四个入口统一口径

涉及：

- `src/components/ceo-dashboard.tsx`
- `src/components/ceo-office-cockpit.tsx`
- `src/components/system-improvement-detail-drawer.tsx`
- `src/components/ops-dashboard.tsx`

判断：

- 高影响
- 但本质上是删分散判断、改统一消费

### 影响 3：执行主线补自动 preflight

涉及：

- `src/lib/company-kernel/self-improvement-codex-execution.ts`
- `src/lib/company-kernel/self-improvement-runtime-state.ts`
- `src/lib/company-kernel/self-improvement-release-gate.ts`

判断：

- 中高影响
- 需要处理幂等、重复触发和失败回写

### 影响 4：测试体系

必须新增或重构：

- 控制面阶段解析测试
- preflight 自动推进测试
- entry / exit / release-progress 页面模式测试

判断：

- 高价值影响
- 因为当前最容易出错的是状态映射，不是底层执行

### 影响 5：文档体系

需要同步：

- `ARCHITECTURE.md`
- `agent-user-guide.md`
- `gateway-api.md`
- `cli-api-reference.md`

判断：

- 必改
- 否则控制面 contract 会与实现脱节

---

## 最终判断

正式方案应当收敛成：

### 增加

- `SystemImprovementControlStateResolver`
- preflight 自动推进钩子
- 统一里程碑视图 contract

### 去掉

- 前端分散状态解释
- 把手工 preflight 当正常路径
- 用说明性文案补状态洞
- 直接用 `proposal.status` 当 CEO 主状态

### 修改

- `proposal.status` 只做粗粒度生命周期
- `humanGate` 只做人类决策门
- `automationState` 只做 AI 内部执行态
- `releaseGate` 只做发布事实源
- 详情页拆成明确模式
- proposal 详情直接吸收审批历史

这条路线是正式收敛，不是临时修补。
