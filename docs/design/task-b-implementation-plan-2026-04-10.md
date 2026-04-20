# Task B 落地计划

日期：2026-04-10  
状态：实施计划 / 代码级拆解

## 一句话结论

Task B 现在已经不再是“继续迁功能”，而是：

> 把 `group-runtime.ts` 中残留的 Antigravity Native transport 读取与连接解析彻底压到底层 backend / transport adapter，让 orchestration 层只保留业务编排语义。

从当前代码看，最稳的落地顺序不是大重构，而是 3 步：

1. **先抽 evaluate 的 recent steps 读取**
2. **再抽 evaluate 的 annotation 写回**
3. **最后收 owner / apiKey / language server 解析，并补异常矩阵**

---

## 1. 当前代码里，Task B 还剩哪些真实泄漏点

这部分不是文档推测，而是当前源码里的真实残留。

## 1.1 `group-runtime.ts` 的 evaluate 分支仍直接理解 Native transport

当前 `interveneRun(..., 'evaluate')` 里还直接做了这些事：

1. `discoverLanguageServers()`
2. `getApiKey()`
3. `grpc.getTrajectorySteps(...)`
4. `getOwnerConnection(...)`
5. `grpc.updateConversationAnnotations(...)`

对应位置主要在：

1. `src/lib/agents/group-runtime.ts`

这说明虽然 evaluate 已经 session 化，但 orchestration 层仍在自己做：

1. server discovery
2. 凭证解析
3. 诊断读取
4. annotation 写回

这正是 Task B 需要继续清掉的东西。

## 1.2 attach / cancel 主链已经 session 化，但 attach 的环境解析仍偏 runtime helper

当前 `cancelRun()` 已经走：

1. 活跃 session 直接 `session.cancel()`
2. 无活跃 session 但有 handle 时，走 `attachExistingRunSession()`

这一步功能上已经没问题，但如果之后还要继续做 provider-neutral attach / resume，相关解析最好继续收口到 backend 侧，而不是散在 runtime helper 里。

对应位置：

1. `src/lib/agents/group-runtime.ts`

## 1.3 backend 层已经拥有大部分 Native 能力，但缺一个“诊断 / 元数据”窄接口

当前 `src/lib/backends/builtin-backends.ts` 已经承担：

1. watch stream
2. owner 路由 append / cancel
3. reconnect
4. artifact auto-approve
5. hasErrorSteps -> failed 映射

也就是说：

1. Native transport 细节大部分已经在 backend 叶子层
2. 还缺的是一个把 evaluate 所需的“只读诊断 + metadata 写回”也沉下去的窄接口

---

## 2. Task B 的目标状态

Task B 做完以后，`group-runtime.ts` 不应该再自己知道：

1. language server 怎么发现
2. apiKey 从哪拿
3. recent steps 怎么拉
4. annotation 怎么写到 conversation

它只应该知道：

1. 我要对某个已有 handle 做诊断读取
2. 我要给某个会话写一段 metadata
3. 某个 backend 支不支持这类能力

也就是说，最终目标不是“所有 backend 都支持 trajectory / annotation”，而是：

1. **控制层不再直接依赖 Native transport**
2. **backend 通过 optional capability 暴露 transport-specific 能力**

---

## 3. 建议的代码落点

## 3.1 不建议把所有东西继续塞进通用 `AgentBackend` 主接口

当前 `src/lib/backends/types.ts` 的 `AgentBackend` 已经比较干净：

1. `start()`
2. `attach?()`
3. `capabilities()`

Task B 里要下沉的能力不是所有 backend 都该有，所以不建议把这些能力强塞成通用强制接口。

更稳的做法是新增一个**可选扩展面**，例如：

1. backend diagnostics extension
2. backend session metadata extension

可以是单独的新文件，例如：

1. `src/lib/backends/extensions.ts`
2. 或 `src/lib/backends/session-diagnostics.ts`

由 type guard 判断 backend 是否支持。

## 3.2 建议新增的窄接口

最小建议是两类能力：

### A. Session diagnostics

提供类似：

1. `getRecentSteps(handle, options)`
2. 或 `getSessionDiagnostics(handle, options)`

返回值不必暴露 Native gRPC 原始结构，只返回 evaluate 真正需要的只读结果，例如：

1. recent step summaries
2. 原始 steps（若上层仍需要）
3. 失败时的统一错误结构

### B. Session metadata writer

提供类似：

1. `annotateSession(handle, annotations)`

这个接口的意义不是让所有 backend 都有 annotation，而是让：

1. Antigravity backend 可以写
2. 其他 backend 可以不实现

这样 `group-runtime.ts` 只判断能力，不再自己调 gRPC。

## 3.3 runtime resolver 也应一起下沉

目前 `discoverLanguageServers()`、`getApiKey()`、`getOwnerConnection()` 分散在 bridge 层。

对 control plane 来说，这些都属于：

1. backend attach/start/diagnose 所需的 runtime resolver

因此建议在 backend 叶子层再包一层 Native transport adapter，例如：

1. `src/lib/backends/antigravity-runtime-resolver.ts`
2. `src/lib/backends/antigravity-session-diagnostics.ts`

这样：

1. `group-runtime.ts` 不再 import bridge discovery / statedb / gateway helper
2. builtin backend 自己通过 resolver 完成连接解析

---

## 4. 建议的实施阶段

## Phase 1：抽 evaluate 的 recent steps 读取

状态：已完成（2026-04-10）

### 目标

把 evaluate 分支里的 `grpc.getTrajectorySteps()` 从 `group-runtime.ts` 移走。

### 涉及文件

1. `src/lib/agents/group-runtime.ts`
2. `src/lib/backends/types.ts`
3. `src/lib/backends/builtin-backends.ts`
4. 新增 `src/lib/backends/extensions.ts` 或同类文件
5. 可能新增 `src/lib/backends/antigravity-session-diagnostics.ts`

### 实施方式

1. 定义 optional diagnostics extension
2. 由 Antigravity backend 实现 recent steps 读取
3. `group-runtime.ts` evaluate 分支改为向 backend 扩展要 diagnostics，而不是自己调 grpc

### 验收标准

1. `group-runtime.ts` evaluate 分支不再直接 import / call `grpc.getTrajectorySteps`
2. evaluate 行为不变
3. 失败时仍能返回 `Failed to fetch conversation steps.` 这种稳定降级语义

### 当前结果

1. 已新增 `src/lib/backends/extensions.ts`，引入 optional diagnostics extension
2. `AntigravityAgentBackend` 已实现 `getRecentSteps()`
3. `group-runtime.ts` evaluate 分支已改为通过 backend diagnostics 读取 recent steps
4. 相关专项测试通过：
  - `src/lib/backends/builtin-backends.test.ts`
  - `src/lib/agents/group-runtime.test.ts`
5. 生产构建通过；当前仅出现既有 Turbopack 宽匹配 warning，非本次改动引入

## Phase 2：抽 evaluate 的 annotation 写回

状态：已完成（2026-04-10）

### 目标

把 evaluate session 启动后的 `grpc.updateConversationAnnotations()` 从 `group-runtime.ts` 移走。

### 涉及文件

1. `src/lib/agents/group-runtime.ts`
2. `src/lib/backends/builtin-backends.ts`
3. `src/lib/backends/extensions.ts`
4. 可能新增 `src/lib/backends/antigravity-session-metadata.ts`

### 实施方式

1. 定义 optional metadata writer extension
2. Antigravity backend 实现 `annotateSession()`
3. evaluate `onStarted` 中改为调用 backend 扩展，而不是 `getOwnerConnection + grpc.updateConversationAnnotations`

### 验收标准

1. `group-runtime.ts` evaluate 分支不再直接 import / call `getOwnerConnection`
2. `group-runtime.ts` evaluate 分支不再直接 import / call `grpc.updateConversationAnnotations`
3. supervisor evaluate 的 annotation 行为不回退

### 当前结果

1. 已在 `src/lib/backends/extensions.ts` 增加 optional session metadata writer extension
2. `AntigravityAgentBackend` 已实现 `annotateSession()`
3. `group-runtime.ts` evaluate 的 `onStarted` 已改为通过 backend metadata writer 写回 annotation
4. `group-runtime.ts` 已不再直接命中 `getOwnerConnection` 与 `grpc.updateConversationAnnotations`
5. 相关专项测试继续通过，构建通过；当前仅保留既有 Turbopack 宽匹配 warning

## Phase 3：收 owner / apiKey / language server 解析

状态：已完成（2026-04-10）

### 目标

把 `discoverLanguageServers()`、`getApiKey()`、`getOwnerConnection()` 这类解析彻底从 orchestration 层移走。

### 涉及文件

1. `src/lib/agents/group-runtime.ts`
2. `src/lib/backends/builtin-backends.ts`
3. `src/lib/bridge/gateway.ts`
4. `src/lib/bridge/discovery.ts`
5. `src/lib/bridge/statedb.ts`
6. 新增 backend resolver / adapter 文件

### 实施方式

1. backend 内部自己持有 Native runtime resolver
2. diagnostics / metadata / attach 所需连接均从 backend 侧解析
3. `group-runtime.ts` 不再自己做 Native server discovery

### 验收标准

1. `group-runtime.ts` 不再直接 import `discoverLanguageServers`
2. `group-runtime.ts` 不再直接 import `getApiKey`
3. evaluate / attach / cancel 主链行为不变

### 当前结果

1. 已新增 `src/lib/backends/antigravity-runtime-resolver.ts`
2. `AntigravityAgentBackend` 已暴露 runtime resolver extension，由 backend 内部持有 Native runtime resolver
3. `group-runtime.ts` 中原本直接使用 `discoverLanguageServers()` / `getApiKey()` 的分支，已改为通过 backend runtime resolver extension 取得 Native runtime 连接
4. `group-runtime.ts` 已不再直接 import `discoverLanguageServers`、`getApiKey`、或 `resolveAntigravityRuntimeConnection`
5. `group-runtime.test.ts`、`group-runtime.multi-role.test.ts`、`builtin-backends.test.ts` 继续通过
6. 生产构建通过；当前仍仅保留既有 Turbopack 宽匹配 warning

## Phase 4：补异常矩阵

状态：已完成（2026-04-10）

### 目标

在 transport 下沉后，用测试把边界锁死，避免再回退。

### 最少要补的测试

1. evaluate session failed
2. evaluate session cancelled
3. evaluate malformed response
4. attached session cancel
5. attached session timeout / superseded
6. unattached cancel attach failure

### 当前结果

1. 已补齐异常矩阵 characterization tests：
  - evaluate failed
  - evaluate cancelled
  - evaluate malformed response
  - unattached cancel attach failure
  - attached-session attach 不支持错误路径
  - attached-session timeout
  - attached-session superseded
2. Phase 4 直接相关测试通过：
  - `src/lib/agents/group-runtime.test.ts`
  - `src/lib/agents/group-runtime.multi-role.test.ts`
3. 扩展护栏测试集通过，可作为当前 Task B 的完整回归基线

---

## 当前总体状态

Task B 原定范围已完成。

当前已经做到：

1. `group-runtime.ts` 不再直接读取 evaluate recent steps
2. `group-runtime.ts` 不再直接写 evaluate annotation
3. `group-runtime.ts` 不再直接持有 Native runtime resolver 解析
4. 原计划定义的异常矩阵已补齐

如果后面还要继续推进，属于后续优化方向，而不是 Task B 本体未完成项：

1. 将当前 runtime resolver extension 再继续泛化成更 provider-neutral 的 transport adapter 结构


### 涉及测试文件

1. `src/lib/agents/group-runtime.test.ts`
2. `src/lib/backends/builtin-backends.test.ts`
3. 可考虑新增 `src/lib/backends/run-session-hooks.test.ts`

---

## 5. 当前不建议在 Task B 里一起做的事

为了避免再次扩散范围，下面这些东西当前不建议和 Task B 同时做：

1. 不扩 Codex append / streaming text
2. 不把 MemoryHooks 真正注入 prompt
3. 不重做 Template / Prompt / Scheduler 语义
4. 不顺手引入 Claude Code executor
5. 不把 generic backend contract 一次性扩成大而全接口

Task B 的目标是净化边界，不是同时做下一阶段执行器接入。

---

## 6. 建议的最小落地顺序

如果要最快把 Plan B 从研究推进到工程实施，建议按下面顺序：

1. **先做 Phase 1**
  - recent steps diagnostics extension
2. **再做 Phase 2**
  - annotation writer extension
3. **然后做 Phase 3**
  - resolver 下沉
4. **最后做 Phase 4**
  - 异常矩阵补齐

原因很简单：

1. evaluate 是最局部、最容易验证的切口
2. 先证明“控制层不碰 Native transport 也能完成诊断”
3. 再继续收连接解析，风险最低

---

## 7. Task B 做完后的价值

Task B 真正完成后，最大的收益不是代码少几行，而是：

1. `group-runtime.ts` 不再持有 Native executor 的 transport 读取细节
2. Antigravity Native Executor 真正退回到 execution plane 成员，而不是控制层隐式依赖
3. 未来 Claude Code / craft / direct Open API backend 接入时，控制层不用继续碰 Native gRPC 逻辑
4. 外部 executor 的 optional diagnostics / metadata 能力也有了明确落点

一句话总结：

> Task B 不是为了“重构得更漂亮”，而是为了让 Antigravity Platform 真正拥有一个不被 Native transport 反向塑形的 execution seam。