# Projects Run-only Results

## 本轮边界

- 改什么：
  - `GET /api/agent-runs` 支持 `workspace` 与 `projectless=true` 过滤。
  - `Projects` 为无 `projectId` 的 run 增加工作区级“最近运行结果”可见性。
  - 点击 run-only 结果时直接进入 `AgentRunDetail`，不伪造 `Project`。
- 不改什么：
  - 不自动创建 synthetic project。
  - 不改 `runs/projects` 表结构，不做迁移。
  - 不改 scheduler 建模与 run 创建主链。

## 实现摘要

- 后端：
  - `RunRecordFilter` 增加 `workspace`、`projectless`。
  - `/api/agent-runs` 新增对应 query 参数。
- 前端：
  - `api.agentRunsByFilter` / `agentRunsByFilterAll` 同步透传 `workspace`、`projectless`。
  - `ProjectsPanel` 为每个工作区分组统计 run-only 数量。
  - 工作区无项目但有 run-only 结果时，右侧主视图改为“最近运行结果”总览。
  - 选中无项目 run 时，直接渲染 `AgentRunDetail`。
- 测试：
  - API 过滤测试覆盖 `workspace + projectless=true`。
  - 组件测试覆盖 run-only 工作区总览与 run-only 详情态。

## 验证证据

- `npx vitest run src/app/api/agent-runs/route.test.ts src/components/projects-panel.test.ts`
- `npx eslint src/app/api/agent-runs/route.ts src/app/api/agent-runs/route.test.ts src/lib/storage/gateway-db.ts src/lib/api.ts src/components/projects-panel.tsx src/components/projects-panel.test.ts`
- `npx tsc --noEmit --pretty false`
- 页面验收：
  - `baogaoai` 在 `Projects` 左树显示 `16 结果`，并能看到 run-only 列表项。
  - 默认选中的 run-only detail 可展示 `未挂到 Project 的最近执行详情` 与日报结果。
  - `platform-engineering` 在 `Projects` 左树显示 `1 结果`，点击后可进入工作区级 run-only 总览，并看到 `diagnostic-summary.md` 所在结果摘要。
