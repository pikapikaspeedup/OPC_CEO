# Task B 当前完成态

日期：2026-04-10  
状态：阶段总结 / 当前态快照

## 一句话结论

截至当前，Task B 已经完成了前 3 个结构下沉阶段，并补齐了原计划中的异常矩阵测试。

更直接地说：

1. `group-runtime.ts` 已不再直接读取 evaluate recent steps
2. `group-runtime.ts` 已不再直接写 evaluate session annotation
3. `group-runtime.ts` 已不再直接 import `discoverLanguageServers`、`getApiKey`、或 `resolveAntigravityRuntimeConnection`
4. evaluate、resolver、以及原计划内关键异常路径都已经有测试护栏

这意味着：

1. Task B 的原定范围已经完成
2. 剩下如果继续做，属于后续优化，不再是 Task B blocker

---

## 1. 已完成的部分

## 1.1 Phase 1：evaluate recent steps 下沉

已完成。

当前结果：

1. 新增 `src/lib/backends/extensions.ts`
2. 新增 optional diagnostics extension
3. `AntigravityAgentBackend` 已实现 `getRecentSteps()`
4. evaluate 分支改为通过 backend diagnostics 读取 recent steps

因此：

1. `group-runtime.ts` 已不再直接调用 `grpc.getTrajectorySteps()`

## 1.2 Phase 2：evaluate annotation 写回下沉

已完成。

当前结果：

1. `extensions.ts` 已补 `AgentBackendSessionMetadataExtension`
2. `AntigravityAgentBackend` 已实现 `annotateSession()`
3. evaluate `onStarted` 改为通过 backend metadata writer 写回 annotation

因此：

1. `group-runtime.ts` 已不再直接调用 `getOwnerConnection()`
2. `group-runtime.ts` 已不再直接调用 `grpc.updateConversationAnnotations()`

## 1.3 Phase 3：resolver 下沉

已完成。

当前结果：

1. 新增 `src/lib/backends/antigravity-runtime-resolver.ts`
2. `AntigravityAgentBackend` 已通过 runtime resolver extension 持有 Native runtime resolver
3. dispatch 主链中的 Native runtime 解析改走 backend runtime resolver extension
4. `restart_role` 分支改走 backend runtime resolver extension
5. review-loop 恢复与 author recovery 分支改走 backend runtime resolver extension

因此：

1. `group-runtime.ts` 已不再直接 import `discoverLanguageServers`
2. `group-runtime.ts` 已不再直接 import `getApiKey`
3. `group-runtime.ts` 已不再直接 import `resolveAntigravityRuntimeConnection`

---

## 2. 已补上的异常矩阵

## 2.1 evaluate 异常路径

当前已锁住：

1. evaluate session failed
2. evaluate session cancelled
3. evaluate malformed response

这些都已经被 characterization tests 覆盖。

## 2.2 unattached cancel 异常路径

当前已锁住：

1. unattached cancel attach failure

当前行为已经被明确写死：

1. attach 失败会显式抛错
2. 不会静默退化成“直接本地取消”

## 2.3 attached-session 首批异常路径

当前已锁住：

1. attached-session attach 不支持错误路径
2. attached-session timeout
3. attached-session superseded

也就是说，如果 resolved backend 不支持 attach，当前行为已经被测试固定下来。

---

## 3. 当前还没完成的部分

Task B 原定范围已经完成。

当前剩下的只有后续优化方向。

## 3.1 更高阶的 transport adapter 净化还可以继续推进

虽然 `group-runtime.ts` 已经不再直接 import Native resolver helper，但当前 resolver 还是 Antigravity-specific。

因此如果后面要继续往前走，还有一个更高阶但不紧急的方向：

1. 把当前 resolver helper 再继续收成更 provider-neutral 的 transport adapter 结构

这不是当前 blocker，但属于后续可选收口方向。

---

## 4. 当前验证状态

当前验证结论是稳定的。

### 专项测试

当前已通过：

1. `src/lib/agents/group-runtime.test.ts`
2. `src/lib/agents/group-runtime.multi-role.test.ts`
3. `src/lib/backends/builtin-backends.test.ts`

### 扩展护栏测试集

当前已通过一组扩展回归基线：

1. `src/lib/agents/prompt-executor.test.ts`
2. `src/lib/agents/group-runtime.test.ts`
3. `src/lib/agents/group-runtime.multi-role.test.ts`
4. `src/lib/agents/run-registry.test.ts`
5. `src/lib/agents/watch-conversation.test.ts`
6. `src/lib/backends/builtin-backends.test.ts`
7. `src/lib/backends/memory-hooks.test.ts`
8. `src/lib/backends/registry.test.ts`
9. `src/lib/backends/session-registry.test.ts`
10. `src/lib/backends/session-consumer.test.ts`

当前累计验证结果：

1. 10 个测试文件通过
2. 61 个测试全部通过

### 构建验证

当前生产构建通过。

已知仍有一个既有 warning：

1. `src/lib/agents/run-registry.ts` 的 Turbopack 宽匹配 warning

这不是本轮 Task B 改动引入的问题。

---

## 5. 当前最准确的判断

如果把 Task B 的目标定义成：

> 让 `group-runtime.ts` 不再直接持有 evaluate 所需的 Native transport 读取、annotation 写回与 runtime 连接解析。

那这个目标已经基本达成。

最准确的状态表达应该是：

> **Task B 的原定结构下沉与异常矩阵补齐已经完成，当前进入后续优化阶段。**