# 开放式 API 与通用执行器策略

日期：2026-04-09  
状态：研究结论 / 路线建议

## 一句话结论

如果未来要支持开放式 API，并让 Craft 或 Claude Code 这类外部执行器受到 Antigravity Platform 的完整调度，答案是：

1. **可以被完整调度**
2. **但前提是它们只位于 execution plane，而不是替代 control plane**
3. **短期更适合先接 Claude Code 作为强 coding executor**
4. **长期更值得朝 craft-style execution shell 收口，而不是直接把平台建立在 craft 或 Claude Code 之上**
5. **写代码任务不应该无差别默认全派给 Claude Code，而应该由 Antigravity Platform 按任务类型和能力矩阵做路由**

---

## 1. 这份文档回答什么

这份文档专门回答三个问题：

1. 如果未来要使用开放式 API，Craft 或 Claude Code 能不能变成受 Antigravity Platform 完整调度的通用执行器
2. 如果主要目标是“写代码”，是不是最好直接把任务派给 Claude Code
3. Task B 与这件事的关系到底是什么

它和已有文档的分工如下：

1. `docs/design/provider-integration-and-task-b-plan.md` 负责说明 Provider 应接在哪一层，以及 Task B 的结构边界
2. `docs/internals/antigravity-vs-craft-feasibility-study.md` 负责说明为什么不该把 Antigravity 平台直接建立在 craft 之上
3. **这份文档负责回答执行器选择与任务路由策略**

---

## 2. 先把“完整调度”说清楚

这里的“完整调度”不应该理解成：

1. 每个执行器都必须拥有 Antigravity Native Executor 的全部 IDE transport 能力
2. 每个执行器都必须支持 trajectory、annotation、owner routing、artifact review

更准确的定义应该是：

> Antigravity Platform 继续持有 Project / Run / Stage / review-loop / artifact / governance 真相源，而 execution executor 只负责在指定 workspace 内执行一次任务，并把生命周期和结果稳定回写给平台。

也就是说，“完整调度”的最低要求是：

1. 控制层能创建 run 并绑定 workspace、stage、artifactDir、timeout
2. 执行器能被程序化 start
3. 控制层能拿到可追踪 handle 或稳定运行标识
4. 控制层能知道 terminal state：completed / failed / cancelled
5. 控制层能在能力允许时执行 cancel、append、attach
6. 执行结果能稳定落回 artifact / result / run 状态合同

因此：

1. **完整调度 = 生命周期受控**
2. **不等于能力完全同构**

---

## 3. 当前最真实的接缝在哪

从现有代码看，Antigravity 已经有相对明确的执行接缝。

### 3.1 控制层真相源

控制层主要仍在这些文件：

1. `src/lib/agents/dispatch-service.ts`
2. `src/lib/agents/group-runtime.ts`
3. `src/lib/agents/run-registry.ts`
4. `src/lib/agents/project-registry.ts`
5. `src/lib/agents/scheduler.ts`

它们决定：

1. 这次 run 属于哪个 Project / Stage
2. 何时启动、何时继续、何时终止
3. review-loop、source contract、artifact 与治理语义如何推进

### 3.2 execution seam

真正适合挂外部执行器的接缝在两层：

1. `src/lib/providers/types.ts`
2. `src/lib/backends/types.ts`

可以把它们理解成两级合同：

1. `TaskExecutor`
  - 更像 provider leaf contract
  - 负责 `executeTask()` / `appendMessage()` / `cancel()` / `capabilities()`
2. `AgentBackend` / `AgentSession`
  - 更像统一 session lifecycle contract
  - 负责 `start()` / `events()` / `cancel()` / 可选 `attach()` / `append()`

这意味着未来外部执行器最合理的接法不是碰 `group-runtime.ts`，而是：

1. 实现新的 provider leaf
2. 再包装成新的 `AgentBackend`
3. 让现有 orchestration 复用这层统一会话面

---

## 4. Task B 和这件事的关系

Task B 不是“再决定选 Claude Code 还是 craft”。

Task B 的本质是：

> 继续把残留在 orchestration 层里的 Antigravity Native transport 细节往下压，让控制层只理解执行语义，不再直接理解 Native Executor 的 RPC / gRPC / runtime 解析细节。

它的价值恰好就在这里：

1. 不做完 Task B，外部 executor 能接，但接缝会继续不干净
2. 做完 Task B，控制层和执行层边界会更稳定
3. 这样未来新增 Claude Code executor、craft-style executor 或 direct Open API backend 时，就不需要继续碰 `group-runtime.ts`

所以顺序应该是：

1. **Task B 先净化接缝**
2. **外部 executor 再顺着这个接缝接入**

---

## 5. Claude Code 应该怎么理解

Claude Code 的位置应该放在：

> 强本地 coding executor

而不是：

> Antigravity Platform 的长期 execution substrate

### 5.1 为什么它适合先接入

Claude Code 的优势很实际：

1. 已经非常擅长在本地 workspace 内改代码、跑命令、调用工具
2. 比“纯 API backend”更接近真正的软件工程执行器
3. 当前这份逆向仓库已经明确支持多 provider 路线，包括 OpenAI、Gemini、Grok 等 compatibility layers
4. 已存在较现实的机器调用面

当前最值得关注的调用面有两类：

1. CLI headless 面
  - `claude -p`
  - `--input-format stream-json`
  - `--output-format stream-json`
  - `--session-id`
2. bridge / remote-control 面
  - 适合后续需要 interrupt、append、session 级控制时再接

从短期可落地性看，Claude Code 很适合做：

1. Prompt Mode executor
2. legacy-single executor
3. 单 stage coding executor

### 5.2 为什么它不适合直接当长期通用底座

Claude Code 的问题不在“不会写代码”，而在“它本身不是为 Antigravity 这种 control plane 设计的 execution substrate”。

当前主要限制有四个：

1. 这份仓库是 reverse-engineered / decompiled 版本
2. 一部分入口仍受 feature flag、stub、未恢复控制面影响
3. provider 面成熟度高于 session / control 面成熟度
4. 它更像完整 coding product，而不是纯粹 backend runtime shell

所以更准确的判断是：

1. **Claude Code 很适合做短期强执行叶子 executor**
2. **不适合直接被当成 Antigravity Platform 的长期通用 execution 基座**

---

## 6. craft 应该怎么理解

craft 的位置应该放在：

> 更接近长期 execution shell 参考对象

而不是：

> Antigravity Platform 的替代基座

### 6.1 它真正强在哪

craft 更值得借的地方主要是：

1. backend / session / event 分层更自然
2. capability-driven executor 模型更干净
3. 第三方 provider 路线更像 execution substrate，而不是某个单独 coding product 的外挂能力

这和 Antigravity 当前正在推进的方向其实一致：

1. `AgentBackend`
2. `AgentSession`
3. `session-consumer`
4. capability matrix

### 6.2 为什么不能直接拿来当基座

因为 craft 的主轴是：

1. workspace
2. session
3. backend
4. event

而 Antigravity 的主轴已经变成：

1. Project
2. Run
3. Stage
4. review-loop
5. governance

如果直接基于 craft 重做，真正的风险不是 provider 接不上，而是：

1. 你会把控制层重新压扁成 session-first 产品壳
2. Project / Run / Stage 会被迫去适配 craft 的 session 语义
3. 平台最稀缺的 control plane 资产会被稀释

所以对 craft 更稳的定位是：

1. **长期 execution shell 参考对象**
2. **未来可能的可选 executor**
3. **不应直接替代 Antigravity Platform**

---

## 7. 那写代码是不是最好直接派给 Claude Code

不是“全部都派”，而是“适合的一类任务优先派”。

这里最容易出错的地方，是把两个问题混成一个：

1. Claude Code 会不会写代码
2. Antigravity Platform 应不应该把所有 coding task 默认都派给 Claude Code

第一题的答案通常是：

1. **会，而且通常很强**

第二题的答案是：

1. **不应该默认全部都派**

原因很简单：

1. 不是所有任务都需要完整 coding shell
2. 不是所有 stage 都适合脱离 Native Executor 的 transport 能力
3. 平台需要保留按任务类型和能力矩阵路由的权力

### 7.1 适合优先派给 Claude Code 的任务

下面这类任务很适合优先派给 Claude Code executor：

1. 单 stage 的代码实现任务
2. Prompt-first 的修 bug、重构、脚手架生成
3. 需要真实 shell / file edit / repo 内搜索 / 命令执行的任务
4. 需要在本地 workspace 内快速产出代码结果的执行任务

### 7.2 不适合默认优先派给 Claude Code 的任务

下面这些任务不应简单默认走 Claude Code：

1. 强依赖 Antigravity Native transport 的任务
  - trajectory
  - annotation
  - owner routing
  - artifact review
2. 已高度绑定现有 multi-role review-loop 语义的任务
3. 纯分析、分类、总结、评估型任务
  - 这类更适合 direct Open API backend
4. 需要长期沉淀成统一 runtime contract 的任务
  - 这类更应该推动 execution shell 抽象，而不是把 Claude Code 当系统底座

所以更稳的结论是：

> 对“写代码”这类任务，Claude Code 很适合成为高优先级执行器，但不应该成为平台唯一或默认不可替换的执行器。

---

## 8. 更合理的任务路由策略

未来最稳的路由策略不是“全走 Claude Code”，而是“三路并存，由 Platform 决策”。

### 路由 A：Antigravity Native Executor

适合：

1. 需要 Native IDE transport 能力的任务
2. 需要 trajectory / annotation / artifact review 的任务
3. 已深度依赖现有 review-loop 运行语义的任务

### 路由 B：Claude Code Executor

适合：

1. 强 coding 导向的单 stage 或 prompt 任务
2. 需要真实 workspace 工具链的任务
3. 需要更强本地代码编辑与命令执行能力的任务
4. 想快速拿到开放式 API + coding shell 组合能力的任务

### 路由 C：Direct Open API Backend

适合：

1. 纯分析
2. 纯评估
3. 总结 / 分类 / brief
4. 不需要重工具链和本地 shell 的任务

### 路由 D：craft-style Executor

适合：

1. 长期统一 execution shell
2. 多 provider runtime 标准化
3. 想让 session / event / capability 抽象进一步稳定化的阶段

这四类路由不是互斥，而是：

1. **由 Antigravity Platform 统一治理**
2. **由 execution plane 承担不同强度的执行能力**

---

## 9. 推荐路线

### Phase 1

先完成 Task B 的接缝净化：

1. `evaluate` 的 recent steps / annotation 下沉
2. owner / apiKey / language server 解析下沉
3. attached-session / cancel / evaluate 异常矩阵补齐

### Phase 2

把外部 executor 最小合同写死：

1. `TaskExecutor`
2. `AgentBackend`
3. capability matrix
4. terminal semantics
5. artifact / result 回传合同

### Phase 3

优先接 Claude Code executor 的最小 PoC：

1. 先走 CLI headless 面
2. 先做单次 session 执行
3. 先接 Prompt Mode 或 legacy-single
4. append / attach / interrupt 后续再扩

### Phase 4

在平台层补任务路由策略：

1. 哪些 stage 默认走 Native Executor
2. 哪些 stage 默认走 Claude Code
3. 哪些任务直接走 Open API backend

### Phase 5

只有在前面跑通以后，再决定是否继续朝 craft-style runtime 收口：

1. 借设计
2. 借局部实现
3. 或引入可选 craft-like executor

---

## 10. 最终决策

如果把这次问题压缩成三句话，最稳的答案是：

1. **Craft 和 Claude Code 都可以被 Antigravity Platform 完整调度，但前提是它们只作为 execution plane 成员存在，不替代 control plane。**
2. **对“写代码”这类任务，短期最值得优先接的是 Claude Code executor；但不应把所有任务都默认派给它。**
3. **长期真正该建设的是统一 execution shell 合同；从方向上看，更接近 craft-style runtime，而不是把整个平台建立在某个 coding product 上。**

一句话总结：

> Antigravity Platform 继续负责决策、治理和真相源；Claude Code 先做强执行叶子；craft 作为长期 execution shell 方向，而不是平台基座。