# Claude Engine Department Runtime 子任务 B 复跑验收（主线程两处修复后）

**日期**: 2026-04-20  
**结论**: `review-flow + native-codex` 复跑后仍然 **未通过**，但失败面已经变化

## 1. 本轮目标

主线程刚完成两处修复后，重新执行一条真实的 `review-flow + native-codex` smoke，确认：

1. `native-codex` provider 主链是否仍真实命中
2. 上一轮的 `requiredArtifacts` / `artifactRoot` 问题是否消失
3. `design-review-template / ux-review` 现在是否仍失败；如果仍失败，失败点是什么

本轮继续优先使用：

1. `templateId = design-review-template`
2. `stageId = ux-review`

---

## 2. 隔离环境

### Gateway

实际启动：

```bash
AG_GATEWAY_HOME=/tmp/ag-phase-e-gateway-rerun PORT=3000 npm run dev
```

隔离数据根：

1. `/tmp/ag-phase-e-gateway-rerun`

### Smoke workspace

本轮使用新的最小临时 workspace，避免混入上一轮 artifacts：

1. `/tmp/phase-e-review-smoke-rerun`

其中保留：

1. `.department/config.json`
2. `src/index.html`
3. `src/styles.css`
4. `src/app.js`

---

## 3. 修复前置核对

本轮先核对主线程提到的两处修复确实在当前代码里：

### 3.1 `native-codex` provider 主链

代码：

1. [claude-engine-backend.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/backends/claude-engine-backend.ts:128)

当前 `resolveApiBackedModelConfig('native-codex')` 返回：

1. `provider = native-codex`
2. `model = gpt-5.4`

### 3.2 resolver 不再自动补 envelope 文件到 `requiredArtifacts`

代码：

1. [department-execution-resolver.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/agents/department-execution-resolver.ts:298)

当前 `buildRequiredArtifacts()` 仅对继承值做去重，不再自动补：

1. `task-envelope.json`
2. `result-envelope.json`
3. `artifacts.manifest.json`

### 3.3 runtime contract 在 backend config 层绑定 run 级 artifact 目录

代码：

1. [group-runtime.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts:183)
2. [group-runtime.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts:1237)

`bindRuntimeContractToArtifactRoot()` 会把 runtime contract 的 `artifactRoot` 重绑到当前 run 的 `artifactAbsDir`，并在构造 `BackendRunConfig` 时传入。

---

## 4. 真实运行步骤

### Step 1：backend 自检

实际运行：

```bash
npx tsx -e "import fs from 'node:fs'; import { ensureBuiltInAgentBackends } from './src/lib/backends/builtin-backends'; import { getAgentBackend } from './src/lib/backends/registry'; import { resolveApiBackedModelConfig } from './src/lib/backends/claude-engine-backend'; ensureBuiltInAgentBackends(); const backend = getAgentBackend('native-codex'); const out = { constructor: backend.constructor?.name, providerId: backend.providerId, capabilities: backend.capabilities(), modelConfig: resolveApiBackedModelConfig('native-codex') }; fs.mkdirSync('/tmp/phase-e-review-smoke-rerun/evidence', { recursive: true }); fs.writeFileSync('/tmp/phase-e-review-smoke-rerun/evidence/backend-self-check.json', JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 2));"
```

证据：

1. `/tmp/phase-e-review-smoke-rerun/evidence/backend-self-check.json`

### Step 2：真实 dispatch

实际 `POST /api/agent-runs` body：

1. `workspace = file:///tmp/phase-e-review-smoke-rerun`
2. `provider = native-codex`
3. `templateId = design-review-template`
4. `stageId = ux-review`
5. `executionProfile.kind = review-flow`

关键 run：

1. `runId = 053df238-5b59-4a01-938c-ea8dae6dcf7d`

### Step 3：poll + 证据落盘

实际写入：

1. `/tmp/phase-e-review-smoke-rerun/evidence/dispatch-response-rerun.json`
2. `/tmp/phase-e-review-smoke-rerun/evidence/latest-run-rerun.json`
3. `/tmp/phase-e-review-smoke-rerun/evidence/final-run-rerun.json`
4. `/tmp/phase-e-review-smoke-rerun/evidence/conversation-rerun.json`
5. `/tmp/phase-e-review-smoke-rerun/evidence/summary-rerun.json`

同时读取：

1. `/tmp/ag-phase-e-gateway-rerun/runs/053df238-5b59-4a01-938c-ea8dae6dcf7d/run-history.jsonl`

---

## 5. provider / backend 实际命中情况

### 5.1 命中结论

本轮仍然明确命中了：

1. `ClaudeEngineAgentBackend('native-codex')`
2. `NativeCodexAdapter`

### 5.2 证据

#### A. backend 自检

`/tmp/phase-e-review-smoke-rerun/evidence/backend-self-check.json` 显示：

1. `constructor = ClaudeEngineAgentBackend`
2. `providerId = native-codex`
3. `modelConfig.provider = native-codex`

#### B. server 日志

server 日志真实出现：

1. `Using non-language-server provider ... provider = native-codex`
2. `Sending native Codex request`

#### C. final run

`/tmp/phase-e-review-smoke-rerun/evidence/final-run-rerun.json` 显示：

1. `provider = native-codex`
2. `resolutionReason` 中仍包含：
   - `Capability-aware routing kept provider "native-codex" ... runtime family=claude-engine`

---

## 6. 与上一轮相比，什么已经修复

### 6.1 不再死在 `requiredArtifacts`

上一轮失败是：

1. `Department runtime missing required artifacts: task-envelope.json, result-envelope.json, artifacts.manifest.json`

本轮已经**没有**出现这类错误。

这说明：

1. resolver 不再自动补那三个 envelope 文件到 `requiredArtifacts`
2. 主线程关于 `artifactRoot` / required artifact 的修复已经改变了真实运行行为

### 6.2 author 角色能正常返回 completed 结果

这次 `final-run-rerun.json` 里：

1. `ux-review-author.status = completed`

说明 Claude Engine session 本身没有再因为 envelope 校验而提前 backend fail。

---

## 7. 当前仍然失败的真实原因

### 7.1 终态

最终 run 仍然是：

1. `status = failed`
2. `runId = 053df238-5b59-4a01-938c-ea8dae6dcf7d`

最终错误：

1. `Author role ux-review-author completed without producing output files in specs/. The child conversation may have errored during file creation.`

证据：

1. `/tmp/phase-e-review-smoke-rerun/evidence/summary-rerun.json`
2. `/tmp/phase-e-review-smoke-rerun/evidence/final-run-rerun.json`

### 7.2 真正 blocker：author 仍没有 file-write capability

`run-history.jsonl` 里已经给出最直接的真实证据。

provider 最终明确返回：

1. 当前环境只暴露：
   - `read/search/web/question tools`
2. `no file-write capability`
3. 因此不能创建：
   - `specs/audit-report.md`
   - `specs/interaction-proposals.md`
   - `specs/priority-matrix.md`
   - `result.json`

同时 conversation 回放里也只看到：

1. user prompt
2. assistant 的 blocked 回复

证据：

1. `/tmp/ag-phase-e-gateway-rerun/runs/053df238-5b59-4a01-938c-ea8dae6dcf7d/run-history.jsonl`
2. `/tmp/phase-e-review-smoke-rerun/evidence/conversation-rerun.json`

### 7.3 当前 artifact 目录仍然没有 `specs/`

实际 artifact 目录只存在：

1. `task-envelope.json`

没有：

1. `specs/`
2. `review/`
3. `result.json`

证据：

1. `/tmp/phase-e-review-smoke-rerun/demolong/runs/053df238-5b59-4a01-938c-ea8dae6dcf7d/task-envelope.json`

---

## 8. 为什么还是没有写文件能力

这次根因已经比上一轮更干净：

1. 不是 `requiredArtifacts` 抢先把 run 判死
2. 而是 `review` 类型 Department 仍然落到了 `safe` toolset

代码：

1. [department-capability-registry.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/agents/department-capability-registry.ts:437)
   - `inferDepartmentToolset()` 对 `review` 类型不会命中 `coding`
   - 默认回落到 `safe`
2. [toolsets.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/claude-engine/tools/toolsets.ts:96)
   - `safe` 明确定义为：
   - `Safe mode — no file writes, no shell`

而这条 `review-loop` 模板本身却要求 author 必须写：

1. `specs/*.md`
2. `result.json`

所以当前真实状态是：

1. provider 主链已通
2. envelope / requiredArtifacts 的旧 blocker 已缓解
3. **但 `review-loop` 的工具集与模板产物合同仍然互相冲突**

---

## 9. 更新后的验收结论

### 是否仍失败

**仍然失败。**

### 当前失败点

当前最真实、最核心的失败点是：

1. `ux-review-author` 仍然拿不到 file-write 工具
2. 因而无法写出 `specs/` 与 `result.json`
3. 最终被 review runtime 以“未在 `specs/` 产出输出文件”判定失败

### 与上一轮的区别

上一轮：

1. 先死在 `requiredArtifacts` / envelope 校验

本轮：

1. 不再死在 `requiredArtifacts`
2. 真正暴露出剩余 blocker 是：
   - `toolset = safe`
   - 模板要求写文件
   - 两者冲突

---

## 10. 关键证据文件

1. `/tmp/phase-e-review-smoke-rerun/evidence/backend-self-check.json`
2. `/tmp/phase-e-review-smoke-rerun/evidence/dispatch-response-rerun.json`
3. `/tmp/phase-e-review-smoke-rerun/evidence/final-run-rerun.json`
4. `/tmp/phase-e-review-smoke-rerun/evidence/conversation-rerun.json`
5. `/tmp/phase-e-review-smoke-rerun/evidence/summary-rerun.json`
6. `/tmp/ag-phase-e-gateway-rerun/runs/053df238-5b59-4a01-938c-ea8dae6dcf7d/run-history.jsonl`
