# Department Content and AI Intel Root Cause - 2026-05-21

## Scope

This note records a read-only root-cause check for two user-visible symptoms:

- Web Projects view shows department content/project empty states.
- AI intel scheduled work appears not to update visible Projects/outputs as expected.

No code, scheduler config, or project progress record was changed as part of this investigation.

## Findings

### Web department content

- The current Web frontend does not require Turai to read department content. `DepartmentContentPanel` calls `/api/departments/content`, and the control-plane handler reads local workspace files from the server filesystem.
- In split-role Web mode, `GET /api/departments` currently proxies to the control-plane server route, but the control-plane server routes all `GET /api/departments` requests to `handleDepartmentsGet(req)`. It does not branch to `handleDepartmentsListGet()` when `workspace` is missing. Current API evidence: `GET /api/departments` returns `{"error":"Missing workspace"}`.
- For `file:///Users/darrel/mytools`, `GET /api/departments/content` returns `fileTree: []` and `outputTree: []`.
- `/Users/darrel/mytools` exists and contains Markdown files, and explicit reads work: `GET /api/departments/content?workspace=file:///Users/darrel/mytools&path=content.md` returns the Markdown file.
- The empty file tree is caused by the tree-building path: `buildDepartmentFileTrees()` includes workspace root as `''`, but `resolveInsideWorkspace()` rejects an empty relative path, so the workspace root is not listed. If the workspace has no `.department/outputs`, `.department/memory`, `.department/rules`, `.agents/rules`, or configured context docs, the tree becomes empty even though regular files exist.
- `file:///Users/darrel/Documents/Antigravity-Mobility-CLI` does return department outputs, including the Linux Do AI brief in `.department/outputs/linuxdo-ai-watch/briefs/2026-05-21-0013.md`.

### AI intel scheduled work

- The local folder that carries the "AI情报工作室" department identity is `/Users/darrel/Documents/baogaoai`. Its `.department/config.json` has `name: "AI情报工作室"` and its department mission is AI intel, daily/weekly reports, and big events.
- Nearby folders have different roles: `/Users/darrel/Documents/baogao_ai_frontend` is the frontend workspace by name, and `/Users/darrel/Documents/baogao_workspace` is present but does not carry a `.department/config.json` in this check.
- The AI daily digest job exists and is enabled: `AI情报工作室日报 · 每天北京时间20:00`, job `2a1a9a76-e63d-42c6-a4f5-99fb8b89c86f`, workspace `file:///Users/darrel/Documents/baogaoai`, next run `2026-05-22T12:00:00.000Z`.
- The 2026-05-21 digest was already successfully reported by run `2ab67ca5-c2d0-42f9-a42f-ab1384f48864`: `reportedEventDate=2026-05-21`, `reportedEventCount=15`, `verificationPassed=true`.
- A later 2026-05-21 digest run `7cf16ebb-ee26-400e-90ef-56fe8dbc7e13` was blocked with `digest_already_exists`, which explains why it did not create a second successful report for the same date.
- The Linux Do AI monitoring job exists and is enabled: `AI 情报部 · Linux Do AI 漏洞监控`, job `134072d7-888c-47c1-bf13-5f4961623988`, cron `0 */2 * * *`, timezone `Europe/Rome`.
- Despite its name, that Linux Do job is currently bound to workspace `file:///Users/darrel/Documents/Antigravity-Mobility-CLI`, not to `file:///Users/darrel/Documents/baogaoai`. This is a workspace ownership mismatch if the intended product area is "AI情报工作室".
- Its visible output has not advanced past `.department/outputs/linuxdo-ai-watch/briefs/2026-05-21-0013.md`; cache `lastFetchAt` is `2026-05-20T22:13:05.490Z`.
- Recent Linux Do scheduler runs are marked completed, but the latest run `c0b7561c-a919-44c0-8a28-683ee313e827` has `changedFiles: []`, `outputArtifacts: []`, and `promptResolution` says no workflow or skill asset was matched. This indicates the scheduler triggered a prompt run but did not reliably execute `node scripts/linuxdo-ai-watch.mjs`.
- Projects UI shows "暂无项目" for the selected department because scheduled `dispatch-prompt` runs are projectless runs. They do not create records in the `projects` table. Current `/api/projects` has 4 projects, all in `file:///Users/darrel/Documents/baogaoai`, and none in `file:///Users/darrel/Documents/Antigravity-Mobility-CLI` or `file:///Users/darrel/mytools`.

## Root Cause Summary

1. Web content reading is present in this frontend; Turai is not required for reads.
2. Department list/config loading has a split-role control-plane route mismatch: aggregate `GET /api/departments` is not wired in the control-plane server.
3. `mytools` file tree is empty because workspace-root tree construction rejects the empty root path, and `mytools` has no `.department` roots/context docs to fall back to.
4. AI daily digest is scheduled and 2026-05-21 was already reported; the later blocked run is a duplicate guard, not evidence that the daily job is absent.
5. Linux Do monitoring is scheduled but is bound to the platform repository instead of the AI intel workspace, currently only produces projectless prompt runs, and recent runs did not execute the local Node script, so outputs did not refresh.
6. "暂无项目" is expected for projectless scheduled work unless the routine is changed to create or bind a Project.
