# AI Company 开发计划与代码落地审计（2026-04-19）

## 背景

本审计用于对照以下两份文档与当前代码落地情况：

1. `docs/design/ai-company-development-plan-2026-04-19.md`
2. `docs/design/ai-company-requirements-and-architecture-2026-04-19.md`

目标不是复述“计划里写了什么”，而是确认：

1. 已宣称完成的阶段，代码是否真的成立
2. 是否存在“合同接受了，但运行不了”的假闭环
3. 是否存在“看板上能看到，但数据语义不可靠”的问题

---

## 结论概览

当前代码整体已经具备：

1. `Phase 1` 到 `Phase 5` 的最小结构
2. `Knowledge Loop`、`CEO Actor`、`Management Console`、`Execution Profiles`、`Evolution Pipeline` 的基础模块
3. 若干真实可跑通的最小链路

但审计后确认，仍存在几处重要偏差：

1. `review-flow` 被定义成一等 `ExecutionProfile`，但不能稳定作为创建入口使用
2. `KnowledgeAsset` 的动态 `stale` 语义和查询/检索语义不一致
3. `CEO event consumer` 不是常驻注册，早期事件会丢
4. approval 持久化只写不读，重启后审批列表会丢
5. `pendingIssues` 只追加不清理，CEO routine 会逐渐失真

---

## 发现 1：`review-flow` 合同已接受，但并不能作为真实执行入口使用

涉及文件：

1. `src/lib/execution/contracts.ts`
2. `src/app/api/agent-runs/route.ts`
3. `src/lib/agents/scheduler-types.ts`
4. `src/lib/agents/scheduler.ts`

关键事实：

1. `isExecutionProfile()` 明确接受 `review-flow`
2. `normalizeExecutionProfileForTarget()` 对 `review-flow` 只返回：
   - `kind: 'template'`
   - 但没有 `templateId`
3. `POST /api/agent-runs` 会把这个 target 继续传给 `executeDispatch(...)`
4. `executeDispatch(...)` 真实要求 `templateId`
5. scheduler 的 `dispatch-execution-profile` 类型根本不允许 `review-flow`

结论：

当前 `review-flow` 更像“读侧推导标签”，而不是一个真正可派发的运行时 profile。  
如果继续把它描述成与 `workflow-run` / `dag-orchestration` 等价的一等执行入口，会高估当前完成度。

---

## 发现 2：`stale` 是运行时推导，但 SQL 过滤先执行，导致知识查询与检索语义不一致

涉及文件：

1. `src/lib/knowledge/store.ts`
2. `src/lib/knowledge/retrieval.ts`

关键事实：

1. `hydrateKnowledgeAsset()` 会把老于 30 天且仍是 `active` 的资产重标记为 `stale`
2. `listKnowledgeAssets()` 的 `status` 过滤先在 SQL 层按持久化字段过滤
3. 所以：
   - 查询 `status = stale` 时，自动老化出来的 stale 条目查不到
   - 查询 `status = active` 时，SQL 先捞出旧的 `active` 行，hydrate 后又变成 `stale`
4. `retrieveKnowledgeAssets()` 依赖 `listKnowledgeAssets({ status: 'active' })`

结论：

当前 stale 语义在“管理视图”和“执行检索”之间是打架的：  
执行前 retrieval 理论上只想取 `active` 知识，但实际上可能会把已老化的 `stale` 资产继续注入 prompt。

---

## 发现 3：`CEO event consumer` 不是系统启动即注册，第一次打开 CEO 之前的事件会丢失

涉及文件：

1. `src/lib/organization/ceo-event-consumer.ts`
2. `src/lib/organization/ceo-routine.ts`
3. `src/app/api/ceo/events/route.ts`

关键事实：

1. `ensureCEOEventConsumer()` 只有在显式调用时才注册
2. 当前调用点只出现在 CEO 读接口路径中
3. 如果项目事件、审批事件、知识事件先发生，而 CEO 页面/接口还没被打开过，这些事件不会回补进 consumer

结论：

这和 `Phase 2：CEO Actor v1` 中“event consumer”作为 actor 基座的定位不一致。  
目前更接近“第一次查看 CEO 页面时才开始消费后续事件”，不是真正的常驻组织事件消费器。

---

## 发现 4：approval 持久化只写不读，进程重启后治理状态会丢失

涉及文件：

1. `src/lib/approval/request-store.ts`

关键事实：

1. approval request 会写入：
   - `~/.gemini/antigravity/requests/*.json`
2. `loadPersistedRequests()` 已实现
3. 但当前代码里没有任何地方调用它

结论：

这意味着 approval system 现在的真实状态源仍然是内存，不是可恢复持久层。  
只要进程重启，待审批列表就会丢失，而磁盘上的 request 文件只是“写了但没接回 runtime”的半闭环。

---

## 发现 5：`pendingIssues` 只有追加，没有清理，CEO routine 会越来越偏离真实待办

涉及文件：

1. `src/lib/approval/request-store.ts`
2. `src/lib/organization/ceo-profile-store.ts`
3. `src/lib/organization/ceo-routine.ts`

关键事实：

1. 创建 approval request 时会 append pending issue
2. project 失败/阻塞时也会 append pending issue
3. `ceo-profile-store.ts` 只有 `appendCEOPendingIssue(...)`
4. 当前没有：
   - remove
   - resolve
   - clear
   之类的 pending issue 生命周期操作
5. routine summary 会直接把 `pendingIssues` 作为 reminders / escalations 的来源

结论：

随着审批完成、项目恢复、风险解除，`pendingIssues` 不会自动收敛。  
长期运行后，CEO routine 和 escalation 会越来越像“历史遗留清单”，而不是当前真实待处理问题。

---

## 次级问题

### 1. Knowledge Console 的 `accessed` 时间戳展示错误

涉及文件：

1. `src/lib/knowledge/store.ts`

问题：

`buildKnowledgeItemFromAsset()` 中：

- `timestamps.accessed` 取的是 `asset.updatedAt`

而不是：

- `asset.lastAccessedAt`

影响：

Knowledge Console 的“访问时间”会失真，尤其是高复用条目。

### 2. `DepartmentContract` 仍然只是定义，没有进入运行时

涉及文件：

1. `src/lib/organization/contracts.ts`
2. `src/lib/organization/index.ts`

观察：

当前 `DepartmentContract` 已有类型定义，但没有看到实际构建和消费路径。  
组织平面仍然主要围绕 `DepartmentConfig` 在运行。

影响：

这不一定是 bug，但说明 `Phase 0` 里“DepartmentContract 作为运行时治理对象”的落地还没真正完成。

---

## 总体判断

### 可以成立的结论

1. 当前不是“完全没落地”
2. `Phase 1` 到 `Phase 5` 都已有实代码
3. `workflow-run`、`dag-orchestration`、knowledge extraction、management overview、proposal publish 这些最小主链大体成立

### 不能高估的结论

1. `review-flow` 还不能按一等 execution target 宣称完成
2. `CEO Actor` 还不是常驻 actor，只是状态化 command parser + on-demand summary
3. approval / pending issue / event consumer 的生命周期一致性还不够
4. knowledge stale / retrieval 语义还需要再收口

---

## 建议修复顺序

建议优先级：

1. 修 `review-flow` 创建链路或收窄对外合同
2. 修 `KnowledgeAsset` 的 stale 过滤与 retrieval 一致性
3. 把 `CEO event consumer` 挂到系统启动阶段
4. 接通 `loadPersistedRequests()`，让 approval 真正可恢复
5. 给 `pendingIssues` 增加 resolve/clear 生命周期

这样修完之后，再去做全特性实跑，会更接近“计划写的能力真的成立”。
