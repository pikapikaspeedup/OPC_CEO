# Department executable tool runtime policy

**日期**: 2026-05-26
**更新**: 2026-05-27
**状态**: 研究结论，未实现

## 背景

AI 日报 `/ai_digest` 的 scheduler run 已经能命中 workflow，但运行时被推断为 `research` toolset。`research` 不包含 `BashTool` / `ExecutionTool`，因此 Agent 无法执行 `fetch_context.py`，最终缺失 `digest_output.json`。

当前问题不是系统没有执行工具，也不是 Bash 安全检查拒绝了命令，而是可执行工具没有进入该 run 的工具列表。

## 目标

1. 让需要执行脚本或命令的部门 run 能拿到可执行工具。
2. 机制要能复用于其他项目和部门，不硬编码 AI 情报工作室或 `/ai_digest`。
3. 部门配置可以显式配置运行时工具策略。
4. 默认允许部门 run 使用可执行工具，但保留部门级关闭能力。
5. 权限模型保持简单，不做逐脚本白名单。

## 推荐结论

第一版不建议做“只允许执行 canonical workflow scripts 下某个脚本”的细粒度白名单。

原因：

1. 它会把平台安全策略和具体 workflow 资产路径强耦合。
2. 其他项目常见入口可能是 `npm run`、`make`、`go test`、`python scripts/foo.py`，不一定都在 canonical workflow-scripts 目录。
3. 每新增一个脚本目录都要扩安全策略，维护成本高。
4. 当前真正缺的是“部门级可执行工具授权”，不是“脚本路径解析器”。

更合适的抽象是：`type` 只表达部门业务分类和路由语义，不表达运行权限。运行权限由独立的 `runtimePolicy` 直接决定。执行时继续复用现有 Department runtime roots、permission checker 和 Bash security。

## 配置形态建议

新增 `.department/config.json` 的顶层 `runtimePolicy`。不要把权限字段继续塞进 `type`，也不要让 `executionPolicy` 继续膨胀成权限集合；`executionPolicy` 保留给默认 workspace、上下文文档等执行位置策略。

推荐以显式工具列表为主：

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
    ]
  }
}
```

`toolset` 只保留为快捷 preset，不作为权限推断来源：

```json
{
  "runtimePolicy": {
    "toolset": "coding",
    "executionClass": "artifact-heavy",
    "permissionMode": "default",
    "allowSubAgents": false
  }
}
```

字段语义：

- `allowedTools`: 精确允许进入本次 Agent 工具列表的工具名。配置后以它为准。
- `deniedTools`: 可选拒绝列表，用于从 preset 或默认工具集中扣掉少数工具。拒绝优先级高于允许。
- `toolset`: 可选快捷 preset，例如 `research` / `coding` / `safe` / `full`。只用于快速展开一组默认工具，不再由 `type` 推断。
- `executionClass`: 部门默认执行级别。需要稳定产物的 workflow 可用 `artifact-heavy`。
- `permissionMode`: 继续使用现有权限模式，默认 `default`。
- `allowSubAgents`: 是否允许子 Agent，默认 `false`。

第一版不新增 `automation` 工具集。直接暴露工具名最简单，`toolset` 只是省配置的快捷方式。

## 默认策略

推荐默认规则：

1. `type` 不参与 toolset / permissionMode / allowSubAgents 推断。
2. 如果配置了 `runtimePolicy.allowedTools`，最终工具列表就是这份 allowlist，再扣除 `deniedTools`。
3. 如果没有 `allowedTools`，但配置了 `runtimePolicy.toolset`，展开这个 preset，再扣除 `deniedTools`。
4. 如果两者都没有，使用系统默认工具列表；为了“默认允许执行”，默认建议等价于当前 `coding` preset，但仍由 `allowSubAgents=false` 拦住子 Agent。
5. 不按 `workflow-run`、`prompt`、`type` 做特殊升级或降级。
6. 未知工具名应该 fail fast 或在部门配置保存时校验失败，避免静默缺工具。

这样 AI 日报、AI 大事件、其他部门 workflow 都能拿到脚本执行能力；如果某个部门希望保持纯研究/保守模式，就在部门配置里显式写 `allowedTools` 或 `toolset = "research"` / `"safe"`。权限不再跟部门业务类型耦合，也不需要 workflow 特判。

## 需要改的主链路

1. `src/lib/types.ts`
   - 新增 `DepartmentRuntimePolicy`，包含 `allowedTools?: string[]`、`deniedTools?: string[]`、`toolset?: DepartmentToolset`、`executionClass?`、`permissionMode?`、`allowSubAgents?`。
   - 在 `DepartmentConfig` 上加入 `runtimePolicy?: DepartmentRuntimePolicy`。

2. `src/lib/department-config.ts`
   - 归一化并保留 `runtimePolicy`，避免 `.department/config.json` 写了也被丢弃。

3. `src/lib/agents/department-capability-registry.ts`
   - `buildDepartmentRuntimeContract()` 优先读取 `config.runtimePolicy`。
   - 停止把 `config.type` 作为权限推断来源。
   - 缺省工具列表走统一系统默认值，不看 workflow / type / skill category。

4. `src/lib/agents/department-execution-resolver.ts`
   - 不再在 `workflow-run` 场景做工具集特殊提升。
   - 只负责把 Department runtime contract 继续下传。

5. `src/lib/agents/scheduler.ts`
   - `dispatch-execution-profile` 调用 `executePrompt()` 时，把原始 `executionProfile` 放入 `taskEnvelope`。
   - 避免 scheduler 把 workflow-run 语义只转换成 prompt refs 后丢失运行时意图。

## 权限策略

第一版采用简单模型：

1. 不做逐脚本白名单。
2. 不解析 Bash 命令参数里的每个文件路径。
3. 继续使用现有 Department read/write roots。
4. 继续使用现有 Bash security adapter 拦截危险命令。
5. 继续默认禁用 sub-agent。
6. 默认不使用 `bypassPermissions`。

这意味着：一旦部门获得 `coding` toolset，它可以在该 Department workspace 的运行时边界内执行安全检查通过的命令，而不是只执行某个固定脚本。

## AI 情报工作室建议配置

AI 情报工作室适合配置为：

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
    "executionClass": "artifact-heavy",
    "permissionMode": "default",
    "allowSubAgents": false
  }
}
```

这不会把部门类型从 `research` 改成 `build`，只是声明该部门的 workflow 运行需要自动化执行工具。

## 验证建议

实现后至少验证：

```bash
npx vitest run src/lib/agents/department-execution-resolver.test.ts src/lib/agents/prompt-executor.test.ts src/lib/agents/scheduler.test.ts
npx vitest run src/lib/agents/__tests__/prompt-runtime-contract.acceptance.test.ts
npx eslint src/lib/types.ts src/lib/department-config.ts src/lib/agents/department-capability-registry.ts src/lib/agents/department-execution-resolver.ts src/lib/agents/scheduler.ts
npx tsc --noEmit --pretty false
git diff --check
```

业务验收：

1. 触发 `AI情报工作室日报 · 每天北京时间20:00`。
2. 确认 run 中实际出现 Bash/python 工具调用。
3. 确认生成 `prepared-ai-digest-context.json`。
4. 确认生成 `digest_output.json`。
5. 确认 finalize 上报成功并可通过 digest API 回读。
