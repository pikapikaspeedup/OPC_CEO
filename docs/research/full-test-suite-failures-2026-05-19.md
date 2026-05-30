# Full Test Suite Failure Review - 2026-05-19

## Context

During the MAGI spiral pass for provider-neutral conversation split-runtime hardening, a full suite run was used as the next review step:

```bash
npm run test
```

The run completed with:

- 10 failed test files
- 43 failed tests
- 165 passed test files
- 1597 passed tests

Failure groups closed in subsequent MAGI passes:

- `src/app/api/provider-model-catalog/route.test.ts` and `src/app/api/provider-image-generation/route.test.ts` had stale `@/server/shared/proxy` mocks missing `runControlPlaneRoute`.
- `src/lib/app-url-state.test.ts` had stale expectations that did not include the already-landed `decisionTarget` URL state field.
- `src/lib/claude-engine/engine/__tests__/engine.test.ts` and `engine-memory.test.ts` mocked the removed `../../api/client.streamQuery` seam. They now mock the real `../../api/pi-transport.streamQueryViaPi` seam while preserving `streamQueryWithRetry` coverage.
- `src/lib/knowledge/__tests__/retrieval.test.ts` and `src/lib/evolution/__tests__/generator.test.ts` used fixed 2026-04-19 freshness fixtures that crossed the 30-day active/repeated-run window on 2026-05-19. They now use recent relative timestamps for active fixtures while preserving fixed old dates for stale coverage.
- `src/lib/approval/__tests__/notification-events.test.ts` built a webhook HMAC approval request fixture without the required `target`. The webhook path legitimately failed while generating the approval inbox URL because `encodeDecisionTarget` received `undefined`; the fixture now includes the knowledge decision target.
- `src/app/api/departments/route.test.ts` was sensitive to split control-plane environment variables and first-use dynamic import cost. The test now mocks `runControlPlaneRoute` like adjacent route tests and preloads the departments control-plane handler at collection time so per-test timeout does not include the heavy first import.
- `src/lib/platform-engineering-codex-runner.test.ts` snapshot-base coverage is a real git snapshot/worktree integration test. It passes alone, but the snapshot test now has an explicit 20s timeout budget so full-suite load does not fail it against the default unit-test timeout.

Targeted verification after those fixes passed:

```bash
npx vitest run src/app/api/conversations/route.test.ts 'src/app/api/conversations/[id]/send/route.test.ts' 'src/app/api/conversations/[id]/steps/route.test.ts' 'src/app/api/conversations/[id]/cancel/route.test.ts' 'src/app/api/conversations/[id]/revert/route.test.ts' 'src/app/api/conversations/[id]/files/route.test.ts' 'src/app/api/conversations/[id]/proceed/route.test.ts' 'src/app/api/conversations/[id]/revert-preview/route.test.ts' src/lib/storage/gateway-db.test.ts src/lib/ceo-conversation-selection.test.ts src/server/runtime/server.test.ts src/app/api/provider-model-catalog/route.test.ts src/app/api/provider-image-generation/route.test.ts src/lib/app-url-state.test.ts
```

Result: 14 test files, 50 tests passed.

Claude Engine verification after the mock-boundary fix:

```bash
npx vitest run src/lib/claude-engine/engine/__tests__/engine.test.ts src/lib/claude-engine/engine/__tests__/engine-memory.test.ts src/lib/claude-engine/api/__tests__/pi-transport-routing.test.ts src/lib/claude-engine/api/__tests__/provider-fallback.test.ts src/lib/claude-engine/engine/__tests__/compactor.test.ts
```

Result: 5 test files, 74 tests passed.

Knowledge and evolution verification after the freshness fixture fix:

```bash
npx vitest run src/lib/knowledge/__tests__/retrieval.test.ts src/lib/evolution/__tests__/generator.test.ts
```

Result: 2 test files, 5 tests passed.

```bash
npx vitest run src/lib/knowledge/__tests__/retrieval.test.ts src/lib/knowledge/__tests__/store.test.ts src/lib/evolution/__tests__/generator.test.ts src/lib/evolution/__tests__/publisher.test.ts src/lib/evolution/__tests__/evaluator.test.ts
```

Result: 5 test files, 13 tests passed.

Approval webhook verification after the fixture fix:

```bash
npx vitest run src/lib/approval/__tests__/notification-events.test.ts src/lib/approval/__tests__/handler.test.ts src/lib/approval/__tests__/request-store.test.ts
```

Result: 3 test files, 9 tests passed.

Departments route verification after the proxy isolation and preload fix:

```bash
AG_ROLE=web AG_CONTROL_PLANE_URL=http://127.0.0.1:3101 npx vitest run src/app/api/departments/route.test.ts --reporter verbose
```

Result: 1 test file, 4 tests passed.

```bash
npx vitest run src/app/api/departments/route.test.ts src/app/api/departments/rules/route.test.ts
```

Result: 2 test files, 9 tests passed.

Platform engineering Codex runner verification after the timeout budget fix:

```bash
npx vitest run src/lib/platform-engineering-codex-runner.test.ts --reporter verbose
```

Result: 1 test file, 5 tests passed.

## Full Suite Rerun After Rounds 1-7

After the originally tracked groups were closed, the suite was rerun:

```bash
npm run test
```

The run completed with:

- 7 failed test files
- 9 failed tests
- 168 passed test files
- 1631 passed tests

Confirmed closed from the original failure list:

- `src/lib/knowledge/__tests__/retrieval.test.ts`
- `src/lib/evolution/__tests__/generator.test.ts`
- `src/lib/approval/__tests__/notification-events.test.ts`
- `src/app/api/departments/route.test.ts`
- `src/lib/platform-engineering-codex-runner.test.ts`
- `src/lib/claude-engine/engine/__tests__/engine.test.ts`
- `src/lib/claude-engine/engine/__tests__/engine-memory.test.ts`
- `src/app/api/provider-model-catalog/route.test.ts`
- `src/app/api/provider-image-generation/route.test.ts`
- `src/lib/app-url-state.test.ts`

## Remaining Failure Groups

New failure groups from the rerun:

1. `src/lib/agents/scheduler-company-loop.test.ts` (closed in MAGI Round 9)
   - `normalizes and triggers company-loop jobs without dispatch worker calls` timed out at 5s.
   - `installs built-in daily and weekly loop jobs only when scheduler initializes` expected no daily loop before initialization, but one was already present.
   - Resolution: the first test is a real company-loop integration path and now has an explicit 20s timeout budget; targeted scheduler verification passes, and the second failure is treated as timeout spillover from the first test continuing after Vitest marked it failed.
   - Verification: `npx vitest run src/lib/agents/scheduler.test.ts src/lib/agents/scheduler-company-loop.test.ts` passed with 2 files and 24 tests.

2. `src/lib/company-kernel/company-loop.test.ts` (closed in MAGI Round 10)
   - `creates default policy and persists loop runs with digests` timed out at 5s.
   - `writes skipped ledger when budget blocks loop dispatch` timed out at 5s.
   - Resolution: the notification test now stubs `fetch` instead of queueing real webhook/email requests, and both real `runCompanyLoop` integration assertions have explicit 20s timeout budgets.
   - Verification: `npx vitest run src/lib/company-kernel/company-loop.test.ts src/lib/company-kernel/company-loop-notification-targets.test.ts src/lib/agents/scheduler-company-loop.test.ts` passed with 3 files and 11 tests.

3. `src/app/api/company/loops-self-improvement.route.test.ts` (closed in MAGI Round 13)
   - `proxies loop API from web role to control-plane` timed out at 5s.
   - Resolution: the route test now mocks `@/server/shared/proxy`, defaults local loop/self-improvement handler coverage to `AG_ROLE=api`, and switches to `web` only for the explicit proxy assertion. This prevents inherited split-role env from putting local store setup in read-only mode or sending real requests to `127.0.0.1:3101`.
   - Verification: `AG_ROLE=web AG_CONTROL_PLANE_URL=http://127.0.0.1:3101 npx vitest run src/app/api/company/loops-self-improvement.route.test.ts --reporter verbose` passed with 1 file and 3 tests.

4. `src/app/api/models/route.test.ts` (closed in MAGI Round 11)
   - `falls back to provider-aware models when no Antigravity model service is available` timed out at 5s.
   - Resolution: the route test now mocks `runRuntimeRoute` and preloads `@/server/runtime/routes/user`, so split web/runtime env state and first dynamic import cost are isolated from the assertion.
   - Verification: `AG_ROLE=web AG_RUNTIME_URL=http://127.0.0.1:3101 npx vitest run src/app/api/models/route.test.ts --reporter verbose` passed with 1 file and 1 test.

5. `src/app/api/company/memory-candidates/route.test.ts` (closed in MAGI Round 12)
   - `lists and reads memory candidates with pagination` timed out at 5s.
   - Resolution: the route test now mocks `@/server/shared/proxy`, defaults each local handler case to `AG_ROLE=api`, and only switches to `web` inside the explicit proxy assertion. This prevents full-suite web/control-plane env state from forcing local store setup into read-only mode while preserving URL-level proxy coverage.
   - Verification: `AG_ROLE=web AG_CONTROL_PLANE_URL=http://127.0.0.1:3101 npx vitest run src/app/api/company/memory-candidates/route.test.ts --reporter verbose` passed with 1 file and 4 tests.

6. `src/components/chat-scroll-anchor.test.ts` (closed in MAGI Round 14)
   - `round-trips a scroll position keyed by conversation id` timed out at 5s.
   - Resolution: the scroll-anchor storage helpers now live in `src/components/chat-scroll-anchor.ts`, and the test imports that pure helper directly instead of dynamically importing the full `chat.tsx` component tree.
   - Verification: `npx vitest run src/components/chat-scroll-anchor.test.ts --reporter verbose` passed with 1 file and 5 tests; the first assertion completed in 1ms.

7. `src/lib/company-kernel/self-improvement.test.ts` (closed in MAGI Round 15)
   - `keeps high-risk proposals approval-gated even when tests pass` timed out at 5s.
   - Resolution: the kernel test now mocks `../approval/handler.submitApprovalRequestSync` to create approval request records without scheduling notification dispatch, because this file verifies proposal gate state rather than notification delivery. The high-risk approval-gate assertion also has an explicit 15s integration-test budget.
   - Verification: `npx vitest run src/lib/company-kernel/self-improvement.test.ts src/lib/company-kernel/self-improvement-control-state.test.ts src/lib/company-kernel/self-improvement-release-gate.test.ts src/lib/company-kernel/self-improvement-runtime-state.test.ts --reporter verbose` passed with 4 files and 27 tests.

## Suggested Next MAGI Cycle

## Full Suite Rerun After Rounds 9-15

After all tracked failure groups from the previous rerun were closed, the suite was rerun:

```bash
npm run test
```

The run completed successfully:

- 175 passed test files
- 1640 passed tests
- 0 failed test files
- 0 failed tests
- Duration: 36.31s

The previously tracked failure groups stayed closed under full-suite load:

- `src/lib/agents/scheduler-company-loop.test.ts`
- `src/lib/company-kernel/company-loop.test.ts`
- `src/app/api/company/loops-self-improvement.route.test.ts`
- `src/app/api/models/route.test.ts`
- `src/app/api/company/memory-candidates/route.test.ts`
- `src/components/chat-scroll-anchor.test.ts`
- `src/lib/company-kernel/self-improvement.test.ts`

## Suggested Next MAGI Cycle

Use the successful full-suite baseline to target slow-suite ergonomics rather than failure triage. The slowest observed groups were `self-improvement-release-gate`, `operating-kernel`, `department-memory-bridge`, `platform-engineering-codex-runner`, and `self-improvement`.

## Focused Company Route Regression After Rounds 17-19

After additional split-role hardening for `run-capsules`, `operating-kernel`, and `ceo/decisions`, the hardened route cluster was rerun under an inherited web/control-plane environment:

```bash
AG_ROLE=web AG_CONTROL_PLANE_URL=http://127.0.0.1:3101 npx vitest run src/app/api/company/ceo/decisions/route.test.ts src/app/api/company/memory-candidates/route.test.ts src/app/api/company/loops-self-improvement.route.test.ts src/app/api/company/run-capsules/route.test.ts src/app/api/company/operating-kernel.route.test.ts src/server/control-plane/server.test.ts --reporter verbose
```

Result: 6 test files, 18 tests passed.

Static closure also passed:

```bash
npx tsc --noEmit --pretty false
git diff --check
```
