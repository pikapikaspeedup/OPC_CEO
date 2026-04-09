# AgentBackend Event Rereview 2026-04-09

## 结论

当前事件架构迁移的方向是对的，主链也确实已经迁到 `AgentBackend -> AgentSession -> session-consumer`。

但如果标准是“边界已经稳定，可以放心继续接新 backend”，当前结论仍然是：

> **NEEDS_REVISION**

问题已经不在“有没有迁到 event”，而在合同和结构边界还没有完全收口。

---

## 这轮迁移真正做对的地方

1. **主执行链是真的统一了**
  - Prompt
  - legacy-single
  - multi-role isolated
  都已经进入 session 主链，而不是停留在文档描述层。
2. **RunRegistry 仍然是真相源**
  - session 没有反客为主变成系统主对象
  - 这点必须继续保住
3. **借鉴 craft 的方式总体正确**
  - 借的是 backend / session / event 分层
  - 没有把 Antigravity 直接扭成 craft 的 session-first 产品壳
4. **Antigravity watcher parity 已经明显往叶子层下沉**
  - autoApprove
  - reconnect
  - artifact 文件轮询兜底
  - owner 路由 append / cancel

这些都说明这轮工作不是“抽象好看了”，而是运行语义真的更统一了。

---

## Findings

### 1. MAJOR: attach / cancel 仍依赖瞬时 provider 解析，而不是持久化 provenance

当前 unattached cancel、attached nudge 等恢复态路径，仍会根据当前 workspace 配置重新 `resolveProvider()`，再决定 attach 到哪个 backend。

这有两个直接风险：

1. 如果 run 创建后 provider 配置发生漂移，恢复态操作会路由错 backend
2. 如果进程重启或 owner map 丢失，正在运行的任务会变得不可靠地不可 cancel / 不可干预

这说明当前 run 持久化的还不够。

真正稳定的做法应该是：

1. run 持久化 provider provenance
2. attach / cancel / nudge / evaluate 恢复态优先读 run 自身的 provider 来源
3. 不再在恢复态重新猜“当前工作区应该走哪个 backend”

相关文件：

1. `src/lib/agents/run-registry.ts`
2. `src/lib/agents/group-runtime.ts`

### 2. MAJOR: cancel 合同没有真正写死

当前代码实际上默认了一件事：

> session 被 cancel 后，backend 最终会发出终态事件。

但这个前提没有被正式写成硬合同。

现在存在三层不一致：

1. 类型层只说 `cancel()` 返回 Promise
2. consumer 侧默认等终态事件来释放 session
3. 文档里又把 best-effort cancel 写成未来 backend 的最小可接入合同

如果后续某个 backend 只做“本地打取消标记”，却不发终态事件，就会留下悬空 session 和没收口的 run。

真正稳定的做法只能二选一：

1. 明文规定：cancel 后 backend **必须**发 cancelled / failed 终态事件
2. 或者 consumer 在 local cancel 路径具备主动 close / release 机制

在这两者没统一之前，继续接新 backend 风险会被扩散。

相关文件：

1. `src/lib/backends/types.ts`
2. `src/lib/backends/session-consumer.ts`
3. `docs/design/provider-integration-and-task-b-plan.md`

### 3. MAJOR: review-loop author 的完成判定存在落盘时序竞争

当前 review-loop author 完成后，会很快检查 specs / architecture 输出目录是否存在；如果目录此时还没刷到磁盘，就会把 run 直接标记成 failed。

但同一代码库里已经承认另一个现实：

1. review decision 文件落盘存在延迟
2. 因此 `prompt-builder.ts` 已经专门给 decision 文件做了重试

如果 decision 文件需要重试，author 输出目录同样可能需要重试。

否则就会出现假失败：

1. session 已 completed
2. 文件稍后才落盘
3. 上层先一步把 run 判死

这会直接损害 review-loop 的可靠性。

真正稳定的做法应该是：

1. author 输出目录与 review decision 文件使用一致的“落盘稳定化”策略
2. 不要一处承认 file flush lag，另一处假设 completed 就等于文件已经立刻可见

相关文件：

1. `src/lib/agents/group-runtime.ts`
2. `src/lib/agents/prompt-builder.ts`

---

## 与 craft 相比，哪些借对了，哪些不能继续借过头

### 借对了的地方

1. 用 session / event 统一 provider 差异
2. 用 capability-driven backend 而不是强求所有 provider 长得一样
3. 把 transport 细节往叶子层压，而不是让 orchestration 理解全部 provider 差异

### 不能借过头的地方

1. 不能把 workspace / session 提升成 Antigravity 的系统真相源
2. 不能让 backend 抽象吞掉 review-loop / source contract / pipeline 推进
3. 不能为了模仿 craft 的大一统 runtime，而提前混入 streaming text、memory prompt 注入、rich append 等下一阶段能力

Antigravity 最稀缺的不是 session 壳，而是：

1. Project
2. Run
3. Stage
4. governance

这层不能被稀释。

---

## 到底怎么样才是好的

一个真正“好的完成态”至少应满足下面 6 条：

1. `group-runtime.ts` 不再直接持有 Antigravity transport 读取能力
2. run 持久化 provider provenance，恢复态操作不再重新猜 backend
3. cancel 合同被写死，并有反向测试护栏
4. attached-session / evaluate / shared reuse / timeout / malformed response 异常矩阵齐全
5. author 输出与 review decision 的完成判定采用一致的落盘稳定化策略
6. 至少有一个非 Antigravity backend 能在不修改业务编排层的前提下接入成功，证明边界真的成立

如果做不到第 6 条，那当前仍然只是“把现有两个 backend 收口好了”，还不算真正建立了 future-proof 的执行边界。

---

## 最值得优先做的顺序

1. **先补 attached-session / evaluate / cancel 的异常矩阵测试**
2. **再抽 evaluate 这条最小 transport 泄漏链**
3. **再抽 owner / apiKey / language-server resolver**
4. **最后拿一个非 Antigravity backend 做 seam 验证**

这比继续扩大抽象面更重要。

---

## 最终判断

现在系统已经做到：

1. 功能入口大体统一到 event session 主链

但还没有做到：

1. session 合同完全稳定
2. transport 边界完全净化
3. 对未来 backend 接入的 seam 已被证明可靠

所以当前最准确的评价是：

> 方向正确，主链真实，边界未完全收口，继续往下做前应先修合同和异常矩阵。