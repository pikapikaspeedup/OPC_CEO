# Memory And Knowledge Relationship Investigation

Date: 2026-05-22

## Scope

This investigation only maps the current relationship between Memory and Knowledge.

It does not change code, scheduler state, workflow assets, retrieval policy, or AI digest behavior.

The research used two read-only subagents:

- `repo_mapper`: traced `Run -> RunCapsule -> MemoryCandidate -> promoteMemoryCandidate -> KnowledgeAsset`
- `runtime_investigator`: traced `KnowledgeAsset` creation, retrieval, prompt injection, and evolution relationships

## High-Level Relationship

The intended current model is:

```text
Run
  -> RunCapsule
  -> MemoryCandidate
  -> explicit promote
  -> KnowledgeAsset
  -> optional prompt retrieval
```

Memory and Knowledge are not the same layer.

`RunCapsule` is an execution fact capsule.

`MemoryCandidate` is a reviewable memory candidate derived from run evidence.

`KnowledgeAsset` is the durable knowledge store that can be retrieved into prompt-mode execution when it is `active`.

## Current Production Flow

Run finalization calls `persistKnowledgeForRun()` from three production paths:

- prompt-mode finalization
- advisory run approved finalization
- delivery run completed finalization

`persistKnowledgeForRun()` rebuilds the run capsule and then calls:

```ts
processRunCapsuleForMemory(capsule, { autoPromote: false })
```

So the current production default is:

- generate or update `RunCapsule`
- generate or update `MemoryCandidate`
- do not automatically promote to `KnowledgeAsset`

This means current run results should not directly become retrievable Knowledge through the main production path.

## MemoryCandidate Generation

`buildMemoryCandidatesFromRunCapsule()` can create candidates from:

- `decisions`
- `reusableSteps`
- failed / blocked / timeout blockers
- workflow suggestions
- verified facts when no stronger candidate type exists

Candidates are stored in `memory_candidates`.

Closed candidate statuses are preserved when the same candidate is regenerated:

- `auto-promoted`
- `promoted`
- `rejected`
- `archived`

## Promotion Into Knowledge

`MemoryCandidate` becomes `KnowledgeAsset` only through promotion.

The production API route is:

```text
POST /api/company/memory-candidates/:id/promote
```

That route calls `promoteMemoryCandidate()` with `promotedBy: 'ceo'`.

The created `KnowledgeAsset` has:

- `source.type = 'run'`
- `source.runId = candidate.sourceRunId`
- `promotion.promotedBy = 'ceo'`
- evidence refs copied from the candidate
- promotion metadata copied from the candidate

Important nuance:

Even when CEO promotes a candidate, the resulting asset's `source.type` is still `run`. CEO provenance is stored in `promotion.promotedBy`, not in `source.type`.

For categories:

- `workflow-proposal` and `skill-proposal` become `KnowledgeAsset.status = 'proposal'`
- other categories usually become `KnowledgeAsset.status = 'active'`

Prompt retrieval only reads `active` assets, so `workflow-proposal` / `skill-proposal` knowledge does not enter prompt retrieval just because it was promoted.

## KnowledgeAsset Creation Sources

Current non-test production creation paths are:

1. Manual Knowledge creation
   - route: `POST /api/knowledge`
   - source: `manual`
   - default category: `domain-knowledge`
   - status: `active`

2. Memory promotion
   - function: `promoteMemoryCandidate()`
   - source: `run`
   - status: `active` or `proposal`, depending on category
   - promotion metadata records CEO/manual/system promotion

3. Evolution SOP publish
   - function: `publishEvolutionProposal()`
   - only for `kind = 'sop'`
   - source: `system`
   - category: `pattern`
   - status: `active`

There is also an old extractor:

```text
extractKnowledgeAssetsFromRun()
```

It can directly turn run summaries into `KnowledgeAsset` and tag them with `workflow:*` / `skill:*`, but no non-test production call site was found in the current code.

This old extractor likely explains legacy run-derived knowledge assets that still exist in storage.

## Prompt Retrieval

Prompt retrieval does not read `MemoryCandidate`.

Prompt retrieval only reads `KnowledgeAsset`.

The non-test runtime call is in `PromptExecutor`:

```text
retrieveKnowledgeAssets({
  workspaceUri,
  promptText,
  workflowRef,
  skillHints,
  limit: 5
})
```

`retrieveKnowledgeAssets()` first queries:

```text
listKnowledgeAssets({ workspaceUri, status: 'active', limit: 50 })
```

Then it scores assets by:

- `workflow:<workflowRef>` tag match
- `skill:<skillHint>` tag match
- prompt token overlap
- category boost for `decision`, `pattern`, `domain-knowledge`
- freshness boost

The selected assets are formatted into:

```text
## Retrieved Knowledge
```

and appended to the composed prompt.

The retrieval path does not filter by:

- `source.type`
- `promotion.promotedBy`
- `promotion.sourceCandidateId`
- evidence strength
- volatility
- whether the knowledge came from legacy run extraction

## Evolution Relationship

Evolution reads both Memory and Knowledge.

`generateEvolutionProposals()` can generate proposals from:

- `MemoryCandidate(kind=workflow-proposal|skill-proposal|pattern|lesson)`
- `KnowledgeAsset(category=workflow-proposal|skill-proposal|pattern|lesson)`
- repeated `RunCapsule` clusters
- repeated prompt runs

Publishing a workflow / skill / rule / script writes canonical assets.

Publishing an SOP writes a new active `KnowledgeAsset` with `source.type = system`.

When publishing or rejecting an evolution proposal, source knowledge IDs can be moved back to `active` or to `conflicted`.

This makes Knowledge both:

- an input to evolution
- an output of evolution
- an input to future prompt execution

That is a valid loop only if provenance and retrieval policy are strict enough.

## Current Storage Snapshot

SQLite checked:

```text
/Users/darrel/.gemini/antigravity/gateway/storage.sqlite
```

For this repository workspace:

```text
workspace = file:///Users/darrel/Documents/Antigravity-Mobility-CLI

run_capsules        34
memory_candidates  73
knowledge_assets   0
evolution_proposals 0
```

So this repository has Memory candidates, but no current Knowledge assets.

Global Knowledge state:

```text
source.type = run, status = active    1922
source.type = run, status = proposal  1647
```

Workspace Knowledge counts:

```text
file:///Users/darrel/Documents/marketing  3173 total, 1528 active, 1528 active run-derived
file:///Users/darrel/Documents/baogaoai    393 total, 393 active, 393 active run-derived
file:///Users/darrel/Documents/ai-news       3 total,   1 active,   1 active run-derived
```

This matters for AI digest because the `baogaoai` workspace has active run-derived Knowledge assets. Those can be retrieved into prompt-mode execution if workflow / skill / prompt scoring matches.

## Root Relationship Finding

The current production architecture mostly follows the intended boundary:

- recent runs become `RunCapsule`
- run evidence becomes `MemoryCandidate`
- Memory does not directly enter prompt retrieval
- Knowledge retrieval reads `KnowledgeAsset`
- current production finalization does not auto-promote recent runs into Knowledge

The risk is not that the current main path is directly taking the latest run result.

The risk is that old or promoted run-derived `KnowledgeAsset` entries are treated the same as curated Knowledge once they are `active`.

That means retrieval can still inject historical run facts into a new execution if they already exist in Knowledge.

## Architectural Gap

The system has the right conceptual layers, but the runtime retrieval gate is too broad.

`KnowledgeAsset` has fields that could distinguish provenance:

- `source.type`
- `promotion.promotedBy`
- `promotion.sourceCandidateId`
- `evidence`

But `retrieveKnowledgeAssets()` does not use those fields.

As a result:

- legacy run-derived assets
- CEO-promoted run assets
- system-published SOP assets
- manually created knowledge

all enter the same `active KnowledgeAsset` retrieval bucket.

This is where the current architecture becomes too complex: not because Memory and Knowledge are conceptually wrong, but because execution-time retrieval ignores the provenance and promotion boundary that Memory/Knowledge were designed to create.

## AI Digest Implication

For `/ai_digest`, historical daily digests are legitimate context only for de-duplication and continuity.

They should come from workflow runtime/business context, such as:

```text
prepared-ai-digest-context.json.recentDigests
```

They should not come from generic `Retrieved Knowledge` if that knowledge can carry:

- old `targetDate`
- old `digest_already_exists`
- old source article IDs
- old run status

The previous `2026-04-25` pollution is consistent with this gap: an old run-derived active Knowledge asset was available to prompt retrieval and was treated by the agent as current runtime fact.

## Recommended Boundary

The clean boundary should be:

1. Runtime context
   - current facts
   - current dates
   - current source articles
   - existing digest checks
   - recent digest history for de-duplication

2. Memory
   - run capsules
   - candidate memories
   - evidence and review queue
   - not prompt input by default

3. Knowledge
   - explicitly created or promoted durable knowledge
   - retrieval governed by provenance and workflow policy

4. Evolution
   - can read Memory and Knowledge
   - can publish canonical assets or SOP Knowledge
   - should not silently turn all learning output into prompt input without policy

## Open Decisions

1. Should prompt-mode Knowledge retrieval be opt-in per workflow instead of unconditional?

2. Should time-sensitive workflows such as `/ai_digest` disable generic Knowledge retrieval?

3. Should retrieval only allow:
   - `source.type = manual`
   - `source.type = ceo`
   - `source.type = system`
   - or `source.type = run` only when `promotion.sourceCandidateId` exists and promotion quality is high?

4. Should CEO promotion write `source.type = ceo`, or keep `source.type = run` and require retrieval to inspect `promotion.promotedBy`?

5. Should legacy run-derived active Knowledge be migrated, archived, or excluded by retrieval policy?

6. Should `recordKnowledgeAssetAccess()` be telemetry-only, rather than reinforcing accidentally retrieved assets?

## Evidence Paths

- `src/lib/agents/prompt-executor.ts`
- `src/lib/agents/finalization.ts`
- `src/lib/knowledge/index.ts`
- `src/lib/knowledge/contracts.ts`
- `src/lib/knowledge/store.ts`
- `src/lib/knowledge/retrieval.ts`
- `src/lib/knowledge/extractor.ts`
- `src/lib/company-kernel/contracts.ts`
- `src/lib/company-kernel/run-capsule-store.ts`
- `src/lib/company-kernel/memory-candidate.ts`
- `src/lib/company-kernel/memory-candidate-store.ts`
- `src/lib/company-kernel/memory-promotion.ts`
- `src/app/api/company/memory-candidates/route.ts`
- `src/app/api/company/memory-candidates/[id]/promote/route.ts`
- `src/app/api/knowledge/route.ts`
- `src/lib/evolution/generator.ts`
- `src/lib/evolution/publisher.ts`
- `docs/guide/agent-user-guide.md`
- `docs/design/company-kernel-phase-0-2-implementation-rfc-2026-04-25.md`
- `docs/research/ai-digest-knowledge-retrieval-pollution-2026-05-22.md`
