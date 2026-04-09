# Antigravity 控制层与执行层概念对齐

日期：2026-04-09  
状态：概念对齐稿 / 已入库

## 一句话结论

现在最容易混淆的地方，不是 craft、Claude Code 或第三方 API，而是：

> “Antigravity” 这个词本身同时被拿来指整个平台、当前原生执行器、以及历史上的 CLI/IDE 能力。

如果不先拆开这层概念，后面所有关于第三方 API、下层执行器、Task B、Workspace 的讨论都会反复串层。

更稳的定义应该是：

1. **Antigravity Platform**：整个产品与系统
2. **Antigravity Control Plane**：决策、编排、治理、状态真相源
3. **Antigravity Native Executor**：当前基于 Google Antigravity language server 的原生执行器

换句话说：

1. Antigravity 不应再只被理解成执行层
2. 也不应只被理解成 CEO/OPC 决策层
3. 它应该被理解成“一个平台”，其中控制层和执行层是两个不同平面

---

## 1. 为什么现在会混乱

最初这套产品更接近一个 Antigravity CLI / IDE 协同执行系统。

但随着系统长出：

1. Project
2. Run
3. Stage
4. review-loop
5. CEO Office
6. Scheduler
7. Approval
8. Department Memory

它实际上已经不只是一个“执行器前端”，而是开始长成一个 OPC 风格的平台。

问题在于，命名还停留在旧阶段，导致讨论时经常把三件事混成一句“Antigravity”：

1. 当前基于 language server 的执行能力
2. 顶层的 Project / Run / Stage / governance 编排层
3. 整个产品

这就是模糊的来源。

---

## 2. 最稳的两层模型

## 2.1 控制层

控制层回答的问题是：

1. 做什么
2. 为什么做
3. 谁批准
4. 由谁执行
5. 结果记到哪里
6. 失败后怎么恢复
7. 什么时候继续、暂停、重试、升级

也就是说，控制层负责：

1. Project
2. Run
3. Stage
4. template / review-loop / source contract
5. artifact 真相源
6. scheduler / CEO / approval / intervention
7. 预算、规则、治理、审计

当前最典型的控制层模块是：

1. `src/lib/agents/project-registry.ts`
2. `src/lib/agents/run-registry.ts`
3. `src/lib/agents/group-runtime.ts`
4. `src/lib/agents/dispatch-service.ts`
5. `src/lib/agents/scheduler.ts`
6. `src/lib/agents/ceo-agent.ts`

### 控制层的本质

控制层不是“谁真的去改文件”。

控制层的本质是：

> 决定任务生命周期与治理语义，并维护系统真相源。

---

## 2.2 执行层

执行层回答的问题是：

1. 在这个 workspace 里，agent 具体怎么工作
2. 它怎么改文件
3. 它怎么跑命令
4. 它怎么调用工具
5. 它怎么暴露 started / completed / failed / cancelled
6. 它是否支持 append / attach / live state / streaming

也就是说，执行层负责：

1. 具体执行一次任务
2. provider / backend / transport 差异
3. 会话生命周期
4. 权限控制与工具调用边界
5. 在给定 workspace 中实际产出文件与结果

当前最典型的执行层模块是：

1. `src/lib/backends/types.ts`
2. `src/lib/backends/session-consumer.ts`
3. `src/lib/backends/builtin-backends.ts`
4. `src/lib/providers/`
5. Google Antigravity language server / bridge / gRPC 路径

未来也可能包括：

1. Claude Code executor
2. craft-based executor
3. OpenAI-only backend
4. 其它第三方 workspace executor

### 执行层的本质

执行层不是系统真相源。

执行层的本质是：

> 在控制层下发的 contract 之内，实际完成一次 workspace 中的执行。

---

## 3. 所以 Antigravity 到底是什么

如果今天只说“Antigravity”，最稳的答案应该是：

> Antigravity 是整个平台，而不是单独某一层。

但为了避免歧义，后续文档和讨论最好强制拆开三个词。

### 3.1 Antigravity Platform

指整个产品：

1. OPC
2. CEO Office
3. Project / Run / Stage
4. Scheduler / Approval / Memory
5. 下层一个或多个执行器

### 3.2 Antigravity Control Plane

指顶层系统真相源和编排层。

这是现在真正长成 OPC 框架的部分。

### 3.3 Antigravity Native Executor

指当前基于 Google Antigravity language server 的原生执行器。

它是执行层里的一个成员，而且目前是最强、能力最完整的那个成员。

但它不应再被等同成整个平台。

---

## 4. 为什么这个区分现在很重要

因为一旦区分清楚，很多问题会立即变简单。

### 问题 1：第三方 API 能不能支持

如果不区分层次，这个问题会被误读成：

1. 要不要用第三方 API 替代整个 Antigravity

但真正的问题其实是：

1. 能不能在执行层新增一个第三方 executor / backend
2. 让控制层继续不变

答案通常是：可以。

### 问题 2：Claude Code / craft 能不能接进来

如果不区分层次，这个问题会被误读成：

1. 要不要基于 Claude Code / craft 重做产品

但真正的问题是：

1. 它们能不能作为执行层的一种实现，被控制层调度

答案也是：可以。

### 问题 3：Workspace 到底属于谁

如果不区分层次，就会变成：

1. Workspace 是执行器的
2. Workspace 也是顶层系统的

更准确的说法应该是：

1. 控制层拥有**逻辑 Workspace**
  - 仓库根
  - artifact 挂载
  - Project / Run / Stage 上下文
  - rules / memory / policy
2. 执行层拥有**执行能力 Workspace**
  - 是否有 language server
  - 是否有 owner routing
  - 是否有 live state / trajectory
  - 是否能改文件 / 跑命令 / 工具调用

---

## 5. 一个简单判断法

以后如果你不确定某个能力应该属于哪一层，最简单的判断问题是：

### 5.1 如果它回答的是“做什么、为什么、谁批准、状态如何记录”

它属于控制层。

例如：

1. 这是哪个 Project
2. 当前 Run 属于哪个 Stage
3. review-loop 下一轮是否继续
4. scheduler 是否允许触发
5. CEO 是否批准继续执行

### 5.2 如果它回答的是“如何实际在 workspace 中完成动作”

它属于执行层。

例如：

1. 怎么打开会话
2. 怎么 edit file
3. 怎么调用 bash
4. 怎么 cancel
5. 怎么回传 terminal event

这个判断法在工程上非常重要，因为它直接决定了哪些代码不该继续堆在 `group-runtime.ts`。

---

## 6. 对当前系统最合适的概念对齐

如果按现在的真实产品形态来定义，我建议内部统一这样说：

1. **Antigravity 已经不是单纯执行器，而是平台**
2. **OPC / CEO / Project / Run / Stage / governance 属于控制层**
3. **Google Antigravity language server 只是当前默认原生执行器**
4. **Claude Code、craft、OpenAI API backend 都可以是替代或补充执行层，不应替代控制层**

这句话一旦成立，后面的架构路线也会自然稳定：

1. Task B 做的是让控制层不再持有原生执行器 transport 细节
2. AgentBackend 做的是控制层与执行层的标准接口
3. 新增第三方 API，本质上是新增执行层成员，而不是重定义平台本身

---

## 7. 推荐命名策略

为了减少后续歧义，建议在文档和讨论中尽量避免单独说“Antigravity 会不会做这个”。

更稳的说法是：

1. **Antigravity Platform**
2. **Antigravity Control Plane**
3. **Antigravity Native Executor**
4. **External Executors**
  - Claude Code Executor
  - craft Executor
  - OpenAI Backend

只要命名稳住，很多争论都会自动少一半。

---

## 8. 最终建议

当前最需要的不是继续争论“Antigravity 到底像 CLI 还是像 OPC”，而是正式承认：

> 它已经从“单一执行器产品”长成“控制层 + 执行层”的平台了。

从这个角度看：

1. 顶层继续往 OPC / Control Plane 方向演进是对的
2. 下层同时保留原生执行器，并逐步开放 Claude Code / craft / 第三方 API backend 也是对的
3. 这两个方向不是冲突，而是平台自然分层后的结果