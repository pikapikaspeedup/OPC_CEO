# Ops Page Redesign - 2026-04-27

Scope: bring `Ops` onto the same compact shell and first-layer density already used by `CEO Office` and `Projects`, aligned to the latest reference mockup.

## Goals

- Replace the old "stacked widgets" Ops surface with a single compact operations dashboard.
- Keep the shell language aligned with `WorkspaceConceptShell`, the existing left rail, and the Projects page density.
- Prioritize first-layer answers for:
  - scheduler health and task actions
  - system runtime state
  - MCP / tunnel / quota visibility
  - asset inventory
  - recent operational activity
- Preserve deeper controls by keeping the existing advanced `SchedulerPanel`, `AssetsManager`, `AnalyticsDashboard`, and `CodexWidget` reachable below the fold instead of deleting them.

## Delivered

- Added `src/components/ops-dashboard.tsx` as the new aggregated Ops work surface.
- Replaced the old `page.tsx` Ops composition (`SchedulerPanel + Analytics + right rail widgets + AssetsManager`) with the new dashboard surface.
- Added top search for tasks / services / assets / activity in the Ops shell header.
- Rebuilt the first layer into:
  - 4 KPI cards
  - `调度任务` table with trigger / pause-resume / advanced view
  - `系统状态`
  - `MCP / 服务连接`
  - `额度与配额`
  - `Tunnel / 网络`
  - `资产管理`
  - `最近活动`
- Kept advanced behavior reachable:
  - `高级调度治理` expands the existing `SchedulerPanel`
  - `资产 Studio` expands the existing `AssetsManager`
  - `扩展工具` keeps `AnalyticsDashboard` and `CodexWidget` below the first layer
- Extended `src/components/scheduler-panel.tsx` with a small controlled `createRequestToken` entry so the top `新建任务` button can open the existing scheduler create dialog directly.

## Round 2 Closure

- Compressed KPI cards, panel headers, table headers, and empty states so the first screen reads like an ops console instead of a report page.
- Converted `系统状态`, `MCP / 服务连接`, `额度与配额`, and `Tunnel / 网络` into denser table-like surfaces with explicit columns for status, metric, and detail.
- Replaced icon-only row controls in `调度任务` with labeled actions: `立即执行 / 启用-暂停 / 调度治理`.
- Clarified the Ops header search as a scoped page filter (`本页`) instead of an implied command bar.
- Removed the three stacked second-layer appendix panels from the default flow and replaced them with a single `深层工作台` entry that switches between:
  - `调度治理`
  - `资产工作台`
  - `扩展工具`
- Localized the remaining first-layer surface strings to Chinese where they were part of product chrome rather than user asset content.

## Acceptance Evidence

- `npx eslint src/app/page.tsx src/components/ops-dashboard.tsx src/components/scheduler-panel.tsx`
- `npx tsc --noEmit --pretty false`
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts src/app/api/management/overview/route.test.ts`
  - `3 files passed`
  - `15 tests passed`
- `npm run build`
  - production build passed
  - only the existing Turbopack broad-pattern warnings remained
- Browser validation:
  - started isolated web-only `http://127.0.0.1:3999/?section=operations`
  - explicitly disabled scheduler / companions / bridge worker
  - `bb-browser` could open the page, but snapshot / eval / screenshot in this environment still returned an unusable blank `body` or stalled, so it was not reliable enough for final acceptance
  - one-shot Playwright validation on the same `:3999` page verified:
    - first-layer text modules exist: `启用中调度任务 / 待处理治理项 / 额度使用率 / 连接服务 / 调度任务 / 系统状态 / MCP / 服务连接 / 额度与配额 / Tunnel / 网络 / 资产管理 / 最近活动 / 深层工作台`
    - the scoped search marker `本页` is present in the Ops header
    - top `新建任务` opens the existing `New Scheduled Job` dialog
    - `资产工作台` expands the full asset manager and shows `可执行资产 / 当前可被任务调用`
    - old stacked appendix sections such as `高级调度治理` are no longer visible in the default first-layer dashboard
    - no bad HTTP responses
    - no console errors
    - no page errors
- Screenshots:
  - first layer: `/tmp/opc-ops-round2-top.png`
  - deep workspace pass: `/tmp/opc-ops-round2-assets.png`
