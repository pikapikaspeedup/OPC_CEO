# Claude Engine Department Runtime 子任务 B 验收

**日期**: 2026-04-20  
**结论**: `Phase E` 的 `review-flow + native-codex` 验收点当前 **未通过**

## 1. 验收目标

按用户要求，本轮不是继续先改代码，而是先做一条真实的最小 `review-flow + native-codex` smoke / acceptance，判断：

1. `native-codex` 是否真的命中 Department 主链
2. `design-review-template / ux-review` 这类 `review-loop` 模板是否至少能真实跑通一条

前置阅读：

1. `docs/design/claude-engine-department-runtime-design-2026-04-19.md`
2. `docs/research/ai-company-full-feature-test-results-2026-04-19.md`

其中设计稿 `Phase E` 的关键口径是：

1. `review-flow + native-codex` 至少有一条模板链路跑通

---

## 2. 实际运行环境

### Repo / Server

1. 仓库：
   - `/Users/darrel/Documents/Antigravity-Mobility-CLI`
2. 隔离 gateway home：
   - `/tmp/ag-phase-e-gateway`
3. 实际启动命令：

```bash
AG_GATEWAY_HOME=/tmp/ag-phase-e-gateway PORT=3000 npm run dev
```

### 最小 smoke workspace

为了把变量压到最少，本轮没有直接拿大仓业务页面做评审，而是创建了一个最小本地前端样例 workspace：

1. workspace：
   - `/tmp/phase-e-review-smoke`
2. Department 配置：
   - `/tmp/phase-e-review-smoke/.department/config.json`
3. 被评审文件：
   - `/tmp/phase-e-review-smoke/src/index.html`
   - `/tmp/phase-e-review-smoke/src/styles.css`
   - `/tmp/phase-e-review-smoke/src/app.js`

这样可以把成败尽量归因到 Department runtime / review-loop 本身，而不是复杂业务上下文。

---

## 3. 真实运行步骤

### Step 1：验证 `native-codex` Department backend 注册形态

实际运行：

```bash
npx tsx -e "import fs from 'node:fs'; import { ensureBuiltInAgentBackends } from './src/lib/backends/builtin-backends'; import { getAgentBackend } from './src/lib/backends/registry'; import { resolveApiBackedModelConfig } from './src/lib/backends/claude-engine-backend'; ensureBuiltInAgentBackends(); const backend = getAgentBackend('native-codex'); const out = { constructor: backend.constructor?.name, providerId: backend.providerId, capabilities: backend.capabilities(), modelConfig: resolveApiBackedModelConfig('native-codex') }; fs.mkdirSync('/tmp/phase-e-review-smoke/evidence', { recursive: true }); fs.writeFileSync('/tmp/phase-e-review-smoke/evidence/backend-self-check.json', JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 2));"
```

结果证据：

1. `/tmp/phase-e-review-smoke/evidence/backend-self-check.json`

关键观测：

1. `constructor = ClaudeEngineAgentBackend`
2. `providerId = native-codex`
3. `modelConfig.provider = native-codex`
4. backend capability 中包含：
   - `supportsDepartmentRuntime = true`
   - `supportsToolRuntime = true`
   - `supportsArtifactContracts = true`
   - `supportsReviewLoops = true`

### Step 2：真实 dispatch 一条 `review-flow`

实际调用：

1. `POST /api/agent-runs`
2. body 显式带：
   - `provider = native-codex`
   - `templateId = design-review-template`
   - `stageId = ux-review`
   - `executionProfile.kind = review-flow`

实际运行脚本把 dispatch / polling / final run / conversation 都写入了本地证据目录：

1. `/tmp/phase-e-review-smoke/evidence/dispatch-response.json`
2. `/tmp/phase-e-review-smoke/evidence/final-run.json`
3. `/tmp/phase-e-review-smoke/evidence/conversation.json`
4. `/tmp/phase-e-review-smoke/evidence/summary.json`

关键 run：

1. `runId = 29ca8124-3eea-4bb6-8ce5-789abe74c0e1`

### Step 3：检查 runtime 历史与 artifact 目录

实际读取：

1. `/tmp/ag-phase-e-gateway/runs/29ca8124-3eea-4bb6-8ce5-789abe74c0e1/run-history.jsonl`
2. `/tmp/phase-e-review-smoke/demolong/runs/29ca8124-3eea-4bb6-8ce5-789abe74c0e1/`

---

## 4. provider / backend 实际命中情况

### 4.1 直接证据

#### A. backend 自检

`/tmp/phase-e-review-smoke/evidence/backend-self-check.json` 证明：

1. `native-codex` 在当前代码里注册成了 `ClaudeEngineAgentBackend`
2. 底层模型配置是：
   - `provider = native-codex`
   - `model = gpt-5.4`

#### B. server 日志

实际 server 日志出现了以下关键信号：

1. `Using non-language-server provider ... provider = native-codex`
2. `ClaudeEngineBackend` 被启动
3. `NativeCodexAdapter` 连续打印：
   - `Sending native Codex request`

#### C. run 记录

`/tmp/phase-e-review-smoke/evidence/final-run.json` 显示：

1. `provider = native-codex`
2. `resolutionReason` 中包含：
   - `Capability-aware routing kept provider "native-codex" for artifact-heavy; runtime family=claude-engine.`

#### D. run-history

`/tmp/ag-phase-e-gateway/runs/29ca8124-3eea-4bb6-8ce5-789abe74c0e1/run-history.jsonl` 记录了：

1. `run.created` 的 `provider = native-codex`
2. provider 实际发起了：
   - `FileReadTool`
   - `GlobTool`
3. 角色 child conversation handle 已生成为：
   - `native-codex-5daf8d97-4917-4a1e-bd6c-8aa0a68dbc1b`

### 4.2 结论

本轮可以明确判断：

1. **Department 主链确实命中了 `native-codex`**
2. 且不是旧 `NativeCodexExecutor` 本地聊天分支在兜底
3. 更准确地说，实际命中的主链是：
   - `ClaudeEngineAgentBackend('native-codex')`
   - `Claude Engine query/tool loop`
   - `NativeCodexAdapter`

上面第 3 点里，“最终流到了 `NativeCodexAdapter`”是基于 server 日志和当前 backend 自检做出的结论。

---

## 5. 真实失败点

### 5.1 最终结果

`/tmp/phase-e-review-smoke/evidence/final-run.json`：

1. `status = failed`
2. `currentRound = 1`
3. `activeRoleId = ux-review-author`
4. `lastError = Department runtime missing required artifacts: task-envelope.json, result-envelope.json, artifacts.manifest.json`

artifact 目录实测只落下了：

1. `/tmp/phase-e-review-smoke/demolong/runs/29ca8124-3eea-4bb6-8ce5-789abe74c0e1/task-envelope.json`

没有出现：

1. `specs/audit-report.md`
2. `specs/interaction-proposals.md`
3. `specs/priority-matrix.md`
4. `result.json`
5. `review/*`

### 5.2 关键 blocker 1：author 没有 file-write 工具

最关键的证据不是猜测，而是 `run-history.jsonl` 里 provider 的最后一段真实回复：

1. 它明确说当前环境里只有：
   - `read/search/web/question tools`
2. 明确说：
   - `no file-write tool is available`

这意味着 `ux-review-author` 在当前 runtime 下根本不具备把 `specs/` 写出来的能力，所以这条 review-loop 在结构上就不可能通过。

当前代码也支持这个解释：

1. [src/lib/agents/department-capability-registry.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/agents/department-capability-registry.ts:437)
   - `inferDepartmentToolset()` 对 `review` 类型不会命中 `coding`
   - 默认回落到 `safe`
2. [src/lib/claude-engine/tools/toolsets.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/claude-engine/tools/toolsets.ts:96)
   - `safe` toolset 明确是：
   - `Safe mode — no file writes, no shell`
   - 不包含 `FileWriteTool` / `FileEditTool`

### 5.3 关键 blocker 2：requiredArtifacts 校验在错误时机 / 错误基准目录上触发

最终失败错误是：

1. `Department runtime missing required artifacts: task-envelope.json, result-envelope.json, artifacts.manifest.json`

但实测 run 目录里明明已经存在：

1. `task-envelope.json`

这说明当前 required artifact 校验还有第二层问题：

1. 要么是按 `artifactRoot` 而不是按 run-scoped `artifactDir` 做解析
2. 要么是在 `group-runtime` 还没 finalize 出 `result-envelope.json` / `artifacts.manifest.json` 之前就提前校验了
3. 结果把原本应该在 stage / run 收尾阶段生成的文件，当成了 role session 必须已经存在的文件

当前代码中能对上这层解释的位置：

1. [src/lib/backends/claude-engine-backend.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/backends/claude-engine-backend.ts:337)
   - `normalizeRequiredArtifacts()` 把相对路径解析到 `artifactRoot ?? workspaceRoot`
2. [src/lib/backends/claude-engine-backend.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/backends/claude-engine-backend.ts:1073)
   - Claude Engine session 在 role 执行结束后立刻做 `validateRequiredArtifacts(...)`

---

## 6. 验收判断

### 是否通过

**不通过。**

### 原因

设计稿 `Phase E` 对这项的硬标准是：

1. `review-flow + native-codex` 至少有一条模板链路跑通

本轮真实 smoke 的最小 workspace 都没有跑通，而且失败并不是偶发模型回答问题，而是 runtime 级 blocker：

1. `review` 类型 Department 被推到了 `safe` toolset
2. author 无 file-write 工具，无法产出 `specs/`
3. requiredArtifacts 又在 role 结束时直接把 run 判死

所以截至 **2026-04-20 01:15 CEST**（证据文件中的 ISO 时间为 UTC），`Phase E` 的这条验收点不能算通过。

---

## 7. 本轮新增的本地证据

### Workspace 证据

1. `/tmp/phase-e-review-smoke/evidence/backend-self-check.json`
2. `/tmp/phase-e-review-smoke/evidence/dispatch-response.json`
3. `/tmp/phase-e-review-smoke/evidence/final-run.json`
4. `/tmp/phase-e-review-smoke/evidence/conversation.json`
5. `/tmp/phase-e-review-smoke/evidence/summary.json`

### Runtime 证据

1. `/tmp/ag-phase-e-gateway/runs/29ca8124-3eea-4bb6-8ce5-789abe74c0e1/run-history.jsonl`
2. `/tmp/phase-e-review-smoke/demolong/runs/29ca8124-3eea-4bb6-8ce5-789abe74c0e1/task-envelope.json`

---

## 8. 本轮没有做的事

本轮没有继续先修代码，原因是：

1. 用户要求优先验收、优先验证
2. 这条 smoke 已经足够形成明确的 `fail` 结论
3. blocker 已经定位到具体 runtime 接线，不需要靠“再猜一次”来判断通过与否

如果后续要继续推进修复，最小优先级建议是：

1. 先让 `review-loop` author 在 Department runtime 下拿到可写 artifact 的工具集
2. 再把 requiredArtifacts 的解析基准和校验时机改到 run/stage finalize 语义上
