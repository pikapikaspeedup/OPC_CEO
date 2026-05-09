# Projects Run-only Flip Investigation

## 问题边界

- 只处理 `Projects` 页面中 run-only 工作区总览和 run-only 详情之间的自动切换。
- 不修改 scheduler、`projectless` 数据模型、URL 结构和持久化表。

## 根因

1. `src/app/page.tsx`
   - `loadAgentState()` 每次全局轮询都会重新计算 `selectedAgentRunId`。
   - 旧逻辑在没有显式选择时会调用 `pickDefaultAgentRun()` 自动挑一个 run。
2. `src/app/page.tsx`
   - agent state 轮询 `useEffect` 依赖 `selectedAgentRunId`。
   - 只要选中 run 变化，就会重新启动一次“立即执行”的全量刷新。
3. `src/lib/app-url-state.ts`
   - `Projects` URL 只持久化 `project`，不持久化 `run`。
   - 所以 run-only detail 不是稳定的 URL 状态，父层一旦重新走“默认选 run”逻辑，就会把总览打回详情。

## 修复策略

- 新增 `resolveSelectedAgentRunId()`：
  - 有显式 `preferredRunId` 时保留它。
  - 其次保留当前 `selectedAgentRunId`。
  - 只有允许自动选中时，才回退到 `pickDefaultAgentRun()`。
- `Projects` 区域关闭默认自动选 run：
  - `sidebarSection === 'projects'` 时，不再因为全局轮询自动跳进详情。
- 全局 agent state 轮询改为读取 `selectedAgentRunIdRef`：
  - 选中 run 变化不再重启整套全量刷新。

## 验证

- `npx vitest run src/lib/agent-run-utils.test.ts src/components/projects-panel.test.ts src/app/api/agent-runs/route.test.ts`
- `npx eslint src/app/page.tsx src/lib/agent-run-utils.ts src/lib/agent-run-utils.test.ts`
- `npx tsc --noEmit --pretty false`
- Playwright 页面验收：
  - 打开 `http://127.0.0.1:3000/?section=projects`
  - 等待 12 秒后仍停留在 run-only 总览
  - 页面包含 `当前工作区暂无 Project，以下结果未挂到项目容器。`
  - 页面不包含 `未挂到 Project 的最近执行详情`
