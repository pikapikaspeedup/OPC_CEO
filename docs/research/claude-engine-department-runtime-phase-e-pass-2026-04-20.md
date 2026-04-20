# Claude Engine Department Runtime Phase E 复验通过（2026-04-20）

**日期**: 2026-04-20  
**结论**: `review-flow + native-codex` 已通过一条真实模板链，`Phase E` 关键验收点通过。

---

## 1. 背景

在此前审计中，`Claude Engine Department Runtime` 的主要剩余疑点有两类：

1. `native-codex` 是否真的走到了 Claude Engine 的专用 adapter 主链
2. `review-flow + native-codex` 是否至少能真实跑通一条模板链

2026-04-20 本轮主线程继续修复后，重新做了一次真实 smoke。

---

## 2. 本轮修复

本轮实际修复了 3 处关键点：

### 2.1 `native-codex` provider 主链

`src/lib/backends/claude-engine-backend.ts`

`resolveApiBackedModelConfig('native-codex')` 现在返回：

1. `provider = native-codex`
2. `model = gpt-5.4`

这样 Claude Engine retry 主循环会真正命中：

- `streamQueryNativeCodex(options)`

而不是再落回 `openai` 兼容路径。

### 2.2 resolver 不再自动把平台 envelope 文件注入 `requiredArtifacts`

`src/lib/agents/department-execution-resolver.ts`

`buildRequiredArtifacts()` 不再默认补入：

1. `task-envelope.json`
2. `result-envelope.json`
3. `artifacts.manifest.json`

这些平台级文件不再被当作 backend 完成前必须存在的 role 级产物。

### 2.3 run 级 `artifactRoot` 绑定

`src/lib/agents/prompt-executor.ts`  
`src/lib/agents/group-runtime.ts`

runtime contract 在进入 backend config 前，会把：

- `artifactRoot`

绑定到当前 run 的真实 artifact 绝对目录，而不是 Department 级公共 `demolong/` 根。

---

## 3. 实际验收方式

### 3.1 真实模板链 smoke

使用临时隔离环境：

1. `AG_GATEWAY_HOME=/var/folders/.../ag-ce-review-home-bMXGFs`
2. 临时 workspace：
   - `/var/folders/.../ag-ce-review-ws-wtQOWl`

在该 workspace 下：

1. 创建 `.department/config.json`
   - `provider = native-codex`
   - `templateIds = ["design-review-template"]`
2. 创建最小前端源码：
   - `src/App.tsx`
   - `src/page.css`

然后通过 `dispatchRun(...)` 真实派发：

1. `templateId = design-review-template`
2. `stageId = ux-review`

### 3.2 关键测试回归

执行：

```bash
npx vitest run \
  src/lib/claude-engine/tools/__tests__/tools.test.ts \
  src/lib/bridge/native-codex-adapter.test.ts \
  src/lib/claude-engine/api/__tests__/native-codex.test.ts \
  src/lib/agents/department-capability-registry.test.ts \
  src/lib/agents/department-execution-resolver.test.ts \
  src/lib/backends/__tests__/claude-engine-runtime-config.test.ts \
  src/lib/backends/__tests__/claude-engine-backend.test.ts \
  src/lib/backends/builtin-backends.test.ts \
  src/lib/agents/prompt-executor.test.ts \
  src/lib/agents/group-runtime.test.ts \
  src/lib/agents/__tests__/prompt-runtime-contract.acceptance.test.ts \
  src/lib/backends/__tests__/memory-hooks-runtime-contract.test.ts
```

结果：

1. `12 files passed`
2. `116 tests passed`

### 3.3 类型与构建

执行：

```bash
npx tsc --noEmit --pretty false
npm run build
```

结果：

1. `tsc` 通过
2. `build` 通过

保留一个非阻断 warning：

1. `src/lib/agents/run-registry.ts` 的 Turbopack broad-pattern warning

---

## 4. 真实通过证据

### 4.1 关键 run

真实通过的 run：

1. `runId = 6148cb04-ed71-4729-b92b-c46628a2c1d7`
2. `templateId = design-review-template`
3. `stageId = ux-review`
4. `provider = native-codex`
5. `status = completed`
6. `reviewOutcome = approved`

### 4.2 运行过程

这条 run 实际走完了：

1. `ux-review-author` round 1
2. `ux-review-critic` round 1
3. `ux-review-author` round 2
4. `ux-review-critic` round 2
5. `ux-review-author` round 3
6. `ux-review-critic` round 3

最终：

1. round 3 critic 提取决策为 `approved`
2. run 状态更新为 `completed`
3. advisory finalization 成功
4. artifact manifest 成功写出

### 4.3 关键日志特征

真实日志显示：

1. `provider = native-codex`
2. 多次 `Sending native Codex request`
3. author output directory `specs` validated
4. critic round 3 decision = `approved`
5. `Artifact manifest written`
6. `Advisory run finalized`

### 4.4 真实产物

最终 `resultEnvelope.outputArtifacts` 包含：

1. `specs/audit-report.md`
2. `specs/interaction-proposals.md`
3. `specs/priority-matrix.md`
4. `review/review-round-1.md`
5. `review/result-round-1.json`
6. `review/review-round-2.md`
7. `review/result-round-2.json`
8. `review/review-round-3.md`

这说明：

1. author 写入 `specs/` 成功
2. critic 写入 `review/` 成功
3. review-loop 的 3 轮闭环成立

---

## 5. 最终判断

截至 2026-04-20 本轮修复与复验后：

1. `Phase A`
   - 已完成
2. `Phase B`
   - 已完成
3. `Phase C`
   - 已完成
4. `Phase D`
   - 已完成
5. `Phase E` 的关键验收点
   - `review-flow + native-codex` 至少一条模板链路跑通
   - **已通过**

因此对这份设计最准确的口径已经变为：

- **Claude Engine Department Runtime 统一设计（2026-04-19）已开发完成，并已通过当前关键验收。**
