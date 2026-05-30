# Department runtime allowedTools impact assessment

**日期**: 2026-05-27
**状态**: 影响评估，未实现

## 本轮边界

本文只评估把 Department runtime 从 `type -> toolset` 推断，改为显式 `runtimePolicy.allowedTools` 配置的影响。

不评估逐脚本白名单，不修改代码，不触发 scheduler，不更新 `docs/PROJECT_PROGRESS.md`。

## 结论

推荐采用显式工具 allowlist：

```json
{
  "runtimePolicy": {
    "allowedTools": [
      "FileReadTool",
      "FileWriteTool",
      "FileEditTool",
      "GlobTool",
      "GrepTool",
      "WebFetchTool",
      "WebSearchTool",
      "BashTool"
    ],
    "deniedTools": [],
    "permissionMode": "default",
    "allowSubAgents": false
  }
}
```

`toolset` 可保留为快捷 preset，但不再作为权限核心。`type` 不再参与工具权限推断。

## 原架构已有能力

原架构并不是没有 runtime 权限机制，已有能力包括：

1. `DepartmentRuntimeContract.toolset`：可以声明 `research / coding / safe / full`。
2. `POST /api/agent-runs` 的 `departmentRuntimeContract` / `runtimeContract`：支持调用方临时传入 runtime 合同。
3. `PromptExecutor` / `GroupRuntime`：会把 runtime contract 透传到 backend。
4. Claude Engine backend：会把 `toolset` 传给 engine。
5. `query-loop`：会按 `toolset` 过滤发给模型的工具 schema。
6. Department runtime policy：已有 read roots / write roots / permission checker / Bash security。

因此，如果只看“能不能让一次运行拿到 BashTool”，原架构已经有入口：传一个 `departmentRuntimeContract.toolset = "coding"` 即可。

## 原架构缺口

当前失败不是因为架构完全没有权限层，而是以下缺口叠加：

1. `.department/config.json` 没有持久化 runtime 工具配置。
2. `DepartmentConfig.executionPolicy` 只管 workspace / context docs，不管工具权限。
3. `DepartmentRuntimeContract` 只有粗粒度 `toolset`，没有 `allowedTools`。
4. 默认 runtime contract 通过 `type / skill.category` 推断 toolset，导致 AI 情报工作室落到 `research`。
5. Scheduler 的 `dispatch-execution-profile` 分支没有把原始 `executionProfile` 或 runtime override 放进 `taskEnvelope` 继续下传。

## 是否必须做 allowedTools 改造

不必须。要分目标：

### 目标 A：只修 AI 日报

不需要完整 `allowedTools` 改造。

最小改法是复用现有架构：

1. 让 scheduler action 能携带 runtime contract，或在触发时补入 runtime contract。
2. 给 AI 情报工作室日报 job 设置：

```json
{
  "departmentRuntimeContract": {
    "toolset": "coding",
    "permissionMode": "default"
  }
}
```

这样可以让该 run 拿到 `BashTool`，不需要改 Claude Engine 工具过滤模型。

### 目标 B：部门可长期配置工具权限

需要小改，但不一定需要 `allowedTools`。

可以先新增：

```json
{
  "runtimePolicy": {
    "toolset": "coding"
  }
}
```

然后让 `buildDepartmentRuntimeContract()` 优先读 `config.runtimePolicy.toolset`，停止用 `type` 推断工具权限。这比 `allowedTools` 小得多。

### 目标 C：工具权限要透明到单个工具

才需要 `allowedTools`。

这不是修日报的必要条件，而是权限产品化/审计透明化的增强项。

## 正向影响

1. 权限语义更直观：配置里写了什么工具，Agent 就能看到什么工具。
2. 可复用性更强：AI 情报工作室、工程部门、研究部门、运营部门都使用同一个 `runtimePolicy.allowedTools` 模型。
3. 去掉特殊化：不需要按 `/ai_digest`、`workflow-run`、`research type` 做分支。
4. 排障更直接：缺工具时直接看 `.department/config.json` 的 allowlist，不需要追 `inferDepartmentToolset()`。
5. 审计更清晰：可以把每次 run 的最终工具列表写入 run metadata / envelope。

## 主要影响面

### 1. 配置模型

影响文件：

- `src/lib/types.ts`
- `src/lib/department-config.ts`
- `.department/config.json`
- 部门配置 API / UI 文档

需要新增：

- `DepartmentRuntimePolicy`
- `DepartmentConfig.runtimePolicy`
- `allowedTools?: string[]`
- `deniedTools?: string[]`
- `toolset?: DepartmentToolset`
- `permissionMode?`
- `executionClass?`
- `allowSubAgents?`

兼容策略：

- 老配置没有 `runtimePolicy` 时，走系统默认工具列表。
- 老的 `runtimeContract.toolset` 继续支持，避免打断已有 API 调用。
- 新配置优先级：`allowedTools` > `toolset preset` > 系统默认。

### 2. Runtime contract

影响文件：

- `src/lib/organization/contracts.ts`
- `src/lib/agents/department-capability-registry.ts`
- `src/lib/agents/department-execution-resolver.ts`

需要扩展 `DepartmentRuntimeContract`：

```ts
allowedTools?: string[];
deniedTools?: string[];
```

需要停止长期依赖：

- `inferDepartmentToolset(config.type)`
- `skill.category -> toolset`

可保留迁移期 fallback，但最终应从 runtime 权限路径移除。

### 3. Backend payload

影响文件：

- `src/lib/backends/types.ts`
- `src/lib/backends/claude-engine-backend.ts`
- `src/lib/agents/prompt-executor.ts`
- `src/lib/agents/group-runtime.ts`

当前只透传 `toolset`。需要把 `allowedTools/deniedTools` 从 runtime contract 透传到 backend payload，再进入 Claude Engine。

关键要求：

- 最终工具列表必须在 backend 侧归一化。
- 未知工具名要 fail fast，而不是静默忽略。
- run envelope 应记录最终工具列表，便于后续排障。

### 4. Claude Engine 工具过滤

影响文件：

- `src/lib/claude-engine/engine/types.ts`
- `src/lib/claude-engine/engine/query-loop.ts`
- `src/lib/claude-engine/tools/toolsets.ts`
- `src/lib/claude-engine/tools/registry.ts`

当前 query-loop 只支持 `toolset` 过滤：

```ts
if (config.toolset) {
  const allowedNames = new Set(resolveToolset(config.toolset));
  tools = tools.filter((tool) => allowedNames.has(tool.name));
}
```

需要改为统一 resolve：

1. 如果有 `allowedTools`，按 `allowedTools` 过滤。
2. 否则如果有 `toolset`，按 preset 过滤。
3. 最后扣除 `deniedTools`。
4. MCP 动态工具只在显式允许或 `toolset=full` 时进入。

### 5. Permission checker

影响文件：

- `src/lib/backends/claude-engine-backend.ts`
- `src/lib/claude-engine/engine/tool-executor.ts`

当前 `createPermissionCheckerForTools()` 使用 `mergedTools.map(tool => tool.name)` 加 allow rule，而 query-loop 后面才按 toolset 过滤。

改造后应调整为：

- 先算 `effectiveTools`
- `query-loop` 只收到 `effectiveTools`
- `permissionChecker` 也只 allow `effectiveTools`

这样“模型能看到的工具”和“runtime 允许执行的工具”同源，审计更干净。

### 6. AgentTool / sub-agent

影响文件：

- `src/lib/backends/claude-engine-backend.ts`
- `src/lib/claude-engine/tools/agent.ts`

当前默认 `allowSubAgents=false`。如果未来显式开启 sub-agent，子 Agent 必须继承父 run 的有效工具列表，并且默认扣掉 `AgentTool`，避免递归扩权。

需要避免：

- 父 Agent 只允许 `BashTool`，子 Agent 却因为 fallback 到 `toolset` 拿到更多工具。

### 7. Scheduler

影响文件：

- `src/lib/agents/scheduler.ts`
- `src/lib/agents/scheduler-types.ts`

显式 `allowedTools` 后，scheduler 不需要特殊判断 workflow。它只需要确保 dispatch 时能保留 runtime carrier：

- 原始 `executionProfile`
- 可选 `runtimeContract`

这不是为了授权特殊化，而是为了 run history / resolver / envelope 保持语义完整。

### 8. API 与文档

影响文件：

- `docs/guide/gateway-api.md`
- `docs/guide/cli-api-reference.md`
- `docs/guide/agent-user-guide.md`
- 可能涉及 `src/app/api/agent-runs/route.ts` 和相关测试

需要补充：

- `runtimePolicy.allowedTools`
- `runtimePolicy.deniedTools`
- `departmentRuntimeContract.allowedTools`
- 工具名合法值来自 `createDefaultRegistry()`

## 风险

1. 默认从 `research` 变成允许执行后，旧部门会获得更多工具。若要保守迁移，可先只给 AI 情报工作室配置 `allowedTools`，系统默认暂不改。
2. `allowedTools` 配错会直接缺工具。需要配置校验和清晰错误。
3. `BashTool` 一旦允许，仍是通用命令执行能力。现有 Bash security 和 root policy 会继续保护，但它不是逐命令业务白名单。
4. MCP 工具命名是动态的，不能简单和内置工具完全同构。第一版可以只支持内置工具 allowlist，MCP 后续单独扩展。
5. 文档和 UI 如果只展示 preset，不展示最终工具列表，会继续造成误判。最终工具列表必须可见。

## 分阶段建议

### Phase 1：最小可用

1. 支持 `runtimePolicy.allowedTools/deniedTools`。
2. Department config 归一化保留新字段。
3. Runtime contract 透传新字段。
4. Claude Engine 按有效工具列表过滤。
5. Permission checker 改为只 allow 有效工具。
6. 给 AI 情报工作室配置 `BashTool`。

### Phase 2：治理增强

1. 配置保存时校验工具名。
2. API 返回最终工具列表。
3. UI 支持勾选工具。
4. run envelope 记录 effectiveTools。

### Phase 3：默认策略切换

确认多个部门验收后，再决定是否把系统默认工具列表切到包含 `BashTool`。

## 测试建议

最小测试集：

```bash
npx vitest run src/lib/department-config.test.ts src/lib/agents/department-capability-registry.test.ts
npx vitest run src/lib/backends/__tests__/claude-engine-backend.test.ts src/lib/backends/__tests__/claude-engine-runtime-config.test.ts
npx vitest run src/lib/claude-engine/tools/__tests__/tools.test.ts src/lib/agents/prompt-executor.test.ts
npx vitest run src/lib/agents/__tests__/prompt-runtime-contract.acceptance.test.ts
npx eslint src/lib/types.ts src/lib/department-config.ts src/lib/agents/department-capability-registry.ts src/lib/backends/claude-engine-backend.ts src/lib/claude-engine/engine/query-loop.ts
npx tsc --noEmit --pretty false
git diff --check
```

业务验收：

1. AI 情报工作室配置 `allowedTools` 包含 `BashTool`。
2. 触发日报 scheduler。
3. 确认 run envelope 记录 `BashTool`。
4. 确认生成 `prepared-ai-digest-context.json` 与 `digest_output.json`。
5. 确认没有开启 `AgentTool`。
