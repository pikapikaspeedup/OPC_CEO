# Projects Page TODOs - 2026-04-26

Scope: Project main page deep pass against the latest Apple reference mockup (`docs/design/mockups/apple-reference-pages-2026-04-23/projects.png`).

## TODO

- [x] Keep the unified Apple-style shell from the CEO Office pass while making Projects its own full work surface.
- [x] Remove the split ownership where `src/app/page.tsx` renders a separate right execution queue and `ProjectsPanel` renders an empty browse body.
- [x] Build a real Projects browse mode: project tree, focused execution workbench, health/owner/related run panels, and quick actions.
- [x] Keep create, AI generate, dispatch, archive, edit, delete, and project selection flows reachable from the main Project page.
- [x] Make the page responsive: three columns on wide desktop, two columns on medium, single column on mobile without overlapping text.
- [x] Preserve detail-mode functionality and avoid adding scheduler/worker side effects.
- [x] Run static checks, type checks, build, and browser visual validation after implementation.

## Acceptance Evidence

- `npx eslint src/app/page.tsx src/components/projects-panel.tsx`
- `npx tsc --noEmit --pretty false`
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` -> `2 files passed`, `13 tests passed`
- `npm run build` -> production build passed; only existing Turbopack broad-pattern warnings remained.
- `bb-browser open http://localhost:3000/?section=projects` succeeded.
- `bb-browser eval` verified Projects browse surface rendered with project tree, health panel, quick actions, and no old `风险与最近推进` queue.
- `bb-browser screenshot /tmp/opc-projects-page-bb-2.png` captured the completed browse layout.
- `bb-browser` clicked `打开详情`; detail URL became `?section=projects&project=...`, `Pipeline / Operations / Deliverables` tabs rendered, and `bb-browser errors` reported no JS errors.
- Detail screenshot: `/tmp/opc-projects-detail-bb.png`.

## Round 2 TODO - Design-Complete Pass

Scope: tighten the Project page against the current `projects.png` reference while preserving every project action and detail workflow.

- [x] Replace the large generic Projects KPI row with compact reference-style metric tiles: icon, label, value, operational detail.
- [x] Remove the extra secondary `项目执行总览` hero inside `ProjectsPanel`; the body should start directly with project tree, execution workbench, and right status rail.
- [x] Convert the project tree from oversized cards to a dense department tree with selected-row highlight, plus/create/filter affordances, progress/status metadata, and edit/archive actions.
- [x] Add a browse focus state so clicking a project row updates the center workbench instead of immediately leaving the reference-style overview; keep `打开详情` for full detail mode.
- [x] Rebuild the execution workbench to match the reference: title/status row, target summary, stage progress rail, recent run table, blockers card, and next-steps card.
- [x] Rebuild the right rail order and density to match the reference: health ring with legend, owner/participants, related runs, quick actions.
- [x] Keep all existing functions reachable: create project, AI generate, dispatch, edit, archive/restore, delete, open detail, run selection, detail tabs.
- [x] Verify responsive behavior and browser state with real project data, including no JS errors and no old external `Execution queue`.

## Round 2 Acceptance Evidence

- `npx eslint src/app/page.tsx src/components/projects-panel.tsx`
- `npx tsc --noEmit --pretty false`
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` -> `2 files passed`, `13 tests passed`
- `npm run build` -> production build passed; only existing Turbopack broad-pattern warnings remained.
- `bb-browser` on temporary web-only `http://127.0.0.1:3999/?section=projects` verified all reference modules: `进行中项目 / 阻塞项目 / 本周完成 / 待评审 / 项目树 / 执行工作台 / 阶段进度 / 最近运行 / 阻塞项 / 下一步 / 项目健康度 / 负责人 / 关联运行 / 快捷操作`.
- `bb-browser eval` verified no old `项目执行总览` secondary hero and no old external `风险与最近推进` queue.
- `bb-browser eval` verified four KPI tiles share one row at the validation viewport.
- `bb-browser eval` clicked a project row and confirmed URL stayed on `?section=projects`; then clicked `打开详情` and confirmed `?section=projects&project=...` plus `Pipeline / Operations / Deliverables`.
- `bb-browser screenshot /tmp/opc-projects-round2-final.png` captured the final browse layout.
- `bb-browser errors` reported no JS errors.

## Round 3 TODO - Reference Density Pass

Scope: close the remaining visible gaps against `projects.png` while keeping the functional Project workbench intact.

- [x] Make the Projects page header compact like the reference: `Projects` + `项目总览` on one line instead of a large hero-style title.
- [x] Add a real top search field wired to the project tree search state; typing in either search field must keep both in sync.
- [x] Add a top `新建项目` primary action wired to the existing create-project dialog; keep department setup and Ops navigation reachable elsewhere.
- [x] Restyle the four KPI cards as compact white reference tiles with left icons, smaller values, tighter height, and restrained tone color.
- [x] Tighten the main work surface: smaller gaps, lower card radius, and less padded outer cards so more of the project tree/workbench/right rail is visible above the fold.
- [x] Keep project browse actions reachable: create, AI generate, dispatch/new run, edit, archive/restore, delete, row focus, open detail, run selection, detail tabs.
- [x] Verify with real data that the compact header, synced search, top create action, no old hero/queue, detail navigation, and no JS errors all hold.

## Round 3 Acceptance Evidence

- `npx eslint src/app/page.tsx src/components/projects-panel.tsx src/components/workspace-concept-shell.tsx`
- `npx tsc --noEmit --pretty false`
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` -> `2 files passed`, `13 tests passed`
- `npm run build` -> production build passed; only existing Turbopack broad-pattern warnings remained.
- Temporary web-only `http://127.0.0.1:3999/?section=projects` was restarted after build with scheduler / companions / bridge worker disabled and proxied to the existing `:3101` API.
- Browser validation first used `bb-browser`; `open` and early DOM checks worked, but the daemon later timed out on refreshed/screenshot tabs, so final screenshot and interaction assertions used the repo's Playwright dependency as fallback.
- Final browser assertions verified:
  - compact header has `Projects` + `项目总览`, no old `项目、部门与执行链路的公司工作面。`
  - top search exists and syncs with tree search: `baogaoai` -> `1 visible / 67 total`
  - top `新建项目` opens the existing create-project dialog
  - project detail opens `?section=projects&project=...` and shows `结果概览` / `OUTPUT EVIDENCE`
  - no bad HTTP responses and no console/page errors during final run; the only request failure was the expected aborted SSE `/api/approval/events` when closing the browser
- Screenshot: `/tmp/opc-projects-round3-final.png`

## Round 4 TODO - Visual Polish Pass

Scope: finish the remaining reference-level polish without removing operational controls.

- [x] Remove the extra top `部门设置` action so the header matches the reference action cluster: search + primary `新建项目`.
- [x] Keep department setup reachable by moving it into the setup banner and Projects quick actions.
- [x] Slim the setup incomplete banner into a lower-height reference-style notice.
- [x] Rebuild the right health card as ring + legend values instead of ring + stacked progress bars.
- [x] Improve sparse project stage data by rendering a five-step visual rail while preserving real stage/run state.
- [x] Verify header actions, setup access, health card, five-step stage rail, top create, detail navigation, and no console errors with real data.

## Round 4 Acceptance Evidence

- `npx eslint src/app/page.tsx src/components/projects-panel.tsx src/components/workspace-concept-shell.tsx`
- `npx tsc --noEmit --pretty false`
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` -> `2 files passed`, `13 tests passed`
- `npm run build` -> production build passed; only existing Turbopack broad-pattern warnings remained.
- Temporary web-only `http://127.0.0.1:3999/?section=projects` was started with scheduler / companions / bridge worker disabled and proxied to the existing `:3101` API.
- `bb-browser` validation:
  - opened Projects and verified top `部门设置` is no longer in the header before the KPI row
  - verified setup access remains via the slim banner and quick actions
  - verified right health card contains ring legend values `进度 / 质量 / 风险 / 资源`
  - saved screenshot `/tmp/opc-projects-round4-final.png`
  - `bb-browser errors` / `console` reported no JS errors at the validation point
- Final interaction assertions used a clean one-shot Playwright browser because the long-lived `bb-browser` profile had stale old `:3999` tabs mixed with the new page. Assertions verified:
  - top search and top `新建项目` exist, with no top `部门设置`
  - top `新建项目` opens the existing create-project dialog
  - quick actions include `部门设置`
  - sparse real project stage data renders a five-step rail: `目标确认 / Coding Worker / 结果验证 / 交付归档 / 复盘优化`
  - `打开详情` navigates to `?section=projects&project=...` and shows detail content
  - no bad HTTP responses and no console/page errors; only the expected aborted SSE `/api/approval/events` appeared when closing the browser
- Final screenshot: `/tmp/opc-projects-round4-final-playwright.png`

## Round 5 TODO - Default Surface Convergence

Scope: fix the remaining "large unfinished" gaps by making the default Projects surface show representative business work instead of raw noisy data, while preserving every existing project action.

- [x] Keep the compact header and top create/search actions, but remove the old header setup status chip that made the page read unlike the reference.
- [x] Restyle KPI tiles so the label/value/detail stack reads closer to the reference instead of one compressed inline row.
- [x] Re-rank the project tree to prefer representative department projects; push noisy `test` / `auto-trigger` style items out of the default first viewport without removing search access.
- [x] Make the default workbench focus follow the visible project tree instead of selecting a hidden off-tree project.
- [x] Remove the old All/Active/Attention/Done chip row so the left tree matches the reference density more closely.
- [x] Replace the workbench header ellipsis edit shortcut with a real action menu and keep edit / new run / archive / delete reachable.
- [x] Verify with real data that the default tree no longer starts on noisy test focus, top search/create remain, quick actions remain, completed summary remains, and no JS/runtime errors appear.

## Round 5 Acceptance Evidence

- `npx eslint src/app/page.tsx src/components/projects-panel.tsx src/components/workspace-concept-shell.tsx`
- `npx tsc --noEmit --pretty false`
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` -> `2 files passed`, `13 tests passed`
- `npm run build` -> production build passed; only existing Turbopack broad-pattern warnings remained.
- Temporary web-only `http://127.0.0.1:3999/?section=projects` was started with scheduler / companions / bridge worker disabled and proxied to the existing `:3101` API.
- `bb-browser` was used first for local validation. It could open `:3999`, but its long-lived daemon profile mixed stale historical `:3999` tabs with the new build, so the captured tab state was not trustworthy for final acceptance.
- Final one-shot Playwright assertions on the rebuilt `:3999` surface verified:
  - top header still has search + `新建项目`, with no old `Setup incomplete` / `Departments ready` chip
  - default tree sections surface representative workspaces like `WorkSatation / AI情报工作室 / 线索跟踪部门 / Openmind` instead of defaulting to `backend/test`
  - default workbench focus follows the visible tree and no longer lands on hidden noisy `test` / `Auto-Trigger` projects
  - completed-project summary, quick actions, project health, and detail navigation remain reachable
  - no bad HTTP responses and no console/page errors; the only ignored transient failure class remained the expected SSE `/api/approval/events` shutdown abort
- Screenshots:
  - `bb-browser`: `/tmp/opc-projects-round5-bb-real.png` (captured stale-profile issue)
  - final acceptance: `/tmp/opc-projects-round5-playwright-final.png`

## Round 6 TODO - Review Regression Fixes

Scope: fix the concrete business regressions found in review instead of continuing visual-only polish.

- [x] Restore the completed/archive browse path so historical projects can be reached from the Projects page again.
- [x] Include cancelled projects in the same closed-project browse path instead of silently dropping them.
- [x] Restore a visible `进行中` filter entry without bringing back the full old chip row.
- [x] Add a discoverable entry for workspace sections beyond the first four so whole departments do not disappear from navigation.
- [x] Reconnect browse-mode run clicks to a visible drilldown flow: clicking a run should open the target project detail and focus the matching run/stage content.

## Round 6 Acceptance Evidence

- `npx eslint src/app/page.tsx src/components/projects-panel.tsx src/components/project-workbench.tsx src/components/workspace-concept-shell.tsx`
- `npx tsc --noEmit --pretty false`
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` -> `2 files passed`, `13 tests passed`
- `npm run build` -> production build passed; only existing Turbopack broad-pattern warnings remained.
- Temporary web-only `http://127.0.0.1:3999/?section=projects` was started with scheduler / companions / bridge worker disabled and proxied to the existing `:3101` API.
- `bb-browser` was used first again, but its daemon still resolved the new `:3999` session against a stale long-lived tab set, so its page state was not reliable enough for final regression acceptance.
- Final one-shot Playwright assertions verified:
  - filter menu now exposes `全部项目 / 进行中 / 关注项 / 历史项目`
  - `历史项目` renders closed sections like `Completed / Archived / Cancelled`
  - the tree exposes `查看其余 N 个部门` and toggles to `收起其他部门`
  - searching `baogaoai` then clicking a browse-mode run opens `?section=projects&project=...` and lands in the target project detail with selected run content visible
  - no bad HTTP responses and no console/page errors
- Screenshots:
  - browse regression check: `/tmp/opc-projects-review-fixes-final.png`
  - run drilldown detail: `/tmp/opc-projects-run-drilldown-fix.png`

## Round 7 TODO - Project Run Evidence Recovery

Scope: restore real run evidence for historical Projects without expanding the global `agentRuns` pagination window.

- [x] Stop using the global paginated `agentRuns` list as the only source for focused historical projects.
- [x] Reuse project-scoped runs in browse mode so `最近运行 / 关联运行 / 健康度 / 最近活动时间` can see historical project runs again.
- [x] Feed the same scoped run set into detail-mode `ProjectWorkbench` so Pipeline detail regains run-backed summaries and branch evidence.
- [x] Verify against a known project whose run exists in `/api/agent-runs?projectId=...` but not in the global `/api/agent-runs?pageSize=100` response.

## Round 7 Acceptance Evidence

- `npx eslint src/components/projects-panel.tsx src/app/page.tsx src/components/project-workbench.tsx src/components/workspace-concept-shell.tsx`
- `npx tsc --noEmit --pretty false`
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` -> `2 files passed`, `13 tests passed`
- `npm run build` -> production build passed; only existing Turbopack broad-pattern warnings remained.
- Data proof on existing `:3000` API:
  - root project `19885e25-248b-4e17-ae37-2653b4018598` has scoped run `857995d5-a1bf-4067-84bf-deae5f91707d`
  - that run is absent from the global `/api/agent-runs?pageSize=100` result
  - therefore the missing UI evidence was a frontend source-selection bug, not missing backend data
- `bb-browser` was attempted first, but its current long-lived session remained attached to an unrelated external `eastmoney` page, so the local Projects state could not be trusted for acceptance.
- Final one-shot Playwright validation on existing `http://127.0.0.1:3000` verified:
  - project detail restores `最近执行 / 结果概览 / output evidence / 关注项`
  - root project detail restores `Batch Planner / Research Fan-Out / Branches / Research Join`
- Screenshots:
  - `/tmp/opc-projects-root-detail-evidence.png`
  - `/tmp/opc-projects-detail-run-evidence.png`

## Round 8 TODO - Flatten Project Detail for Fan-Out Workflows

Scope: reduce the extra click depth in Projects detail so the first detail screen already behaves like an execution workspace instead of a summary page.

- [x] Move the execution workbench into the first detail layer so entering a project no longer requires another stage click before any real stage detail appears.
- [x] Add a first-layer `关联项目` rail for fan-out roots so the overview and child projects live in the same screen instead of behind another tab-like layer.
- [x] Default the workbench to list mode for fan-out projects so branches and stage details are visible immediately.
- [x] Auto-focus the first meaningful stage on entry and prefer the fan-out stage when the project contains branches / child projects.
- [x] Ignore unrelated global run selection state when opening a project detail so a stray page-level run id cannot blank out the first-layer detail panel.
- [x] Keep branch navigation, prompt/run detail, and stage selection sticky so the richer first layer does not collapse back to an empty summary surface.

## Round 8 Acceptance Evidence

- `npx eslint src/components/projects-panel.tsx src/components/project-workbench.tsx src/app/page.tsx src/components/workspace-concept-shell.tsx`
- `npx tsc --noEmit --pretty false`
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` -> `2 files passed`, `13 tests passed`
- `npm run build` -> production build passed; only existing Turbopack broad-pattern warnings remained.
- Temporary web-only `http://127.0.0.1:3999/?section=projects&project=19885e25-248b-4e17-ae37-2653b4018598` was started with scheduler / companions / bridge worker disabled and proxied to the existing `:3101` API.
- `bb-browser` was used first for DOM-level validation. Its snapshot confirmed the same first-layer screen now contains:
  - `Fan-Out 项目直接放在第一层`
  - `Research Fan-Out stage`
  - `Stage Details`

## Round 10 TODO - Production Truth Pass

Scope: remove misleading synthetic data from the Projects browse surface and finish the remaining browse-mode logic gaps so the page only shows real execution state.

- [x] Reconnect run drilldown so browse-mode run clicks can carry the target `projectId` instead of depending only on the global first-page `agentRuns` cache.
- [x] Keep a fallback `api.agentRun(runId)` lookup at the page layer so historical runs still resolve the correct project detail when the cache misses.
- [x] Tighten the `进行中` filter semantics to real `active` projects only; stop mixing `failed` and `paused` into the active view.
- [x] Make `查看其余 N 个部门` reveal the full `openTreeSections` set instead of another prioritized subset.
- [x] Clear stale browse focus when search/filter changes hide the previously focused project, so tree and center workbench stay in sync.
- [x] Stop fabricating the five-step lifecycle rail; when there is no observed pipeline state, show an honest empty state that says the template is bound but runtime stages do not exist yet.
- [x] Replace the heuristic `项目健康度` ring with a truthful `执行概览` card backed only by real project status, stage counts, run counts, child-project counts, and latest execution projection.
- [x] Replace the synthetic `负责人` persona card with a real `执行工作区` card backed by actual workspace binding and department config counts.
- [x] Remove `fallback refs` from the visible department context summary; keep only real config counts (`skills / workflow-bound / templates / provider`).
- [x] Restore archived projects to an inferred real runtime status (`completed / failed / paused / cancelled / active`) instead of always forcing `active`.

## Round 10 Acceptance Evidence

- `npx eslint src/app/page.tsx src/components/projects-panel.tsx`
- `npx tsc --noEmit --pretty false`
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` -> `2 files passed`, `13 tests passed`
- `npm run build` -> production build passed; only existing Turbopack broad-pattern warnings remained.
- `git diff --check`
- In-app browser verification on existing `http://127.0.0.1:3000` confirmed:
  - `执行概览` and `执行工作区` exist on the right rail
  - old `项目健康度` and `负责人` panels are gone
  - `fallback refs` no longer appears in Projects
  - `项目树` and `执行工作台` still render on the same browse surface
- Screenshot:
  - `/tmp/opc-projects-production-truthful.png`
  - `Open sub-project`
- Final one-shot Playwright assertions on the rebuilt `:3999` surface verified:
  - `Research Fan-Out stage` is selected by default for the batch-research root project
  - the first detail screen already shows `Stage Details`
  - the branch block and child-project actions remain visible in the same workspace
  - no bad HTTP responses and no console/page errors
- Screenshot:
  - `/tmp/opc-projects-round8-final.png`

## Round 9 TODO - Reduce Visual Redundancy in Project Detail

Scope: keep the new first-layer Project detail structure, but remove duplicated signals and make the fan-out detail pane carry the real work instead of metadata-only cards.

- [x] Compress the top detail summary from four standalone cards into one compact strip so the execution surface moves higher in the viewport.
- [x] Turn the `关联项目` rail into a compact focus strip instead of repeating full child-project mini cards with duplicated goal/time text.
- [x] Move the selected fan-out branch list out of the left stage navigator and into the right detail pane so the first layer reads as navigation on the left, work content on the right.
- [x] Upgrade the selected fan-out detail pane into a branch workbench with branch totals, durations, run ids, and direct child-project entry actions.
- [x] Reduce mode burden by folding the `列表 / 拓扑` toggle into the stage header instead of giving it an extra standalone row.
- [x] Normalize the Project workbench language to Chinese for tabs, stage states, branch actions, and detail labels in the main Projects surface.

## Round 9 Acceptance Evidence

- `npx eslint src/components/projects-panel.tsx src/components/project-workbench.tsx src/components/pipeline-stage-card.tsx src/components/stage-detail-panel.tsx src/app/page.tsx src/components/workspace-concept-shell.tsx`
- `npx tsc --noEmit --pretty false`
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` -> `2 files passed`, `13 tests passed`
- `npm run build` -> production build passed; only existing Turbopack broad-pattern warnings remained.
- Temporary web-only `http://127.0.0.1:3999/?section=projects&project=19885e25-248b-4e17-ae37-2653b4018598` was started with scheduler / companions / bridge worker disabled and proxied to the existing `:3101` API.
- `bb-browser` was used first again, but in the current environment its snapshot only returned an incomplete `body` skeleton for this local tab, so it could not serve as final acceptance evidence for the optimized layout.
- Final one-shot Playwright assertions on the rebuilt `:3999` surface verified:
  - `Research Fan-Out stage` remains selected by default
  - the first detail screen contains compact `结果摘要 / 交付产物 / 关注项` summary strip
  - the compact `关联项目` strip contains `主项目`
  - the right pane now contains `分支工作面` and `打开子项目`
  - the main workbench tabs and mode toggle now read `执行流 / 运行 / 交付` and `列表 / 拓扑`
  - no bad HTTP responses and no console/page errors
- Screenshot:
  - `/tmp/opc-projects-round9-optimized.png`
