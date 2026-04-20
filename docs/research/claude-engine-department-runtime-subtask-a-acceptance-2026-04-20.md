# Claude Engine Department Runtime 子任务 A 独立验收（2026-04-20）

**日期**: 2026-04-20  
**验收人**: Codex（独立验收）  
**范围**: 针对 Claude Engine Department Runtime 修复后的关键单测/集成测试做独立验收

---

## 1. 前置阅读

本轮验收先阅读并对照了以下文档：

1. `docs/PROJECT_PROGRESS.md`
2. `docs/design/claude-engine-department-runtime-design-2026-04-19.md`
3. `docs/research/claude-engine-department-runtime-completion-audit-2026-04-20.md`

---

## 2. 验收范围

本轮按要求重点验收以下 6 个测试文件：

1. `src/lib/claude-engine/api/__tests__/native-codex.test.ts`
2. `src/lib/backends/__tests__/claude-engine-backend.test.ts`
3. `src/lib/agents/department-capability-registry.test.ts`
4. `src/lib/agents/department-execution-resolver.test.ts`
5. `src/lib/agents/prompt-executor.test.ts`
6. `src/lib/agents/group-runtime.test.ts`

---

## 3. 实际执行

执行命令：

```bash
npx vitest run \
  src/lib/claude-engine/api/__tests__/native-codex.test.ts \
  src/lib/backends/__tests__/claude-engine-backend.test.ts \
  src/lib/agents/department-capability-registry.test.ts \
  src/lib/agents/department-execution-resolver.test.ts \
  src/lib/agents/prompt-executor.test.ts \
  src/lib/agents/group-runtime.test.ts
```

实际结果：

1. `6` 个测试文件全部通过
2. `52` 个测试全部通过
3. `Duration 3.61s`
4. 本轮 **没有出现失败用例**

Vitest 摘要：

```text
Test Files  6 passed (6)
Tests       52 passed (52)
Duration    3.61s
```

---

## 4. 独立抽查结论

为了避免“只靠 mock 把测试跑绿”，本轮额外抽查了关键实现文件，确认当前代码状态与旧审计结论相比已经前进了一步。

### 4.1 `native-codex` provider 解析已接到 Claude Engine 主链

当前 `src/lib/backends/claude-engine-backend.ts` 中：

1. `resolveApiBackedModelConfig('native-codex')`
2. 返回的是 `provider: 'native-codex'`

这说明它不再是旧审计里记录的 `provider: 'openai'` 状态。

### 4.2 Claude Engine retry mainline 已有 `native-codex` 路由

当前 `src/lib/claude-engine/api/retry.ts` 中：

1. `selectProviderStream('native-codex', ...)`
2. 会走 `streamQueryNativeCodex(options)`

这与 `native-codex.test.ts` 的断言一致。

### 4.3 capability registry 已按 backend cutover 升级 `native-codex`

当前 `src/lib/agents/department-capability-registry.ts` 中：

1. 如果 `native-codex` Department backend 已切到 `ClaudeEngineAgentBackend`
2. 则 capability profile 会升级为：
   - `runtimeFamily = 'claude-engine'`
   - `departmentMainline = 'claude-engine'`

与测试预期一致。

### 4.4 prompt/template runtime carrier 已透传到 backend config

当前：

1. `src/lib/agents/prompt-executor.ts`
2. `src/lib/agents/group-runtime.ts`

都已经把：

1. `executionProfile`
2. `runtimeContract`
3. `toolset`
4. `permissionMode`
5. `readRoots`
6. `writeRoots`
7. `requiredArtifacts`

继续透传给 capability-aware routing 和 backend session path。

---

## 5. 失败与阻断

本轮 **无失败用例**，因此没有产生需要修复的测试或实现文件。

测试日志里观察到两类 warning，但它们没有导致本轮目标测试失败：

1. `ClaudeEngineBackend` 的 `Provider credential not configured`
   - 发生在 mock backend 启动路径
   - 本轮没有真实 API 调用，不构成 blocker
2. `RunRegistry` 的磁盘恢复日志与 `Cannot find module './project-registry'`
   - 出现在测试环境模块初始化日志里
   - 本轮目标测试仍全部通过，未形成当前验收阻断

---

## 6. 最终判断

对子任务 A 这 6 个关键测试文件的独立验收结论是：

1. **全部通过**
2. **本轮不需要补测试修复**
3. **当前代码已满足本轮要求的关键单测/集成测试验收范围**

但需要注意：

1. 这次结论只覆盖用户指定的 6 个关键测试文件
2. 不等于整个 Claude Engine Department Runtime 的完整产品级或 e2e 验收已经全部闭环

