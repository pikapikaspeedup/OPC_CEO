# Provider Integration And Task B Plan

## 目标

这份文档专门回答两个问题：

1. 现在所谓“迁到 Event 框架”到底意味着什么
2. 以后独立的 OpenAI / Claude API / 自定义后端应该接在哪一层，以及 Task B 做完以后系统应处于什么状态

它和 `agent-backend-event-architecture-gap-checklist.md` 的分工不同：

- gap checklist 负责记录当前还差哪些缺口
- 这份文档负责说明整体迁移预期、Provider 接入位点，以及 Task B 的完成态

---

## 1. 当前迁移已经完成到哪一步

### 1.1 任务 A 已完成

当前系统已经完成“现有功能入口全部进新事件架构”这一步。

这句话的真实含义是：

1. Prompt Mode 已经通过 AgentBackend / AgentSession / session-consumer 运行
2. legacy-single 已经通过同一条 session 主链运行
3. multi-role isolated 已经 session 化
4. shared conversation、nudge、restart-role、evaluate、unattached cancel 这些此前的功能级旧入口也已经迁完

因此，现在不应该再把“还有某个旧功能入口没迁”当成主问题。

### 1.2 现在剩下的是任务 B

当前剩下的不是“功能级迁移”，而是“结构级下沉”：

> 把还残留在 orchestration 层中的 Antigravity transport / RPC / runtime 解析细节继续压到底层。

这一步就是现在讨论的 Plan B。

---

## 2. 迁移后的分层预期

为了避免后面又把概念混在一起，迁移后的结构应该始终按 3 层理解。

### 2.1 顶层：业务编排层

代表模块：

1. `src/lib/agents/group-runtime.ts`
2. `src/lib/agents/prompt-executor.ts`

这一层负责：

1. Template / Prompt 的业务语义
2. review-loop / delivery / source contract / pipeline 推进
3. Run / Project / Stage 的状态真相
4. artifact、finalization、治理逻辑

这一层不应该继续理解 provider transport 细节。

### 2.2 中层：session 生命周期层

代表模块：

1. `src/lib/backends/types.ts`
2. `src/lib/backends/session-consumer.ts`
3. `src/lib/backends/run-session-hooks.ts`
4. `src/lib/backends/builtin-backends.ts`

这一层负责：

1. start 一个 session
2. 产生 started / live_state / completed / failed / cancelled 事件
3. append / cancel
4. 统一 session 生命周期与 terminal 语义

这一层是未来所有 Provider 的标准接入面。

### 2.3 底层：provider / transport 叶子层

代表模块：

1. `src/lib/providers/`
2. Antigravity 专有的 bridge / gateway / gRPC 能力
3. 未来独立 OpenAI / Claude API / 自定义执行器

这一层负责：

1. 真正调用后端
2. 处理各家 API / transport 差异
3. 把差异压缩成统一的 session 事件和能力矩阵

---

## 3. “迁到 Event 框架”真正代表什么

它不是说“所有 Provider 完全一样了”，而是说：

1. 上层不再围绕 `TaskExecutor` 的返回值语义分叉
2. 上层围绕统一的 session 事件做状态推进
3. 不同 Provider 的差异由 capability 和 backend 叶子层承担

换句话说，迁完之后系统面对 Provider 的基本问题不再是：

1. 它是不是 Antigravity
2. 它是不是 Codex
3. 它需不需要 watcher

而是：

1. 它能不能 start 一个 session
2. 它会发什么事件
3. 它支不支持 append
4. 它支不支持 cancel
5. 它有没有 live state / raw steps / streaming text

这就是 Event 框架的核心收益。

---

## 4. 以后 OpenAI 等独立后端要怎么接

## 4.1 接入位点

未来独立的 OpenAI / Claude API / 自定义后端，不应该直接接到：

1. `group-runtime.ts`
2. `prompt-executor.ts`
3. `watch-conversation.ts`

它们应该接在 session 生命周期层下面，也就是：

1. 扩展 `ProviderId`
2. 提供新的 provider leaf implementation
3. 提供对应的 `AgentBackend`
4. 由现有 orchestration 复用，不再新增运行时分支

## 4.2 最小接入合同

如果一个新后端只支持“发请求，然后一次性拿最终结果”，它依然可以接进来。

它最小只需要提供：

1. started 事件
2. completed / failed / cancelled 终态事件
3. best-effort cancel

这类后端可以天然声明：

1. `supportsAppend = false`
2. `emitsLiveState = false`
3. `emitsRawSteps = false`
4. `emitsStreamingText = false`

也就是说：

> Event 框架并不要求所有后端都像 Antigravity 一样有 watcher、trajectory、owner routing。

它只要求每个后端都能被统一建模成一个 session。

## 4.3 如果新后端支持多轮会话

如果未来某个 OpenAI-compatible backend 或自定义后端支持：

1. 持久 handle
2. append
3. cancel
4. streaming 或阶段性状态

那它可以继续往能力矩阵上加：

1. `supportsAppend = true`
2. `emitsLiveState = true/false`
3. `emitsStreamingText = true`
4. 视情况实现 `attach()`

这会让 shared conversation、nudge、diagnostic 这些能力自动获得可扩展空间，而不是重新在 `group-runtime.ts` 里写分支。

## 4.4 对 OpenAI 这类后端最现实的接入顺序

最稳的顺序是：

1. 先做 provider leaf
2. 再做对应 backend
3. 先只支持单次 session 完成
4. append / attach / streaming 放到后续能力阶段

原因很简单：

1. 现在系统最需要的是“统一执行入口”
2. 不是“每个 Provider 一上来就拥有 Antigravity 等级的会话能力”

## 4.5 如果没有 Antigravity IDE 能力，Workspace 还成不成立

这个问题的关键在于：

> Workspace 不能再被理解成“必须有 Antigravity language server 的 IDE 窗口”，而要拆成两层。

### 第一层：逻辑 Workspace

这是所有 Provider 都应该共享的东西：

1. 仓库根目录
2. cwd
3. artifact 目录
4. Project / Run / Stage 的挂载位置
5. rules / memory / policy / source contract 的业务上下文

这一层不依赖 Antigravity IDE，属于系统自己的业务边界。

### 第二层：执行能力 Workspace

这是具体 Provider 运行时附带的能力包：

1. 有没有 language server
2. 有没有 owner routing
3. 有没有 trajectory / liveState
4. 有没有 IDE file edit / approval / annotation 能力

Antigravity Provider 在这层能力最强。

OpenAI / Claude API / 任意第三方 Key 并不一定拥有这层能力，但它们仍然可以复用第一层的逻辑 Workspace。

所以未来真正稳定的理解应该是：

1. Workspace 继续存在
2. 但 Workspace 不再等价于“必须跑在 Antigravity IDE 能力上”
3. 各 Provider 只是对同一个逻辑 Workspace 提供不同强度的执行能力

这也是 Event 框架真正重要的地方：

1. 它让我们可以接受“不等能力”的后端
2. 而不是要求所有后端都伪装成 Antigravity IDE

## 4.6 这对第三方 Key 的现实含义

如果以后你接的是 OpenAI、Claude API 或其它第三方 Key，系统预期应该是：

1. 仍然在同一个 Workspace 上执行任务
2. 仍然写同样的 artifact / result / run 状态
3. 仍然走同一套 Project / Run / Stage 语义
4. 只是少了一部分 IDE 专有能力

也就是说，未来不应该说：

1. Antigravity Provider 才有 Workspace
2. 其它 Provider 只能做无状态 API 调用

更准确的说法是：

1. 所有 Provider 都有逻辑 Workspace
2. 只有部分 Provider 有 IDE-enhanced Workspace capabilities

---

## 4.7 Claude Code 能不能当通用执行器

可以，但位置必须放对。

最稳的定位不是“把 Claude Code 当系统底座”，而是：

> 把 Claude Code 当成一个 provider leaf executor，或者进一步包装成一个 AgentBackend。

### 为什么能用

因为 Claude Code 天然具备：

1. 在本地 Workspace 里执行任务
2. 工具调用 / shell / file edit 能力
3. 明确的会话循环
4. 可作为单次任务执行器使用

这些特征决定了它很适合被当成“底层执行叶子”。

### 为什么不能直接拿来当系统核心

因为 Antigravity 的核心不只是“让一个模型会写代码”，而是：

1. Project / Run / Stage 真相源
2. review-loop / delivery / source contract
3. artifact、治理、审批、调度
4. CEO / Department / Scheduler / OPC 这些上层系统语义

Claude Code 并不天然承担这些职责。

所以它最合适的接法是：

1. Claude Code 负责执行一段任务
2. Antigravity 继续负责业务编排和状态真相

### 最现实的落地方向

如果真要接 Claude Code，最稳的顺序是：

1. 先把它当成单次 session executor 接入 Prompt Mode 或 legacy-single
2. 先只要求 started / completed / failed / cancelled 这组最小事件
3. append / attach / streaming / liveState 作为后续能力再看
4. 不要一上来就让它替代 `group-runtime` 或 Project / Pipeline 层

所以结论不是“能不能用”，而是：

1. **能用作执行器**
2. **不适合作为系统基座**

## 4.8 为什么“以文件夹为单位”不能替代 Project / Run

这是最容易混淆的一点。

文件夹或者 workspace 只回答：

1. 代码和文件在哪
2. agent 的 cwd 是哪
3. 工具能对哪棵目录树读写

但 Antigravity 的 `Project` 和 `Run` 回答的是另一组问题：

1. 现在公司在推进的到底是哪一个任务容器
2. 这个任务容器下面已经执行过哪些阶段和哪些轮次
3. 哪一次执行对应哪个 stage、哪个 prompt、哪个上游输入、哪个 reviewOutcome
4. 这次执行失败、取消、超时、审批阻塞后，系统应如何恢复和继续推进
5. CEO / Scheduler / Approval / Project Workbench 应该展示和干预哪一个对象

换句话说：

1. **文件夹是空间边界**
2. **Project / Run 是时间和治理边界**

### Project 不是“一个目录”，而是任务容器

从 `project-registry.ts` 看，Project 至少还承担：

1. `projectId`
2. `goal`
3. `templateId`
4. `runIds`
5. `pipelineState`
6. parent / branch / projectType / priority 等组织语义

所以 Project 的本质不是“某个文件夹”，而是：

> 一个可以跨多次执行、跨多阶段、跨多分支存在的任务容器。

### Run 不是“某次进入某个文件夹”，而是可恢复的执行记录

从 `run-registry.ts` 看，Run 至少还承担：

1. `runId`
2. `stageId` / `pipelineStageId`
3. `executionTarget` / `executorKind`
4. `taskEnvelope` / `sourceRunIds`
5. `status` / `liveState` / `result` / `reviewOutcome`
6. 终态恢复、重启恢复、auto-trigger 同步

所以 Run 的本质不是“某个 agent 在某个目录里工作了一次”，而是：

> 一条可持久化、可恢复、可治理、可审计的执行历史。

### Claude Code / Corecode 这类 folder-based agent 缺的不是目录，而是系统语义

即使一个执行器天然以文件夹为单位工作，它也通常只天然拥有：

1. cwd / workspace trust
2. 一次会话
3. 工具调用过程
4. 一次回复或一段 session history

它天然不拥有 Antigravity 这一层系统语义：

1. pipeline stage 推进
2. review-loop 决策
3. source contract
4. fan-out / join
5. scheduler / CEO / approval 回流
6. project detail / run detail 的业务展示对象

所以不能因为它“也是按文件夹工作”，就把它等同成 Project / Run。

更准确的关系是：

1. 文件夹工作区 = 执行器的环境边界
2. Project / Run = Antigravity 的系统真相源
3. Claude Code 这类系统最多替代“执行器”这一层，不能天然替代“真相源”这一层

### 真正可以替代的是哪一层

如果未来要接 Claude Code 或任何 folder-based agent，真正可替代的是：

1. provider leaf executor
2. AgentBackend session implementation

而不是：

1. `project-registry`
2. `run-registry`
3. `pipelineState`
4. `reviewOutcome` / `artifact` / `governance`

这就是为什么它可以成为一个很强的底层执行器，但不能直接替代 Antigravity 的 Project / Run 模型。

## 4.9 如果用 Claude Code 来实际编辑代码，能否被调度系统控制

可以，但前提是：

> 我们把 Claude Code 看成“一个可控执行器”，而不是“系统真相源”。

也就是说，调度系统仍然由 Antigravity 维护：

1. `Project`
2. `Run`
3. `Stage`
4. `artifact`
5. `review-loop`
6. `scheduler / CEO / approval`

Claude Code 负责的是：

1. 在指定 workspace 内执行任务
2. 按 prompt 编辑文件 / 运行工具 / 给出结果
3. 向我们暴露 session 生命周期

### 最理想的接法

最理想的方式是把 Claude Code 包成一个新的 `AgentBackend`：

1. `start(config)`
2. `events()`
3. `cancel()`
4. 视能力决定是否支持 `append()` / `attach()`

一旦做到这一步，它就能被现有调度系统控制：

1. Scheduler 创建任务
2. `dispatchRun()` 创建 `Run`
3. runtime 把 stage prompt、workspacePath、artifactDir、timeoutMs 交给 Claude Code backend
4. Claude Code 在该 workspace 中实际编辑代码
5. backend 把 started / completed / failed / cancelled 回写到 `Run`

也就是说：

1. 调度系统控制“什么时候执行、执行哪一轮、属于哪个 stage、结果记到哪个 run”
2. Claude Code 控制“这次执行时具体怎样修改代码和调用工具”

### 这和 Google Antigravity language server 的关系

如果你说的 Antigravity 是现在这套 Google Antigravity language server / owner / trajectory / annotation 能力，那么 Claude Code 接进来以后，通常会出现两种模式：

1. **替代执行器，但不替代调度真相源**
	- 最现实，也最稳
	- Google Antigravity 的 IDE transport 不再是唯一执行面
	- 但 `Project / Run / Stage` 仍然归 Antigravity 系统维护
2. **共享逻辑 Workspace，但不共享 IDE transport 能力**
	- Claude Code 可以在同一仓库目录工作
	- 但不天然拥有 language server 的 trajectory、owner routing、annotation 这些能力

所以准确答案是：

1. **能被控制**
2. **但通常是作为另一种 executor 被控制**
3. **不会天然继承 Google Antigravity 这套 IDE transport 能力**

### 真正的门槛在哪

Claude Code 能不能被我们很好地调度，不取决于“它是不是按文件夹工作”，而取决于它是否能满足这几个合同：

1. 能否以编程方式 start 一次任务
2. 能否拿到 session handle 或至少可追踪的运行 ID
3. 能否获得明确 terminal 状态
4. 能否取消
5. 能否把结果稳定落到 artifact / result 合同中

只要这些能满足，它就能被调度系统控制。

### 它能不能顺便解决第三方兼容

这里要分两种情况：

1. **如果你用的是“只支持 Claude / Anthropic 规格 API”的 Claude Code 内核**
	- 那它只能给我们带来“Claude-family executor”
	- 不能自动解决 OpenAI / Gemini / 其它第三方兼容
2. **如果你用的是当前这个逆向仓库里的实现**
	- 这个仓库本身已经声明了多 provider / compatibility layers，包括 OpenAI、Gemini、Grok 等
	- 见 `claude-code/CLAUDE.md`
	- 这种情况下，它有机会同时扮演“Claude Code executor”与“第三方兼容执行器”

所以最终结论不是一句“能”或“不能”，而是：

1. Claude Code 完全可以作为被调度系统控制的底层执行器
2. 但它是否顺便解决第三方兼容，取决于你接入的是哪个 Claude Code 内核版本，以及它自身支持哪些 provider
3. 无论如何，它都不该替代 `Project / Run / Stage` 这一层真相源

---

## 5. Task B 到底在做什么

Task B 的目标不是继续迁功能，而是继续把下列细节从 `group-runtime.ts` 往下压：

1. `grpc.getTrajectorySteps`
2. `grpc.updateConversationAnnotations`
3. `getOwnerConnection()`
4. `discoverLanguageServers()`
5. `getApiKey()`

这些东西的共同点是：

1. 它们都不是业务编排语义
2. 它们都是 Antigravity 专有的 transport / runtime 解析细节
3. 它们继续留在 orchestration 层，会导致以后每接一个新后端都去碰 `group-runtime.ts`

所以 Task B 本质上是在完成这句话：

> 让 `group-runtime` 只理解“我要一个诊断结果 / 我要写一个会话元数据 / 我要附着一个会话”，而不理解这些事底层是通过什么 RPC 完成的。

---

## 6. Task B 做完以后，系统应该是什么状态

Task B 完成后的理想状态不是“代码行数更少”，而是边界更稳定。

至少应满足下面 6 条：

1. `group-runtime.ts` 不再直接 import Antigravity transport 读取能力来做执行链主逻辑
2. `evaluate` 不再自己直接调 trajectory / annotation RPC
3. owner / apiKey / language-server 解析主要由 backend 或 transport adapter 负责
4. 新 Provider 接入时，不需要再去给 `group-runtime.ts` 加 provider 特判
5. attached-session、cancel、evaluate 的异常矩阵有明确测试护栏
6. orchestration 层只保留业务语义：谁执行、执行哪一轮、用哪个 stage、如何推进 pipeline

如果做到这一步，就可以说：

1. 任务 A 解决了“功能入口统一”
2. 任务 B 解决了“结构边界统一”

---

## 7. Task B 不是要做什么

为了避免后续再把范围做散，Task B 当前不应该顺手扩成下面这些工作：

1. 不新增新的产品功能入口
2. 不先扩 Codex append / streaming text
3. 不先做 MemoryHooks 真正注入 prompt
4. 不先讨论 WorkflowExecutor 或 Prompt/Template 命名问题

这些都可能重要，但不属于“把 RPC 等放到底层”的工作本体。

---

## 8. 最稳的推进顺序

### Phase 1. 先抽 evaluate

先处理：

1. recent steps 读取
2. annotation 写回

原因：

1. 这是目前最局部的 transport 读取点
2. 也是最容易验证“下沉后边界有没有更干净”的切口

### Phase 2. 再抽连接解析

继续处理：

1. owner 解析
2. apiKey 解析
3. language server 发现

原因：

1. 这是让 orchestration 层彻底摆脱 Antigravity runtime 细节的关键一步

### Phase 3. 最后补异常矩阵

补齐：

1. shared attached session
2. evaluate session
3. unattached cancel

原因：

1. 这些路径已经 session 化
2. 但如果没有异常矩阵，后续继续下沉最容易把边界回退

---

## 9. 一句话结论

现在系统已经完成了“所有现有功能入口都走 Event session 主链”。

接下来要做的 Plan B，不是继续迁功能，而是把剩余的 RPC / gRPC / owner / language-server 解析从 orchestration 层继续压到底层，让未来 OpenAI 等独立后端只需要接 Provider / Backend 层，而不需要再碰业务运行时。