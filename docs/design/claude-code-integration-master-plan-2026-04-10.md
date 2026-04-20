# Claude Code 接入开发总纲

日期：2026-04-10  
状态：总纲 / 开发分阶段细则

## 一句话目标

把 Claude Code 接成 Antigravity 的第一代默认强 coding executor，但不让它反向成为平台基座。

更准确地说：

1. Antigravity 继续拥有 Project / Run / Stage / artifact / governance / intervention 的真相源
2. Claude Code 只作为 execution backend / external executor
3. 接入后的所有代码合入，都必须围绕这个边界进行，不得让平台开始围着 Claude session / tool / event shape 重写自己

---

## 1. 开发总原则

整个接入开发必须遵守下面 6 条原则。

## 1.1 平台 ownership 不可转移

以下东西绝不能交给 Claude Code：

1. Run 真相源
2. Stage 定义权
3. artifact / result contract
4. approval / governance / scheduler 语义

## 1.2 Claude Code 只能落在 execution seam 后面

它的正确落位是：

1. external executor
2. AgentBackend / adapter

不是：

1. control plane 替代品

## 1.3 先跑通，再扩能力

开发顺序必须是：

1. 先跑通最小 PoC 主链
2. 再补 append / attach / cancel / evaluate 等 intervention 能力
3. 再考虑 richer tool / event / permission 整合

## 1.4 不直接吃 Claude 原始模型

Claude Code 的：

1. session
2. event
3. tool
4. result

都必须先经过 Antigravity adapter 归一化，再进入平台主链。

## 1.5 保持多执行器并存

接入 Claude Code 的目标不是干掉其它执行器，而是形成：

1. Native Executor
2. Claude Code executor
3. Direct Open API backend

三路并存、可路由的 execution plane。

## 1.6 每阶段必须有可验证完成态

每个阶段都必须有：

1. 代码落点
2. 明确验收标准
3. 测试证据
4. 不做范围

---

## 2. 总体阶段划分

建议按 6 个阶段推进。

## Phase 0：边界锁定

目标：

1. 在代码动手前，把模型映射、ownership、接入边界写死

交付物：

1. Claude Code 首选外部执行器决策文档
2. Claude Code 与 Antigravity 模型映射文档
3. 本总纲

当前状态：

1. 已完成

---

## Phase 1：最小 executor adapter 跑通

### 目标

让 Claude Code 以最小 external executor 形式跑通一条主链：

1. 平台派发 Run
2. Claude Code 在 workspace 内执行
3. 结果回到 Antigravity 的 result envelope

### 范围

只做最小闭环：

1. start / execute
2. external session handle 记录
3. result / changedFiles / summary 回传

### 暂时不做

1. append
2. attach
3. cancel 恢复态
4. evaluate
5. richer tool event

### 预期代码落点

1. 新增 Claude Code backend / executor adapter
2. 接入当前 execution seam
3. RunRegistry 持有 external handle / provider provenance

### 验收标准

1. 一个 Stage 可以被明确路由到 Claude Code executor
2. Claude Code 结果能被归一化成平台 result contract
3. 不需要改 control plane 语义就能跑通一条 coding task

### 风险

1. 先别碰 Claude 内部 event 复杂度
2. 先不要要求完整 streaming parity

---

## Phase 2：Session / Conversation 映射稳定化

### 目标

把 Claude session 明确落到 Conversation / execution thread 层，不让它渗透到 Run / Stage 语义。

### 范围

1. external session handle 持久化
2. session provenance 持久化
3. conversation / childConversationId 映射清晰化

### 暂时不做

1. 平台围着 Claude session 形状重构主模型

### 验收标准

1. Run 可以持有 Claude external session handle
2. attach / resume 恢复态优先基于 provenance，而不是重新猜 provider
3. Claude session 不会被抬升成 Run 真相源

### 风险

1. 这是最容易被外部 runtime 反向塑形的一步

---

## Phase 3：事件 / 结果归一化

### 目标

把 Claude Code 的运行事件和产出归一化成 Antigravity 平台自己的语言。

### 范围

1. event -> Step / liveState 映射
2. result -> summary / changedFiles / blockers / needsReview 映射
3. raw event 保留但不外泄成平台主合同

### 暂时不做

1. 全量复刻 Claude 的内部事件系统

### 验收标准

1. 上层页面和 Run 记录只认 Antigravity 的 Step / result contract
2. Claude 原始 event shape 不直接泄漏进 control plane

### 风险

1. 很容易为了图省事直接透传 Claude event

---

## Phase 4：Intervention 能力补齐

### 目标

补齐 Claude executor 在平台里需要承担的受控干预能力。

### 范围

1. append / nudge
2. attach / resume
3. cancel
4. evaluate 所需的 inspect / diagnostics 能力

### 暂时不做

1. 所有 Claude 原生交互体验一比一还原

### 验收标准

1. intervention contract 不需要为 Claude Code 单独重写平台语义
2. append / attach / cancel / evaluate 的合同被写成平台自己的语言

### 风险

1. 这里最容易让平台开始迁就 Claude 的 session / message 结构

---

## Phase 5：Tool / Permission / Artifact 深化整合

### 目标

在主链跑通后，再决定哪些 Claude 能力值得继续吸收。

### 范围

1. tool permission 映射
2. artifact / changedFiles 更细粒度回传
3. richer event / tool trace 接入

### 暂时不做

1. 完整复刻 Claude Code 产品壳

### 验收标准

1. 这些能力的引入不会反向改变平台 ownership

### 风险

1. 一旦过度吸收，就会开始为 Claude 的原生 runtime 做平台让步

---

## Phase 6：路由与上线策略

### 目标

让 Claude Code 从“可用 adapter”变成“可控默认 executor”。

### 范围

1. 哪些 Stage / 任务类型默认走 Claude Code
2. 哪些仍走 Native Executor
3. 哪些适合 Direct Open API backend
4. fallback / rollback 策略

### 验收标准

1. 平台可以按任务类型做稳定路由
2. Claude Code 失败时有 fallback 策略

---

## 3. 每阶段开发细则模板

后面每个阶段的实际开发，都建议按同一模板执行。

## 3.1 阶段目标

必须回答：

1. 这一阶段只解决什么
2. 明确不解决什么

## 3.2 代码落点

必须写出：

1. 新增文件
2. 修改入口
3. 会影响的测试文件

## 3.3 合同变化

必须写出：

1. 新增什么 adapter contract
2. 哪些字段进入 Run / Conversation / Step / result
3. 哪些外部字段故意不进入平台主模型

## 3.4 验收标准

必须至少有：

1. 行为验收
2. 测试验收
3. 边界验收

## 3.5 禁止越界项

必须写出：

1. 这一阶段绝对不能顺手扩的方向

---

## 4. 代码合入时的硬检查清单

每一阶段合入前，至少要过下面这些问题。

1. Run / Stage ownership 有没有被 Claude session 反向侵入
2. 是否直接透传了 Claude 原始 event / tool / result shape 到平台主模型
3. intervention contract 有没有开始为 Claude Code 单独长分支语义
4. provider provenance / session handle 是否被持久化
5. 失败 / cancel / attach / resume 是否有异常矩阵测试
6. 是否已经具备 fallback / rollback 思路

只要其中任意一条答案不稳，就不应该继续扩大接入面。

---

## 5. 当前最建议的执行顺序

如果你现在就准备开工，我建议的顺序是：

1. Phase 1：最小 executor adapter 跑通
2. Phase 2：session / conversation provenance 稳定化
3. Phase 3：事件 / 结果归一化
4. Phase 4：intervention 能力补齐
5. Phase 5：Tool / Permission / Artifact 深化整合
6. 最后再做 Phase 6：路由与上线策略

原因很简单：

1. 先证明能跑
2. 再证明不乱
3. 先补齐安全闭环
4. 最后再做默认路由与上线

---

## 6. 最后一句话

如果要确保整个 Claude Code 合入过程符合预期，就必须一直守住这句总纲：

> Claude Code 是 execution backend；Antigravity 继续拥有平台语义；每一阶段都只把必要能力接进 execution seam，而不是把平台重写成 Claude Code 的外壳。