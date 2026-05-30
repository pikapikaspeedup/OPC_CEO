# AI Digest Knowledge Retrieval Pollution Investigation

Date: 2026-05-22

## Background

The AI digest scheduler job `2a1a9a76-e63d-42c6-a4f5-99fb8b89c86f` was manually triggered after syncing the live `/ai_digest` workflow asset into:

`/Users/darrel/.gemini/antigravity/gateway/assets/workflows/ai_digest.md`

The new run was:

`59cc1737-7eb4-4ec7-a3d1-995b4d56f50d`

This run did not fail with the previous `digest_output.json` missing error. Instead, it became `blocked` with:

`AI 日报未上报：digest_already_exists_for_2026-04-25`

The `2026-04-25` date is not the current digest date and is not produced by the scheduler or `fetch_context.py`.

## Current Findings

The scheduler action only dispatches:

- prompt: `生成今天的AI日报并上报`
- workflowRef: `/ai_digest`
- skillHints: `reporting`, `baogaoai-ai-digest-generator`

It does not provide `2026-04-25`.

The run `59cc1737-7eb4-4ec7-a3d1-995b4d56f50d` was created at `2026-05-22T20:10:14.678Z`, which is `2026-05-23 04:10:14` in Asia/Shanghai. If the workflow command had run normally:

```bash
TZ=Asia/Shanghai date +%Y-%m-%d
```

the date would have been `2026-05-23`, not `2026-04-25`.

The run's composed prompt did not contain a prepared daily digest context or an absolute target date anchor. It did contain a `## Retrieved Knowledge` section.

That section included the active knowledge asset:

`2297bb78-6488-4588-aa44-ea0ad9710fc1-pattern-16bfe2a477`

The asset content says:

`AI 日报已上报成功：2026-04-25，标题《DeepSeek-V4开源、Claude回退与5000万美元融资：4月25日AI应用开始同时重写入口、资本和内容生产》，来源文章 6 篇。`

The agent then wrote a synthetic `prepared-ai-digest-context.json` containing:

```json
{
  "status": "skip",
  "skipReason": "digest_already_exists_for_2026-04-25",
  "targetDate": "2026-04-25",
  "warnings": [
    "Network fetch unavailable in current runtime; inferred existing digest from prior successful run 2297bb78."
  ]
}
```

This proves the date pollution came from Retrieved Knowledge, not from the scheduler or the date script.

## Intended Roles

Historical daily digests are valid context for `/ai_digest`, but their intended role is content de-duplication:

- avoid repeating deep-dive topics from recent days
- compare new articles against recent digest themes
- identify incremental updates

That context should come from the digest workflow's business context, specifically `fetch_context.py` returning `recentDigests` inside `prepared-ai-digest-context.json`.

It should not come from generic `Retrieved Knowledge`.

Generic Knowledge should represent stable or explicitly promoted organizational knowledge, such as:

- decisions
- durable patterns
- domain knowledge
- evolution-produced SOPs or workflow proposals
- CEO/manual/system-approved knowledge

Historical run summaries are runtime records. They can become memory candidates or audit evidence, but they should not automatically become executable facts for a time-sensitive workflow.

## Current Mechanism

Prompt mode currently injects knowledge for all prompt runs in `src/lib/agents/prompt-executor.ts`.

The relevant path is:

1. `executePrompt()`
2. `retrieveKnowledgeAssets({ workspaceUri, promptText, workflowRef, skillHints })`
3. `formatKnowledgeAssetsForPrompt()`
4. append `## Retrieved Knowledge` to the composed prompt
5. record `knowledge.retrieval.injected` in run history

The retrieval implementation in `src/lib/knowledge/retrieval.ts` currently selects active knowledge assets by:

- same workspace
- `status = active`
- exact `workflow:<workflowRef>` tag match
- exact `skill:<skillHint>` tag match
- prompt/title/content token match

It does not gate by provenance:

- `source.type`
- `runId`
- whether the asset came from evolution
- whether the asset was manually approved
- whether the asset is time-sensitive

The polluted asset had:

- category: `pattern`
- status: `active`
- sourceType: `run`
- tags: `workflow:/ai_digest`, `skill:baogaoai-ai-digest-generator`

That is enough for prompt-mode retrieval to inject it into future `/ai_digest` runs.

## Architecture Concern

There are two different concepts currently blurred:

1. Runtime history / run capsule
2. Knowledge asset

Run history and run capsules are good audit and learning inputs. They should support:

- diagnostics
- memory candidates
- CEO review
- evolution proposals
- pattern mining

Knowledge assets should be a curated execution input. They should not be a raw replay of prior run summaries.

The current path allows historical run-derived active knowledge to re-enter prompt execution. For time-sensitive workflows, this can override current facts when the agent fails to execute the real context fetch step.

## Root Cause Statement

The `2026-04-25` pollution was caused by generic prompt-mode knowledge retrieval injecting an old `/ai_digest` run summary into a new `/ai_digest` execution.

The scheduler did not pass the wrong date.

The workflow date command did not calculate the wrong date.

The old run `2297bb78-6488-4588-aa44-ea0ad9710fc1` was a valid historical success for `2026-04-25`; it became harmful only because its summary was treated as reusable current context.

## Correct Boundary

For `/ai_digest`:

- current date, article list, digest existence, and source article IDs must come from `fetch_context.py` or backend APIs
- recent digest history must come from `recentDigests` in `prepared-ai-digest-context.json`
- generic Retrieved Knowledge must not provide `targetDate`, `status`, `digest_already_exists`, `sourceArticleIds`, or current article context
- historical run summaries may be used only as diagnostic evidence or workflow format hints, not as factual runtime input

## Follow-Up Investigation Points

1. Decide whether prompt-mode should disable generic `Retrieved Knowledge` for time-sensitive workflows such as `/ai_digest` and `/ai_bigevent`.

2. Add a provenance gate to knowledge retrieval:
   - allow evolution/manual/CEO/system-approved knowledge
   - exclude or heavily restrict `source.type = run`
   - exclude run-derived `category = pattern` from time-sensitive workflows

3. Separate workflow business context from organization knowledge:
   - keep `recentDigests` inside `fetch_context.py`
   - avoid using Knowledge to provide recent daily digest history

4. Investigate why `/ai_digest` did not actually execute `fetch_context.py` in run `59cc1737-7eb4-4ec7-a3d1-995b4d56f50d`.

5. Consider adding a hard validation rule for `/ai_digest`:
   - if `prepared-ai-digest-context.json.targetDate` does not match the current Asia/Shanghai target date, fail with a clear validation error
   - if context contains `warnings` saying it was inferred from prior run knowledge, reject it

6. Consider preventing `recordKnowledgeAssetAccess()` from making old run-derived assets more likely to recur in execution prompts merely because they were accidentally retrieved.

## Evidence Paths

- `src/lib/agents/prompt-executor.ts`
- `src/lib/knowledge/retrieval.ts`
- `src/lib/knowledge/index.ts`
- `src/lib/company-kernel/run-capsule.ts`
- `src/lib/company-kernel/memory-promotion.ts`
- `/Users/darrel/.gemini/antigravity/gateway/runs/59cc1737-7eb4-4ec7-a3d1-995b4d56f50d/run-history.jsonl`
- `/Users/darrel/Documents/baogaoai/demolong/runs/59cc1737-7eb4-4ec7-a3d1-995b4d56f50d/prepared-ai-digest-context.json`
- `/Users/darrel/.gemini/antigravity/knowledge/2297bb78-6488-4588-aa44-ea0ad9710fc1-pattern-16bfe2a477/metadata.json`
- `/Users/darrel/.gemini/antigravity/knowledge/2297bb78-6488-4588-aa44-ea0ad9710fc1-pattern-16bfe2a477/artifacts/content.md`

## Follow-Up: `retrieveKnowledgeAssets(workflowRef=/ai_digest)`

The `workflowRef=/ai_digest` part is explicit execution metadata.

It can come from:

- a scheduled `dispatch-prompt` action with `promptAssetRefs[0]`
- an explicit workflow execution profile
- department skill/workflow resolution when exactly one workflow is matched

The Knowledge retrieval behavior is not explicit workflow configuration.

`src/lib/agents/prompt-executor.ts` calls `retrieveKnowledgeAssets()` for prompt-mode runs by default, passing:

- workspace URI
- original prompt text
- resolved workflow ref
- resolved skill hints

There is no per-workflow switch such as `knowledgeRetrieval: false`, no retrieval policy on `/ai_digest`, and no provenance allowlist at the prompt-composition boundary.

`src/lib/knowledge/retrieval.ts` treats `workflowRef` as a scoring signal:

- exact `workflow:<workflowRef>` tag match adds score
- exact `skill:<skillHint>` tag match adds score
- prompt token overlap adds score
- `decision`, `pattern`, and `domain-knowledge` categories get small boosts

This makes `workflowRef=/ai_digest` a semi-explicit trigger:

- explicit as an execution field
- implicit as a retrieval selector
- implicit as a prompt injection side effect

## Relationship To Memory And Evolution

The intended memory path is:

`Run -> RunCapsule -> MemoryCandidate -> explicit promote -> KnowledgeAsset`

`docs/guide/agent-user-guide.md` states that a `MemoryCandidate` must be explicitly promoted before entering long-term knowledge. The current `persistKnowledgeForRun()` implementation follows that direction by calling `processRunCapsuleForMemory(..., { autoPromote: false })`.

Evolution has a separate path:

`RunCapsule / MemoryCandidate / KnowledgeAsset -> EvolutionProposal -> approval -> publish`

When evolution publishes an SOP, `src/lib/evolution/publisher.ts` can create an active `KnowledgeAsset` with `source.type = system`.

The problem is that retrieval does not distinguish these sources. It reads any active `KnowledgeAsset` in the workspace once it scores above zero, including:

- manually created knowledge
- CEO/system/evolution knowledge
- promoted memory
- legacy run-derived active knowledge

That means the execution input lane and the learning/evolution output lane are currently coupled through a broad `active KnowledgeAsset` bucket.

## Complexity Assessment

The mechanism is over-complex in the risky way: not because it has many modules, but because the boundaries are implicit.

Current execution can combine:

- workflow content
- skill hints
- department context
- runtime contract/tool constraints
- generic retrieved knowledge
- run finalization
- run capsules
- memory candidates
- evolution proposals
- active knowledge assets

The dangerous part is the feedback loop:

1. A run creates or contributes to memory/knowledge.
2. Knowledge gets tagged with workflow/skill metadata.
3. A future run with the same workflowRef retrieves it.
4. The retrieved text becomes prompt input.
5. The agent may treat historical text as current runtime fact.

For `/ai_digest`, this is especially unsafe because the workflow is time-sensitive. Historical daily digests are useful, but only as recent-digest business context for de-duplication, not as generic organizational knowledge capable of setting `targetDate`, `status`, or `digest_already_exists`.

## Simplification Direction

The architecture should separate three lanes:

1. Runtime context
   - current date
   - source articles
   - existing digest check
   - recent digest history for de-duplication
   - produced by workflow scripts or backend APIs

2. Curated knowledge
   - manual / CEO / system / evolution-approved stable knowledge
   - safe to inject only under an explicit retrieval policy

3. Run memory
   - RunCapsule and MemoryCandidate
   - evidence for diagnosis, review, promotion, and evolution
   - not direct prompt input by default

Recommended policy for `/ai_digest`:

- disable generic Retrieved Knowledge, or restrict it to curated non-run sources
- keep historical digest context inside `fetch_context.py` as `recentDigests`
- reject any digest context that infers current `targetDate` or existing-digest status from prior run knowledge

The minimum architecture decision to make next is whether prompt-mode knowledge retrieval should be opt-in per workflow rather than an unconditional default.
