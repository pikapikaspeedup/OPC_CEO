# AI 情报室黄金路径现状审计

**日期**: 2026-04-30  
**状态**: 现状审计  
**边界**: 本文只盘点当前 AI 情报室主链路已经具备哪些真实实现、哪些地方仍然缺少运行证据或闭环装配，不代表已经完成试运行。

## 1. 本次审计回答的问题

围绕 AI 情报室，当前系统到底已经跑通到哪一步。

这条黄金路径按目标应是：

```text
scheduler job
-> triggerContext.source = scheduler
-> /ai_digest workflow
-> runtime preflight / report
-> run finalization
-> knowledge / memory / agenda
-> CEO Office / Ops 可见
-> self-improvement signal / proposal
-> project
```

## 2. 当前已经明确具备的链路

### 2.1 canonical workflow 资产已在系统里

`/ai_digest` 不是临时 prompt。

当前已经具备：

1. canonical workflow `ai_digest.md`
2. runtime profile `daily-digest`
3. workflow scripts 目录 `ai_digest/`
4. `fetch_context.py`
5. `report_digest.py`

这说明 AI 情报室日报不是纯手工拼装，而是已经进入统一 workflow 资产链路。

### 2.2 scheduler 到 run 的触发链是存在的

当前 scheduler 已支持：

1. 以 execution target / prompt target 触发执行
2. 把 `triggerContext.source = scheduler`
3. 把 `triggerContext.schedulerJobId`
4. 在 run registry 和 SQLite 里按 `schedulerJobId` 查询 run

所以“定时任务有没有真的触发出 run”这件事，在系统结构上已经可追踪。

### 2.3 `/ai_digest` 的运行时前后处理已接上

当前 workflow runtime hooks 已对 `/ai_digest` 做了统一 runtime 处理：

1. preflight 会解析 workflow scripts 目录
2. 调 `fetch_context.py` 准备上下文
3. post-run 会调 `report_digest.py`
4. 会写回日报上报 payload
5. 会写回 verification 结果
6. 会把 `reportedEventDate / reportedEventCount / verificationPassed` 写入 run

这意味着 AI 情报室不是普通 prompt run，而是一条有专门运行时完成态的业务流。

### 2.4 run 完成后会自动进入知识与经营层

当前 prompt workflow 完成后，已经会调用现有知识沉淀与 company kernel 机制：

1. `persistKnowledgeForRun()`
2. `rebuildRunCapsuleFromRun()`
3. `observeRunCapsuleForAgenda()`
4. `processRunCapsuleForMemory()`
5. `observeMemoryCandidateForAgenda()`

这条链说明：

1. run 完成后不会只停在 artifact
2. 会进入 `RunCapsule`
3. 会进入 `OperatingSignal / Agenda`
4. 会产生记忆候选与知识治理输入

### 2.5 CEO Office / Ops / Company API 已有消费面

当前前台和 API 已能消费这些结构化对象：

1. `RunCapsule`
2. `MemoryCandidate`
3. `OperatingSignal`
4. `CompanyLoopPolicy`
5. `SystemImprovementProposal`

所以从“结构是否有展示和查询入口”这一层看，AI 情报室后续产物并不是黑盒。

## 3. 当前可以下的硬判断

基于代码和测试，当前可以下三个硬判断。

### 3.1 已经真实存在的，是前半条链

前半条链已经具备明确实现：

```text
scheduler
-> run
-> /ai_digest runtime hooks
-> result / verification
-> knowledge persistence
-> run capsule / agenda
```

这不是概念层，而是已经有代码路径和测试覆盖的链路。

### 3.2 现在最像“有生命体征”的业务确实是 AI 情报室

原因不是它页面最好看，而是它具备：

1. 周期触发
2. 专门 workflow
3. 业务化 runtime hooks
4. 上报验证逻辑
5. run 后沉淀链路

这和其他很多“只有入口和模型”的能力不同。

### 3.3 目前还没有进入真正的自进化后半条链

后半条链还没有形成真实闭环：

```text
signal
-> self-improvement proposal
-> project
-> 平台工程部 AI Loop
-> 准出证据
```

这里现在更多还是“零件在”，不是“主链在跑”。

## 4. 当前明确缺失或仍未证实的环节

### 4.1 还缺一次真实运行基线盘点

虽然结构完整，但当前还没有拿到这几个事实基线：

1. AI 情报室当前活跃 job 到底是哪一个
2. 最近 7 天到底跑了多少次
3. 哪些 run 成功、失败、跳过
4. 每次是否都形成 terminal 状态
5. 产物是否都稳定落地

这部分必须靠试运行和数据盘点确认，不能只看代码推断。

### 4.2 self-improvement signal 还没有从真实运行自动收口

当前 `SystemImprovementSignal` 已有完整模型和 API，但自动来源还不够强。

至少目前能明确看到的是：

1. 有手工创建 signal 的 API
2. 有 proposal planner
3. 有 approval gate

但“run 失败 / 重复失败 / 用户场景缺口 -> 自动 self-improvement signal”这段还没有正式接上。

### 4.3 proposal 还没有自动转成 project

当前 `SystemImprovementProposal` 已经有：

1. `affectedFiles`
2. `testPlan`
3. `rollbackPlan`
4. `branchName`
5. `linkedRunIds`

但 proposal 还没有自动创建 `Project`。

也就是说，系统还不能把“我发现了这个问题”自动推进成“我已经创建好开发项目准备修了”。

### 4.4 内置平台工程部门还没有成为真实 owner

当前还没有一个正式实例把下面这些流量都接住：

1. AI 情报室断点
2. 系统改进 proposal
3. 主软件开发任务
4. 准出证据包

所以现阶段就算 proposal 出来了，也还没有稳定责任主体去持续消费。

### 4.5 project 级观察 / 提案开关还没有挂到现有 project 上

这会影响两个动作：

1. 哪些项目允许被平台工程部持续观察
2. 哪些项目允许平台工程部主动向 CEO 提 proposal

如果没有这个最小治理层，主动观察就会变成隐式魔法，不可控。

## 5. 当前最合理的试运行边界

现在不该直接做“大而全自进化演示”。

最合理的边界是：

1. 只围绕 AI 情报室日报链路
2. 只核对一条活跃 scheduler job
3. 只抽最近一小段真实 run
4. 只确认它是否进入 `run -> knowledge -> agenda`
5. 再用这条真实断点生成第一个 proposal

## 6. 审计结论

当前 AI 情报室黄金路径的状态可以收成一句话：

> 前半条链已经基本成形，后半条自进化闭环还没有装配完成。

更具体一点：

### 已成形

1. scheduler 触发
2. run 持久化
3. `/ai_digest` runtime hooks
4. report / verification
5. knowledge persistence
6. `RunCapsule / Agenda`

### 未成形

1. 自动 self-improvement signal
2. proposal 自动归属到内置平台工程部
3. proposal 自动创建 project
4. AI Loop 准出证据与 merge / restart 决策

## 7. 下一步只该做什么

基于这次审计，下一步不该继续补概念。

只做两件事：

1. 把内置平台工程部门实例正式冻结并接入路由。
2. 对 AI 情报室做一次真实运行盘点，拿到 job、run、capsule、candidate、signal、proposal 的事实链。

只有这两步完成后，软件自进化机制是否有效，才开始进入可证明状态。
