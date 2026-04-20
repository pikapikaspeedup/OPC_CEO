# Claude Engine Department Runtime 接入 Review（2026-04-19）

## 背景

用户提出两个明确目标：

1. 让 `Claude Engine` 成为所有 API-backed provider 的 Department runtime
2. `native-codex` 也必须拥有 Department runtime 级别能力，而不是只做轻量 completion executor

本 review 的问题是：

> 当前仓库里的 `Claude Engine` 已经移植了不少 Claude Code 逻辑，为什么这些 runtime 能力没有真正接进 Department 执行链？

结论先说：

- **不是 `Claude Engine` 没能力**
- 而是 **能力没有穿透到 backend 合同、runtime 路由和 provider 适配层**

---

## Finding 1：`Claude Engine` 只挂在 API-backed provider 上，`native-codex` 完全走了另一条 backend 链

严重度：

- `P1`

证据：

1. `ClaudeEngineAgentBackend` 只被注册到：
   - `claude-api`
   - `openai-api`
   - `gemini-api`
   - `grok-api`
   - `custom`
2. `native-codex` 使用的是 `NativeCodexAgentBackend`

关键位置：

- [builtin-backends.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/backends/builtin-backends.ts:1210)
- [builtin-backends.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/backends/builtin-backends.ts:1192)
- [prompt-executor.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/agents/prompt-executor.ts:423)

结论：

即使 `Claude Engine` 已经具备文件工具、query loop、permission checker，当前也不会影响 `native-codex` 的执行表现。  
所以现在讨论“为什么 `review-flow + native-codex` 不行”，不能指望 `Claude Engine` 自动覆盖那条路径，因为它们根本不是同一 backend。

---

## Finding 2：`BackendRunConfig` 太薄，无法承载 Department runtime 所需的执行边界

严重度：

- `P1`

证据：

当前 `AgentBackend` 输入合同里只有：

1. `workspacePath`
2. `prompt`
3. `artifactDir`
4. `executionTarget`
5. `memoryContext`

但没有：

1. `toolset`
2. `permissionMode`
3. `allowedWriteRoots`
4. `readRoots`
5. `additionalWorkingDirectories`
6. `artifact contract`
7. `department contract`

关键位置：

- [backends/types.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/backends/types.ts:34)

而 `Claude Engine` 自己的工具上下文其实预留了：

- `additionalWorkingDirectories`

关键位置：

- [tool.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/claude-engine/types/tool.ts:17)

但 `createClaudeEngineToolContext()` 实际只喂了：

1. `workspacePath`
2. `abortSignal`
3. `readFile/writeFile/exec`

没有把 Department 级别边界传下去。

关键位置：

- [claude-engine-backend.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/backends/claude-engine-backend.ts:149)

结论：

当前 `Claude Engine` 更像“能跑工具的 agent loop”，不是“Department runtime”。  
真正缺的是平台侧合同：Department 工作目录、读写范围、产物协议，没有被 backend 输入层表达出来。

---

## Finding 3：权限系统只存在于 Claude Engine 内部对象里，没有进入实际工具调度决策

严重度：

- `P1`

证据：

`ClaudeEngine` 构造时确实创建了：

- `PermissionChecker`

关键位置：

- [claude-engine.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/claude-engine/engine/claude-engine.ts:61)

但后续执行路径里：

1. `queryLoop()` 只创建 `ToolExecutor`
2. `ToolExecutor.executeSingleTool()` 里对绝大多数工具直接 `tool.call(...)`
3. 只有 `BashTool` 额外走了 `bash-security-adapter`

关键位置：

- [query-loop.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/claude-engine/engine/query-loop.ts:28)
- [tool-executor.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/claude-engine/engine/tool-executor.ts:41)
- [tool-executor.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/claude-engine/engine/tool-executor.ts:71)

对比上游 `claude-code`：

上游在 query 主循环里有更完整的：

1. `canUseTool`
2. `getToolPermissionContext`
3. `mcpTools`
4. `allowedAgentTypes`

这些东西在进入模型与工具循环时一起参与决策。

关键位置：

- [../claude-code/src/query.ts](</Users/darrel/Documents/claude-code/src/query.ts:561>)
- [../claude-code/src/query.ts](</Users/darrel/Documents/claude-code/src/query.ts:659>)

结论：

当前移植过来的 `PermissionChecker` 更多是“能力库存”，不是“真实 enforcement”。  
所以你期望的“Department 限定一个或多个目录工作读写”还没有变成严格执行门。

---

## Finding 4：工具注册表里有高级能力，但很多没有注入 provider/handler，运行时只是半空壳

严重度：

- `P1`

证据：

默认工具注册表已经包含：

1. `AgentTool`
2. `ListMcpResourcesTool`
3. `ReadMcpResourceTool`
4. `BashTool`
5. `FileRead/Write/Edit`

关键位置：

- [registry.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/claude-engine/tools/registry.ts:28)

但这些能力并不都已真正接线：

1. `AgentTool` 需要外部 `setAgentHandler()`
2. MCP 资源工具需要外部 `setMcpResourceProvider()`
3. 我没有看到 `ClaudeEngineAgentBackend` 在启动时给这两类高级能力做注入

关键位置：

- [agent.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/claude-engine/tools/agent.ts:46)
- [agent.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/claude-engine/tools/agent.ts:51)
- [mcp-resources.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/claude-engine/tools/mcp-resources.ts:20)
- [mcp-resources.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/claude-engine/tools/mcp-resources.ts:22)

结论：

`Claude Engine` 当前拥有“工具目录”，但不是所有工具都已变成 Department runtime 的真实能力。  
这也是你看到“感觉很像 Claude Code，但跑起来又没有那个味道”的原因之一。

---

## Finding 5：文件边界目前只有“别逃出 workspace”，还不是 Department contract

严重度：

- `P2`

证据：

当前文件工具通过 `resolveSandboxedPath()` 收住：

1. `workspacePath`
2. `additionalWorkingDirectories`

关键位置：

- [path-sandbox.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/claude-engine/tools/path-sandbox.ts:8)

这是有价值的，但它解决的是：

- “不要越出 workspace 根”

不是：

1. 这个 Department 允许读哪些目录
2. 这个 Department 允许写哪些目录
3. 是否只能写 `artifactDir`
4. 某些模板阶段是否只能写 `specs/` 或 `review/`

结论：

当前是“文件系统 sandbox 原语存在”，但“Department 级读写 contract”还没有平台化。

---

## Finding 6：ClaudeEngineBackend 能力矩阵比 `native-codex` 强，但 runtime 没有基于能力做任务路由

严重度：

- `P2`

证据：

`ClaudeEngineAgentBackend` 暴露：

1. `supportsAppend = true`
2. `supportsCancel = true`
3. `emitsStreamingText = true`

关键位置：

- [claude-engine-backend.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/backends/claude-engine-backend.ts:469)

`native-codex` 则是：

1. `supportsIdeSkills = false`
2. `supportsSandbox = false`
3. `supportsCancel = false`
4. `supportsStepWatch = false`

关键位置：

- [native-codex-executor.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/providers/native-codex-executor.ts:332)

但当前 `prompt-executor` / `group-runtime` 仍主要是：

- `resolveProvider('execution', workspacePath)`
- 然后直接 `getAgentBackend(provider)`

没有看到像：

1. “高约束 review-flow 禁止落到低能力 backend”
2. “需要 file/tool contract 的任务优先走 Claude Engine”
3. “native-codex 只接轻任务”

这样的 runtime 路由层。

关键位置：

- [prompt-executor.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/agents/prompt-executor.ts:318)
- [prompt-executor.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/agents/prompt-executor.ts:423)

结论：

问题不只是“能力有没有”，而是“平台有没有拿这些能力做 provider/runtime routing”。  
现在没有，所以低能力 backend 也可能被派去跑高约束任务。

---

## 总结判断

### 能力层

`Claude Engine` 里已经有很多 Department runtime 需要的底层零件：

1. 文件工具
2. shell 工具
3. MCP 资源工具
4. toolset
5. transcript
6. append / cancel
7. 权限 checker 原语

### 断点层

真正没接进来的，是三条桥：

1. **Backend 合同桥**
   - `BackendRunConfig` 太薄，Department 边界没有表达进去
2. **Execution 路由桥**
   - runtime 不按能力矩阵分配 provider
3. **Tool/Permission 注入桥**
   - 高级工具和权限上下文没有在 backend 启动时真正注入

### 对用户问题的直接回答

所以答案不是：

- “移植不够多”

而是：

- **移植了不少底层能力，但平台接线层没有完成**

---

## 建议的下一步

如果继续推进，最值得优先做的不是“继续零散抄代码”，而是三个明确动作：

1. 扩展 `BackendRunConfig`
   - 加入 Department runtime 所需字段：
     - `toolset`
     - `additionalWorkingDirectories`
     - `allowedWriteRoots`
     - `artifact contract`
     - `permission mode`
2. 在 `ClaudeEngineAgentBackend` 启动时注入：
   - `AgentTool` handler
   - MCP resource provider
   - Department-scoped permission context
3. 在 runtime 层加 capability-aware routing
   - 高约束 `review-flow` / artifact-heavy 任务优先路由到 Claude Engine
   - `native-codex` 先限定在轻量 Department 任务

只有这样，`Claude Engine` 才会从“移植过来的工具引擎”升级成“真正的 Department runtime”。
