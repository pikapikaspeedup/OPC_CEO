# AgentBackend Event Architecture Gap Checklist

## 目标

这份清单只回答一件事：如果 Antigravity 的执行运行时要真正完成向 AgentBackend / AgentSession / session-consumer 事件架构迁移，当前还剩哪些现实缺口没有收口。

这里不讨论“大重构”，只记录当前源码里仍然存在的旧路径、半接通能力、测试矩阵缺口，以及最稳的后续顺序。

---

## 已完成的主链范围

### 1. Prompt Mode 已完成迁移

- 文件：src/lib/agents/prompt-executor.ts
- 当前主链：applyBeforeRunMemoryHooks -> getAgentBackend -> start -> registerAgentSession -> consumeAgentSession -> createRunSessionHooks
- 含义：Prompt Mode 已经不再自己维护本地 watcher / activePromptRuns，而是正式走新的 session 事件消费模型。

### 2. legacy-single 已完成迁移

- 文件：src/lib/agents/group-runtime.ts
- 当前主链：dispatchRun 的 legacy-single 分支改为 AgentBackend session path
- 含义：Template 的单角色运行态已经和 Prompt Mode 使用同一条 session runtime 主链。

### 3. multi-role 的 isolated 主链已完成迁移

- delivery-single-pass：已走角色级 session helper
- review-loop isolated：author / reviewer 已走角色级 session helper
- 含义：多角色主执行面已经不再依赖旧的 createAndDispatchChild + watchConversation 直连模式。

### 4. Antigravity 的 watcher parity 已下沉到 backend 叶子层

- 文件：src/lib/backends/builtin-backends.ts
- 已保留的关键能力：
  - autoApprove
  - artifact 文件轮询兜底完成
  - watch stream 断线重连
  - owner 路由 append / cancel
  - hasErrorSteps -> failed 映射

### 5. session 基础设施已经完整成形

- backend registry
- session registry
- session consumer
- run-session-hooks
- memory-hooks 骨架

这意味着新事件架构已经不是概念设计，而是已经覆盖主 dispatch path 的真实运行时。

### 6. 原来剩余的功能级尾巴已经迁完

- shared conversation 复用作者对话：已改为 attach 既有 handle 的 AgentSession + append
- interveneRun.nudge：已不再回退到 runtime 自己的 grpc watcher
- interveneRun.restart_role：已改为新的 session 启动路径
- interveneRun.evaluate：已改为一次性 AgentSession 执行，不再手工 startCascade/sendMessage/poll completion
- cancelRun 的“无活跃 session 但有 handle”场景：已改为 backend.attach + session.cancel

结论：如果只从“已有功能是否还在走旧执行入口”来看，任务 A 已经完成。

---

## 功能迁移状态

### 1. 任务 A 已完成

此前属于“现有功能还没迁完”的这几条路径，已经都不再作为真实执行入口存在：

1. shared conversation fallback
2. nudge fallback
3. restart_role old path
4. evaluate 的旧会话轮询执行路径
5. cancelRun 的直接 runtime cancelCascade fallback

当前从 `group-runtime.ts` 看，已经不再保留这些旧执行入口：

- `createAndDispatchChild`
- `watchUntilComplete`
- `grpc.startCascade` 执行入口
- `grpc.sendMessage` 执行入口
- `grpc.cancelCascade` 执行入口

结论：按“现有功能全部迁完，不留旧入口”的口径，任务 A 已收口。

---

## 任务边界澄清

### 1. "把剩余旧路径也迁完" 这个任务已经完成

这部分原本属于当前 AgentBackend / AgentSession / session-consumer 迁移任务的功能收尾。

现在这一步已经完成，因此后续不应再把“shared / nudge / restart / evaluate / cancel fallback 还没迁”当成待办项继续讨论。

换句话说：

- 现在已经可以说“现有功能入口都进了新事件架构”。

### 2. "把 grpc 等 transport 从 group-runtime 抽到底层" 是相关但独立的结构收口任务

这个任务和“把旧路径迁到新事件架构”高度相关，但不是完全同一件事。

更准确地说，它是**结构层面的第二任务**：

- 目标不是只让功能跑到新 session 主链
- 目标是让 `group-runtime.ts` 不再直接持有 Antigravity transport 细节

当前在 `group-runtime.ts` 中直接出现的 transport 细节包括：

1. `grpc.getTrajectorySteps`
2. `grpc.updateConversationAnnotations`
3. `getOwnerConnection()`
4. `discoverLanguageServers()`
5. `getApiKey()`

这说明 `group-runtime` 虽然已经没有旧执行入口，但 orchestration 层仍然直接理解了一部分 Antigravity transport / infra 细节。

### 3. 这两个任务的关系

最稳的理解方式是：

1. **功能迁移任务**：把所有已有功能路径先迁到统一事件架构，不再让旧路径继续作为真实执行入口。这个任务已经完成。
2. **结构下沉任务**：把残留的 Antigravity transport / gRPC / infra 细节从 `group-runtime` 继续下沉到 backend 或专门 transport adapter。这个任务仍未完成。

因此：

- 它们不是同一个任务
- 但也不是彼此无关
- 正确关系是：**前者是功能收尾，后者是架构净化**

### 4. 不建议把目标层直接表述成 Provider

之前说“从 `group-runtime` 抽到底层去”这个方向是对的，但更准确的目标层不一定是 `Provider` 本身。

更稳的目标应该是：

1. `Provider` 继续负责 provider 选择、能力和执行器入口
2. Antigravity 专有的 conversation transport 细节下沉到 `AgentBackend` 或专门 transport adapter
3. `group-runtime` 只保留 orchestration 语义，不再直接理解 gRPC transport 细节

原因很简单：

- `getTrajectorySteps` / owner routing / annotation` 这些不是通用 provider 概念
- 它们是 **Antigravity conversation transport 细节**
- 直接塞进通用 Provider 层，会把 Provider 层重新污染成 transport 特化层

所以更准确的话不是“全部挪到 Provider”，而是“全部从 `group-runtime` 挪到底层 transport/backend 层”。

### 5. 现在如果按任务拆分，建议这样命名

1. **任务 A：现有功能全部迁完，不留旧入口**
  - 状态：已完成
2. **任务 B：transport 下沉与 group-runtime 净化**
  - 把残留的 gRPC / owner / trajectory / annotation 细节从 `group-runtime` 抽离
  - 收口到 backend / transport adapter

现在系统功能上已经可以认为“现有功能都进新事件架构了”。

接下来只有连任务 B 一起完成，才能说 `group-runtime` 在结构上也真正脱离了 Antigravity transport 细节。

### 6. Task B 的实际实施边界

Task B 现在不是“继续迁功能”，而是把 orchestration 层里残留的 Antigravity transport / infra 读取继续往下压。

更具体地说，Task B 应拆成 4 组：

1. **会话诊断读取下沉**
  - 目标：把 `evaluate` 中的 `grpc.getTrajectorySteps` 从 `group-runtime.ts` 移走
  - 建议去向：`AgentBackend` 的只读诊断能力，或 Antigravity 专用 transport adapter
  - 结果：`group-runtime` 不再直接理解 trajectory steps 拉取协议
2. **会话元数据写回下沉**
  - 目标：把 `grpc.updateConversationAnnotations` 从 `group-runtime.ts` 移走
  - 建议去向：backend 叶子层的 annotation helper
  - 结果：supervisor / evaluate 不再自己写 Antigravity conversation annotation
3. **owner / apiKey / language server 解析下沉**
  - 目标：把 `getOwnerConnection()`、`discoverLanguageServers()`、`getApiKey()` 这些连接解析细节从 orchestration 层移走
  - 建议去向：backend attach/start 所需的 runtime resolver
  - 结果：`group-runtime` 不再自己做 Antigravity server 发现和 owner 路由
4. **异常矩阵补齐**
  - 目标：先把 shared attach、evaluate、unattached cancel 的异常路径锁进测试
  - 原因：如果不先补测试，继续下沉 transport 时很容易把现在已经打通的 session 语义弄回退

可以把这 4 组理解成：

1. 先抽“读”
2. 再抽“写”
3. 再抽“连接解析”
4. 最后用异常矩阵把新边界锁住

这才是当前真正的 Plan B。

### 7. Task B 不应该碰的东西

为了避免再次把任务边界搞混，Task B 当前**不应该**顺手扩到下面这些方向：

1. 不做新的功能入口
2. 不重做 Template / Prompt / Scheduler 语义
3. 不先扩 Codex append / streaming text
4. 不把 MemoryHooks 真正接进 prompt 拼装

这些都属于后续能力建设，不是本轮“把 RPC 等压到底层”的工作本体。

---

## 已有骨架但未真正接通的能力

### 1. MemoryHooks 只是生命周期骨架

- 文件：src/lib/backends/memory-hooks.ts
- 现状：beforeRun 能聚合 memoryContext，afterRun 能注册 hook
- 问题：memoryContext 还没有真正进入 backend 执行提示或 provider 调用

结论：现在是“可以挂 memory 数据”，但不是“记忆已经影响了执行”。

### 2. multi-role afterRun MemoryHooks 已统一

- Prompt、legacy-single、multi-role 三条路径的 afterRun MemoryHooks 生命周期已经对齐
- `consumeTrackedRoleAgentSession` 在 completed / failed / cancelled 三个 terminal event 后统一调用 `applyAfterRunMemoryHooks()`
- 测试护栏已在 `group-runtime.multi-role.test.ts` 中锁定（每个角色 session 结束后都会触发 afterRun hook）

结论：生命周期管道已打通。MemoryHooks 本身仍是骨架（memoryContext 还没有真正进入执行提示），但不再存在"multi-role 路径断开"的问题。

### 3. streaming text 仍是合同占位，不是上层能力

- 文件：src/lib/backends/types.ts
- 现状：capabilities 和 finalText 字段已存在
- 问题：session-consumer 没有 streaming text 的钩子，上层没有真正消费这类事件

### 4. Codex 多轮 append 仍未接通

- 当前策略：显式不暴露 append
- 含义：Codex session 现在只是“兼容新架构的单次执行器”，不是完整多轮 session backend

---

## 测试矩阵仍欠缺的部分

### 1. multi-role 的 cancelled / timeout runtime 用例仍缺

当前已覆盖 completed / failed / blocked，但 cancelled / timeout 还主要依赖共享逻辑推断，没有显式 characterization tests。

### 2. Antigravity session.cancel 的专项测试仍缺

Codex cancel 已测，但 Antigravity cancel 后的事件序列和 registry 行为还没有单独锁住。

### 3. attach / attached-session 路径仍缺异常矩阵

- shared attached session 的 cancel / timeout / superseded
- evaluate session 的 failed / cancelled / malformed response
- unattached cancel 的 attach failure / missing owner 映射

### 4. run-session-hooks 仍缺独立专项测试

当前公共桥接逻辑没有单独测试文件，默认 started/live_state/failed/cancelled 写回与 afterRun hook 调用还没被独立锁住。

### 5. shared attached-session 分支仍缺异常矩阵

当前 shared conversation 已覆盖主成功路径，但 attached session 语义还没有覆盖 cancel / timeout / reconnect-failure / superseded。

---

## 推荐的后续迁移顺序

### Phase A. 先做结构下沉最重的 transport 读取点

优先处理：

1. evaluate 中的 `grpc.getTrajectorySteps`
2. evaluate 中的 `grpc.updateConversationAnnotations`
3. owner / apiKey / language server 解析逻辑的下沉边界

原因：功能入口已经迁完，下一阶段最主要的收益来自把 orchestration 层中的 transport 读取与连接细节继续向下收口。

#### Phase A 的建议落点

1. 给 Antigravity backend 增加只读诊断接口，专门承载 recent steps / annotation 之类的 transport 特有能力
2. 让 `evaluate` 先切过去，作为 Task B 的第一条最小主链
3. 只要 `evaluate` 跑通，再收 owner / apiKey / language server resolver

原因：`evaluate` 是最局部、最容易验证的 transport 下沉切口。

### Phase B. multi-role hooks 生命周期 — 已完成

multi-role 的 `consumeTrackedRoleAgentSession` 已补齐 `applyAfterRunMemoryHooks()` 调用，afterRun MemoryHooks 已正式进入多角色主链。测试已锁定。

### Phase C. 补 attached-session 异常矩阵

shared / evaluate / unattached cancel 都已经 session 化，但异常矩阵仍不完整。应先补 characterization tests，再继续抽 transport。

### Phase D. 收骨架能力

最后才处理：

1. memoryContext 真接通执行提示
2. streaming text 消费面
3. Codex 真实 handle / reply 能力

这些都重要，但不应抢在干预链路与 shared fallback 之前。

---

## 当前判断

如果把目标定义成“现有功能入口已经全部换到新事件架构”，这件事现在已经完成。

如果把目标定义成“group-runtime 在结构上也不再直接理解 Antigravity transport / infra 细节”，那现在还剩 Task B 没完成。