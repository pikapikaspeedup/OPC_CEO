# Phase 1 文件级开发任务清单

日期：2026-04-10
状态：执行中

## 目标

按现行 authoritative baseline，落地 Claude Code 接入的 Phase 1 最小闭环：单角色 coding stage 可以通过新的 claude-code provider 跑通，并正确写回 provider provenance 与 terminal result。

## 文件级任务

### 1. Provider 与配置层

1. `src/lib/providers/types.ts`
  - 新增 `ProviderId = 'claude-code'`
2. `src/lib/providers/index.ts`
  - 在 `getExecutor()` 中注册 ClaudeCodeExecutor
3. `src/lib/providers/ai-config.ts`
  - 允许 provider 解析到 `claude-code`
4. `src/lib/types.ts`
  - 扩展 DepartmentConfig.provider 联合类型

### 2. Provider / Bridge / Backend

1. `src/lib/bridge/claude-code-adapter.ts`
  - 新增最小 adapter
2. `src/lib/providers/claude-code-executor.ts`
  - 新增 TaskExecutor 实现
3. `src/lib/backends/builtin-backends.ts` 或独立 backend 文件
  - 新增 ClaudeCodeAgentBackend
4. `src/lib/backends/index.ts`
  - 导出或注册新 backend

### 3. Run Provenance 写回

1. `src/lib/agents/group-types.ts`
  - 新增 `providerId`、`providerSource`、`externalHandle`
2. `src/lib/agents/run-registry.ts`
  - 确保持久化 round-trip
3. `src/lib/backends/run-session-hooks.ts`
  - `started` 时为 Claude Code 写 `externalHandle`

### 4. 最小触发链

1. `src/app/api/agent-runs/route.ts`
2. `src/lib/agents/dispatch-service.ts`
3. `src/lib/agents/group-runtime.ts`

目标：不增加 Claude transport 特判，只复用现有 `resolveProvider()` + `getAgentBackend()` 主链。

### 5. 测试

1. `src/lib/providers/providers.test.ts`
2. `src/lib/providers/ai-config.test.ts`
3. `src/lib/backends/builtin-backends.test.ts` 或新增专项测试
4. `src/lib/agents/run-registry.test.ts`
5. `src/lib/agents/group-runtime.test.ts`

## 执行顺序

1. 先补 provider 类型与路由
2. 再补 Claude adapter / executor / backend
3. 再补 run provenance 写回
4. 最后补测试并统一回归