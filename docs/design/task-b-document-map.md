# Task B 文档地图

日期：2026-04-10  
状态：索引 / 已确认

## 一句话结论

当前仓库里，和 Task B 直接相关的核心文档已经识别出来了。

如果只问“Task B 本体应该看哪些文档”，当前最核心的是 3 份：

1. `docs/design/provider-integration-and-task-b-plan.md`
2. `docs/design/agent-backend-event-architecture-gap-checklist.md`
3. `docs/design/task-b-implementation-plan-2026-04-10.md`

除此之外，还有一组为 Task B 提供边界、前置设计和后续延展判断的文档，但它们不是 Task B 本体。

---

## 1. Task B 本体文档

## 1.1 总纲文档

### `docs/design/provider-integration-and-task-b-plan.md`

这份是 Task B 的总纲说明，主要回答：

1. Event 框架迁移现在完成到哪一步
2. Task B 的本质到底是什么
3. Provider / backend 未来该接在哪一层
4. Task B 完成后的理想状态是什么

如果你只想先把 Task B 的目标边界看明白，这份最该先看。

## 1.2 缺口清单文档

### `docs/design/agent-backend-event-architecture-gap-checklist.md`

这份是 Task B 的缺口与边界清单，主要回答：

1. 任务 A 已经收口到哪里
2. 为什么 Task B 已经不是功能迁移，而是结构下沉
3. Task B 的 4 组实施边界是什么
4. 当前哪些测试矩阵还没补齐

如果你要看“还差什么”，这份是主文档。

## 1.3 代码级实施计划文档

### `docs/design/task-b-implementation-plan-2026-04-10.md`

这份是最新的代码级实施拆解，主要回答：

1. 当前代码里还剩哪些真实 transport 泄漏点
2. 这些泄漏点应该落到 backend 哪层
3. 为什么 evaluate 是最稳切口
4. Phase 1 到 Phase 4 的实施顺序和验收标准

如果你要直接开工，这份是当前最贴近工程实施的文档。

---

## 2. Task B 的前置设计文档

下面这些不是 Task B 本体，但它们是理解 Task B 为什么存在的底座。

### `docs/design/agent-backend-abstraction-detailed-design.md`

这是 AgentBackend 的详细技术设计，解释：

1. 为什么要从 TaskExecutor 演进到 AgentBackend / AgentSession
2. group-runtime 与 prompt-executor 的 runtime 责任怎么拆
3. 为什么 session lifecycle 要成为统一 seam

### `docs/design/rfc-agent-backend-abstraction.md`

这是更早期的 RFC 版抽象文档，主要是概念来源。

它不是 Task B 的实施说明，但它解释了为什么平台最终会走到“统一 backend / event / session”这一步。

### `docs/design/agent-backend-event-rereview-2026-04-09.md`

这份是 rereview 文档，主要价值在于：

1. 它说明当前迁移为什么还是 NEEDS_REVISION
2. 它指出 Task B 之外，还存在 attach / cancel provenance、cancel 合同、review-loop 完成判定这些边界问题

如果你想判断 Task B 和整体事件架构收口的关系，这份要一起看。

---

## 3. Task B 的概念底座文档

### `docs/design/control-plane-vs-execution-plane-alignment.md`

这份不是 Task B 实施文档，但它非常关键。

它给 Task B 提供的核心结论是：

1. Antigravity Platform 已经分成 control plane 和 execution plane
2. Task B 做的事情，本质就是继续把 Native Executor transport 从控制层剥出去

如果没有这份概念底座，Task B 很容易再次被误解成“只是做 provider 抽象”或“继续迁功能”。

---

## 4. Task B 的延展文档

这组文档不是 Task B 本体，但都把 Task B 当成前提或边界条件。

### `docs/design/open-api-universal-executor-strategy.md`

作用：

1. 解释 Task B 与未来外部 executor 接入的关系
2. 说明为什么不做完 Task B，外部 executor seam 仍然不干净

### `docs/design/native-executor-replacement-feasibility.md`

作用：

1. 解释为什么真正解除 Native Executor 绑定，不是去找现成平替品
2. 说明 Task B 是 execution seam 净化的必要前置

### `docs/design/embedded-executor-code-integration-matrix.md`

作用：

1. 说明如果未来要把 Claude Code 或 craft 代码直接集成进来，Task B 为什么仍然是前提
2. 解释为什么控制层不能继续被 Native transport 反向塑形

### `docs/internals/antigravity-vs-craft-feasibility-study.md`

作用：

1. 作为 execution shell 方向研究文档
2. 多处把“继续完成 AgentBackend 和 Task B 方向”作为前提写死

---

## 5. 容易混淆但不是 Task B 本体的文档

下面这些文档或代码会命中部分关键词，但不应被误认成 Task B 主文档：

### `docs/guide/gateway-api.md`

这里会提到 conversation annotation 等调用，但它是对外接口说明，不是 Task B 设计文档。

### `src/lib/agents/group-runtime.ts`

这是 Task B 的主要改造对象，不是 Task B 文档。

### `src/lib/backends/builtin-backends.ts`

这是 Task B 未来的主要承接层之一，不是文档。

### `src/lib/bridge/gateway.ts`

### `src/lib/bridge/grpc.ts`

### `src/lib/bridge/discovery.ts`

### `src/lib/bridge/statedb.ts`

这些是 Native transport / resolver 现状代码，不是 Task B 文档。

---

## 6. 当前确认结果

基于当前仓库检索结果，可以确认：

1. **Task B 显式主文档没有遗漏，当前 canonical doc set 就是上面这 3 份本体文档。**
2. **与 Task B 强相关的前置 / 延展文档也已经识别出来了。**
3. **当前没有发现额外一份独立的 delivery 文档或根目录研究文档，在内容上承担了 Task B 本体角色却没被纳入。**

换句话说：

1. 如果你担心“是不是还有一份真正重要的 Task B 文档我没抓到”，当前答案是：**我已经把主集合识别出来了。**
2. 如果后面还要继续补，只需要考虑是否把这份文档地图继续维护成索引，而不是继续去找一份“隐藏主文档”。