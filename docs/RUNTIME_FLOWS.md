# Runtime Flows

本文只记录**当前真实主链**，帮助排障和后续架构收敛。它不替代 [ARCHITECTURE.md](/Users/darrel/Documents/Antigravity-Mobility-CLI/ARCHITECTURE.md) 的全景说明，也不覆盖所有边角兼容路径。

## 1. User / Department Run

最常见入口是：

- `POST /api/agent-runs`
- `POST /api/projects/:id/resume`
- `POST /api/conversations`（轻量 chat 入口，不进入完整 project lifecycle）

主链：

1. control-plane route 接请求。
   - `src/app/api/agent-runs/route.ts`
   - `src/app/api/projects/[id]/resume/route.ts`
   - split-mode 下经 `src/server/shared/proxy.ts` 转发
2. run / project 状态进入 registry。
   - `src/lib/agents/run-registry.ts`
   - `src/lib/agents/project-registry.ts`
3. runtime 决定执行形态。
   - prompt-only: `src/lib/agents/prompt-executor.ts`
   - multi-role / stage runtime: `src/lib/agents/group-runtime.ts`
4. backend 接管 provider/session。
   - `src/lib/backends/*`
   - `src/lib/backends/run-session-hooks.ts`
   - `src/lib/agents/session-handle.ts`
5. provider 或 Claude Engine 真正执行。
   - provider-backed: `src/lib/providers/*`
   - provider-neutral engine: `src/lib/claude-engine/*`
6. supervisor / persistence / audit 收尾。
   - `src/lib/agents/supervisor.ts`
   - `src/lib/storage/gateway-db.ts`
   - `src/lib/agents/run-history.ts`
   - `src/lib/agents/ops-audit.ts`

当前事实源：

- run 主状态：`runs` + `run-history.jsonl`
- 会话句柄：`sessionProvenance.handle`
- project control-flow：`execution-journal.ts`

## 2. CEO / Self-Improvement

当前公司内核的新增主线已经是 `self-improvement-*`，不是 `growth-*`。

主链：

1. 信号进入 operating kernel。
   - `src/lib/company-kernel/operating-signal.ts`
   - `src/lib/company-kernel/operating-signal-store.ts`
   - `src/lib/company-kernel/platform-engineering-observer.ts`
2. CEO / 公司循环读取信号、agenda、proposal 视图。
   - `src/lib/company-kernel/company-loop-executor.ts`
   - `src/lib/company-kernel/ceo-decision-control.ts`
   - `src/lib/company-kernel/self-improvement-control-state.ts`
3. proposal 审批和执行。
   - `src/lib/company-kernel/self-improvement-approval.ts`
   - `src/lib/company-kernel/self-improvement-codex-execution.ts`
   - `src/lib/company-kernel/self-improvement-release-gate.ts`
4. 执行证据回写到 project / run / proposal。
   - `src/lib/company-kernel/self-improvement-runtime-state.ts`
   - `src/lib/company-kernel/self-improvement-store.ts`
   - `src/lib/company-kernel/working-checkpoint.ts`

明确边界：

- `growth-*` 只剩 legacy 兼容数据层，不再是自动化新主线。
- 新增公司自迭代能力时，优先接 `signal -> proposal -> approval -> codex execution -> release gate` 这条链。

## 3. Scheduler

当前 scheduler 负责两类事：

- 定时触发普通 agent run
- 定时触发 company loop

主链：

1. `src/server/workers/scheduler-worker.ts` 启动后台循环。
2. `src/lib/agents/scheduler.ts` 解析 cron、挑选待触发 job。
3. 根据 job 类型分流：
   - agent run：走 `run-registry` / `prompt-executor` / `group-runtime`
   - company loop：走 `company-loop-executor.ts`
4. 结果写回：
   - `scheduled_jobs` / `budget_ledger`
   - `run-history.jsonl`
   - `ops-audit`

排障先看：

- `src/lib/agents/scheduler.ts`
- `src/server/workers/scheduler-worker.ts`
- `src/lib/company-kernel/company-loop-executor.ts`

## 4. Intervene / Recover / Restart Role

这条链处理“已有 run 怎么继续”。

入口：

- `POST /api/agent-runs/:id/intervene`
- `POST /api/projects/:id/resume`

主链：

1. control-plane 判断动作类型：`recover / nudge / restart_role / cancel / skip / force-complete`
2. 通过 `src/lib/agents/session-handle.ts` 解析当前权威会话句柄。
3. 如需复用或继续执行，转到：
   - `src/lib/agents/group-runtime.ts`
   - `src/lib/backends/run-session-hooks.ts`
   - `src/lib/agents/runtime-helpers.ts`
4. 如需巡检或恢复，依赖：
   - `src/lib/agents/supervisor.ts`
   - `src/lib/agents/project-reconciler.ts`
   - `src/lib/agents/project-diagnostics.ts`

当前最重要的不变量：

- 不再把 `childConversationId` / `activeConversationId` 当权威源
- 恢复 / nudge / restart_role 都先走 `sessionProvenance.handle`

## 5. Split-Mode Request Path

默认部署是 `opc-web:3000 + opc-api:3101`。

请求主链：

1. 浏览器或 CLI 打到 `web`
2. `web` 只做页面渲染、WS ingress、必要的 HTTP 代理
3. `src/server/shared/proxy.ts` 按 control-plane / runtime 分流
4. `api` 组合服务再落到：
   - `src/server/control-plane/server.ts`
   - `src/server/runtime/server.ts`

排障重点：

- 所有 HTTP 响应都回 `x-ag-correlation-id`
- proxy 会透传同一个 correlation id
- logger 通过 `AsyncLocalStorage` 自动带上该 id

## 6. 当前不应再走的旧主线

- `growth-*` 新自动化
- 以 `childConversationId` / `activeConversationId` 作为会话权威源
- 让 `web` 进程直接当默认 SQLite 多写者
- 在 `src/app/api` 里静态直 import `@/server/*`（`shared/proxy` 除外）

如果新增功能需要重新打开这些路径，应先回到 [docs/design/architecture-review-2026-05-09.md](/Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/architecture-review-2026-05-09.md) 重新立项，而不是顺手复活兼容层。
