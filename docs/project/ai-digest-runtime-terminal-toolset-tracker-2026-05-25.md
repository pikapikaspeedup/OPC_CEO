# AI 日报 runtime Terminal/toolset 问题跟踪

**状态**: 跟踪中，未解决  
**创建日期**: 2026-05-25  
**关联部门**: `/Users/darrel/Documents/baogaoai` / AI情报工作室  
**关联 workflow**: `/ai_digest`  
**关联 scheduler job**: `2a1a9a76-e63d-42c6-a4f5-99fb8b89c86f`

## 本文用途

持续跟踪 AI 日报无法通过 scheduler 成功生成并上报的问题，直到形成稳定闭环。

本文只记录当前事实、根因链路、待验证项和后续修复计划；不替代 `docs/PROJECT_PROGRESS.md`。只有修复完成并通过验证后，才把最终已完成行为同步到 `docs/PROJECT_PROGRESS.md`。

## 本轮边界

本轮只建立跟踪文档。

本轮不修改：

- `/ai_digest` workflow
- scheduler
- prompt executor
- provider routing
- Claude Engine toolset
- AI 情报工作室 `.department/config.json`
- `fetch_context.py`

## 当前结论

AI 日报当前失败不是因为安全模型完全禁止 Terminal 或 Python。

当前更准确的根因是：`/ai_digest` 运行时被推断为 `research` toolset，而 `research` toolset 不包含 `BashTool` / `ExecutionTool`，因此 Agent 在该次运行里没有 Terminal/python 执行能力。安全过滤层没有机会判断 `python3 fetch_context.py` 是否允许，因为命令执行工具本身没有进入本次 Agent 的工具列表。

## 已确认事实

### 1. Terminal/python 能力在系统中存在

代码中存在 `BashTool`，它位于 `shell` toolset：

- `src/lib/claude-engine/tools/toolsets.ts`

`coding` toolset 包含 `shell` 和 `execution`，因此会包含：

- `BashTool`
- `ExecutionTool`

`full` toolset 也包含 `shell` 和 `execution`。

### 2. research toolset 不包含 Terminal

`research` toolset 当前只包含：

- web
- search
- file
- memory
- AskUserQuestionTool
- ToolSearchTool
- ConfigTool

它不包含：

- `BashTool`
- `ExecutionTool`

这与当前 `/ai_digest` 的需求冲突，因为 workflow 要求 Agent 真实执行：

```bash
python3 .../workflow-scripts/ai_digest/fetch_context.py ...
```

### 3. AI 情报工作室会被推断为 research

`/Users/darrel/Documents/baogaoai/.department/config.json` 当前配置：

```json
{
  "name": "AI情报工作室",
  "type": "research",
  "provider": "native-codex"
}
```

并且 `日报总结`、`AI 大事件` 两个 skill 的 category 都是 `research`。

`src/lib/agents/department-capability-registry.ts` 的 `inferDepartmentToolset()` 会把这种部门推断为 `research`。

### 4. workflow-run 当前默认是 light execution class

`src/lib/agents/department-execution-resolver.ts` 中，`workflow-run` 默认不会自动升级为 artifact-heavy / delivery。

因此当前 `/ai_digest` 的 runtime contract 实际形态是：

```json
{
  "workspaceRoot": "/Users/darrel/Documents/baogaoai",
  "additionalWorkingDirectories": [],
  "readRoots": [
    "/Users/darrel/Documents/baogaoai",
    "/Users/darrel/Documents/baogaoai/demolong"
  ],
  "writeRoots": [
    "/Users/darrel/Documents/baogaoai/demolong",
    "/Users/darrel/Documents/baogaoai"
  ],
  "artifactRoot": "/Users/darrel/Documents/baogaoai/demolong",
  "executionClass": "light",
  "toolset": "research",
  "permissionMode": "default"
}
```

### 5. scheduler 触发时没有传 runtimeContract override

Scheduler job 当前 action：

```json
{
  "kind": "dispatch-execution-profile",
  "workspace": "file:///Users/darrel/Documents/baogaoai",
  "prompt": "生成今天的AI日报并上报",
  "executionProfile": {
    "kind": "workflow-run",
    "workflowRef": "/ai_digest",
    "skillHints": [
      "reporting",
      "baogaoai-ai-digest-generator"
    ]
  }
}
```

`src/lib/agents/scheduler.ts` 把它转换成 prompt executionTarget 后调用 `executePrompt()`，没有把原始 `executionProfile` 作为 runtime carrier 下传，也没有传入显式 runtimeContract。

### 6. 安全过滤层确实存在

如果 `BashTool` 被启用，执行前会经过：

- Department runtime permission check
- read/write root check
- bash security adapter

相关入口：

- `src/lib/claude-engine/engine/tool-executor.ts`
- `src/lib/claude-engine/security-adapters/bash-security-adapter.ts`
- `src/lib/claude-engine/tools/path-sandbox.ts`
- `src/lib/claude-engine/permissions/checker.ts`

本地探针显示，`python3 fetch_context.py ... --out ...prepared-ai-digest-context.json` 这种命令能通过当前 bash security 检查。当前失败点在 toolset 分配，不在 bash security 拒绝。

## 已观察到的运行结果

### run `10fab18f-382a-4b29-97b0-dcb9f9635686`

结果：

- Agent 不再空跑，返回 BLOCKED。
- Agent 声明当前 runtime 没有 shell/python 执行能力。
- finalize 失败：`AI 日报输出文件缺失：digest_output.json`。

### run `e678a945-7b20-4fae-9684-cc011cd7486c`

结果：

- Agent 使用了 WebFetch / FileWrite / FileEdit。
- 没有使用 BashTool。
- Agent 自行拼装了 `prepared-ai-digest-context.json`，但没有真实执行 `fetch_context.py`。
- finalize 失败：`AI 日报输出文件缺失：digest_output.json`。

该 run 的 API 返回中，`resolutionReason` 明确显示：

```text
Capability-aware routing kept provider "native-codex" for light; runtime family=claude-engine.
```

## 次级问题：fetch_context.py 日期窗口 fallback

即使 Terminal/toolset 修复后，还存在一个独立问题：

`fetch_context.py` 在窗口内无文章时会 fallback 到全量 selected articles，导致旧日期文章可能以 `status=ok` 进入日报上下文。

已观察到：

- 对 `2026-05-24` 和 `2026-05-25` 运行脚本，返回 `status=ok`、`articleCount=100`
- 但首篇文章 `createdAt=2026-05-22T21:27:49+08:00`

这说明 Terminal 问题解决后，还需要单独处理脚本窗口语义，否则日报仍可能拿到错误日期内容。

## 待解决问题

1. 让 `/ai_digest` 这类需要执行 workflow script 的 workflow 获得 Terminal/python 能力。
2. 保持 AI 情报工作室作为 research 部门的整体语义，不把整个 research 部门粗暴改成 coding。
3. 避免恢复 preflight，不引入隐藏上下文或强制 runtime 替 Agent 执行。
4. 明确 `runtimeProfile: daily-digest` / `runtimeScriptsDir: ai_digest` 是否应参与 runtimeContract 推断。
5. 修复或约束 `fetch_context.py` 的日期窗口 fallback 行为。
6. 修复后重新触发 scheduler job，并确认 `digest_output.json` 生成、finalize 上报成功、`GET /digest?date=YYYY-MM-DD` 可回读。

## 候选修复方向

优先方向：

只给明确需要 workflow script 的 canonical workflow 提升工具能力，而不是全局提升部门。

可选实现思路：

1. 在 prompt-mode 解析 workflow frontmatter 时，如果 workflow 声明 `runtimeScriptsDir`，则 runtimeContract.toolset 使用 `coding` 或一个更窄的 `scripted-research`。
2. 保留 Department Capability Pack 和 Playbook context，不引入 Knowledge 自动召回。
3. scheduler 的 `dispatch-execution-profile` prompt 分支应保留原始 executionProfile 到 taskEnvelope carrier，避免 workflow run 的执行语义丢失。
4. 对 `/ai_digest` 增加 targeted test，断言 backendConfig.toolset 包含可执行脚本能力。

需要谨慎点：

- 不要把所有 `research` 部门都改成 `coding`。
- 不要默认给所有 prompt-mode run 开 Terminal。
- 不要让 workflow frontmatter 变成新的隐藏上下文入口；这里只用于声明执行能力需求。
- 不要绕过 Department writeRoots/readRoots。

## 验证计划

修复后至少执行：

```bash
npx vitest run src/lib/agents/department-execution-resolver.test.ts src/lib/agents/prompt-executor.test.ts src/lib/agents/scheduler.test.ts
npx vitest run src/lib/agents/__tests__/prompt-runtime-contract.acceptance.test.ts
npx eslint src/lib/agents/department-execution-resolver.ts src/lib/agents/prompt-executor.ts src/lib/agents/scheduler.ts
npx tsc --noEmit --pretty false
git diff --check
```

运行验收：

```bash
curl -X POST http://127.0.0.1:3000/api/scheduler/jobs/2a1a9a76-e63d-42c6-a4f5-99fb8b89c86f/trigger
```

验收标准：

- 新 run 的 tool history 中出现 `BashTool` 或等价 Terminal 执行能力。
- `prepared-ai-digest-context.json` 由真实 `fetch_context.py` 生成。
- `digest_output.json` 存在。
- finalize 生成 `daily-digest-report-payload.json`。
- finalize 生成 `daily-digest-verification.json`。
- 日报接口可回读当天日报。

## 跟踪记录

### 2026-05-25

创建本文档。

当前明确结论：

- Terminal/python 能力存在。
- `/ai_digest` 当前拿不到 Terminal，是因为 runtime contract 的 toolset 为 `research`。
- 本问题应通过 workflow/script-aware 的 runtimeContract 推断或显式 runtime override 修复。
- 后续还要单独处理 `fetch_context.py` 的日期窗口 fallback。
