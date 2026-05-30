# Context Loading Simplification Analysis

Date: 2026-05-22

## Scope

This document analyzes Prompt Mode workflow context loading and identifies what should be removed, merged, or kept.

No code changes are made in this pass.

## Updated Direction

After review, the desired simplification is not to remove Department Capability Pack or Playbook context.

Keep:

- Department Capability Pack
- Playbook context / selected workflow body

Remove or redesign:

- automatic generic `retrieveKnowledgeAssets()` injection
- Department Memory Hook runtime injection
- legacy `.department/memory` compatibility as an execution context source

Reason:

Department Capability Pack is the department's operating context. It contains identity, rules, available workflows, skills, and capability configuration. This is useful when no explicit workflow is selected and should remain part of the department execution model.

Playbook context is the concrete selected workflow body. It is also useful and should remain.

The unhealthy parts are the extra memory / Knowledge paths that inject unapproved or legacy context without a deliberate department or workflow selection.

## Current Context Inputs

A prompt-mode workflow run currently receives context from multiple independent paths.

### 1. Department Capability Pack

Source:

- `src/lib/agents/department-execution-resolver.ts`

Current content:

- department identity rule
- department local rules
- allowed templates
- prompt mode resolution policy
- department workflows
- department skills
- published growth workflows / skills

Problem:

This layer is doing two jobs at the same time:

- resolving what should run
- injecting many candidate capabilities into the execution prompt

For a run with an explicit workflow, this is too broad. The agent should not see every department workflow and skill after the system has already resolved the target workflow.

Updated decision:

Do not remove this mechanism in the current simplification pass.

The Department Capability Pack is important department context. It is acceptable for it to expose department workflows / skills / growth workflows as candidate capabilities when no explicit workflow has been selected.

Future refinement can make this more compact, but it is not the source of the current Knowledge pollution.

### 2. Playbook Context

Source:

- `src/lib/agents/prompt-executor.ts`
- `AssetLoader.resolveWorkflowContent()`

Current content:

- workflow markdown body for `promptAssetRefs`
- run artifact directory
- primary task
- skill hints

This is the correct place for the selected workflow body.

Problem:

It overlaps with Department Capability Pack when the pack also injects workflow content. Current code has duplicate-avoidance logic, but the design still has two possible workflow-content channels.

Updated decision:

Keep Playbook context.

This is the correct place where the selected workflow's body becomes execution instructions.

It should not be treated as the problem in this simplification pass.

### 3. Retrieved Knowledge

Source:

- `src/lib/agents/prompt-executor.ts`
- `src/lib/knowledge/retrieval.ts`

Current behavior:

- loads workspace `KnowledgeAsset(status=active)`
- scores by `workflow:*` tags, `skill:*` tags, prompt token overlap, category, and freshness
- injects selected assets as `## Retrieved Knowledge`

Problem:

This treats `active KnowledgeAsset` as equivalent to approved execution knowledge.

It does not distinguish:

- manual knowledge
- CEO-promoted knowledge
- system/evolution knowledge
- legacy run-derived knowledge

This is the direct source of historical run pollution.

Updated decision:

Generic automatic retrieval should be removed or replaced by explicit selection.

Knowledge should enter execution only when it is:

- selected by the department configuration
- selected by the workflow configuration
- explicitly approved and marked as usable for execution

Memory and evolution may produce candidates, but those candidates should not become execution Knowledge until reviewed and selected.

### 4. Department Memory Hook

Source:

- `src/lib/agents/department-memory-bridge.ts`
- backend memory hooks

Current content:

- `.department/memory/shared/*.md`
- `.department/memory/<provider>/*.md`
- legacy `.department/memory/knowledge.md`
- legacy `.department/memory/decisions.md`
- legacy `.department/memory/patterns.md`
- organization memory
- recent 5 structured `KnowledgeAsset`

Problem:

This is a second Knowledge injection path.

It bypasses workflow-specific filtering and injects recent Knowledge by workspace.

It also keeps legacy markdown memory in the execution path, which conflicts with the newer `RunCapsule -> MemoryCandidate -> KnowledgeAsset` model.

Updated decision:

This hook's execution-time injection should be removed or disabled.

It has unclear meaning in the current architecture because it bypasses explicit department/workflow selection and injects memory files plus recent Knowledge separately from the main prompt composer.

If department memory remains useful, it should be represented as selected department context or curated Knowledge, not a hidden backend hook.

### 5. Workflow Runtime Facts

Source:

- workflow script called by the agent, such as `fetch_context.py`
- run artifacts, such as `prepared-ai-digest-context.json`

Current content:

- current date
- current article list
- current existence check
- recent digest history for de-duplication

This is the correct place for current facts.

This should not be replaced by Knowledge retrieval.

### 6. Finalize

Source:

- `finalizeWorkflowRun()`

Current behavior:

- reads workflow artifacts
- validates output
- reports or writes final result
- persists run capsule and memory candidates after completion

Finalize should not load new execution context.

It should only validate and complete the run.

## What To Keep

Keep these concepts:

1. Department Capability Pack as department operating context
2. Playbook context as selected workflow instructions
3. Runtime facts from workflow scripts / backend APIs
4. Explicitly approved Knowledge under a policy
5. MemoryCandidate as post-run review material
6. Finalize as validation and reporting

## What To Remove From Execution Prompt

Remove from default execution prompt:

1. Generic `active KnowledgeAsset` retrieval
2. Recent Knowledge from `department-memory-bridge`
3. Legacy `.department/memory/*.md` as default execution memory
4. Any `MemoryCandidate` content before promotion
5. Any legacy run-derived Knowledge that has not been explicitly reviewed and selected

These can remain available in governance, review, and debugging surfaces. They should not be default execution input.

## What To Refactor

### 1. Keep Department Capability Pack

Target:

```text
department context remains explicit and visible
```

Department Capability Pack should remain because it provides:

- department identity
- department rules
- available workflow candidates
- skill fallback candidates
- growth capability candidates

This is useful when the user has not explicitly selected a workflow.

It is not the source of the AI digest date pollution.

### 2. Keep Playbook Context

Playbook context should remain the place where the selected workflow body is injected.

For `/ai_digest`, this is where the AI digest workflow instructions belong.

This is not Knowledge and should not be mixed with Knowledge retrieval.

### 3. Replace Generic Retrieval With Policy-Based Approved Knowledge

Current:

```text
workspace active KnowledgeAsset -> scoring -> prompt
```

Target:

```text
explicit department/workflow selection -> approved Knowledge -> prompt
```

Minimum policy fields:

- workflowRef
- allowDepartmentShared
- allowedSourceTypes
- requirePromotion
- allowTimeBound
- allowLegacyRunDerived
- maxItems

For time-sensitive workflows such as `/ai_digest`:

```text
allowLegacyRunDerived = false
allowTimeBound = false
allowedSourceTypes = manual, ceo, system
```

The important behavioral change is:

```text
Knowledge is not auto-selected just because it is active.
```

It must be deliberately selected or approved for the department/workflow.

### 4. Disable Knowledge In Department Memory Hook

`department-memory-bridge` should stop injecting recent `KnowledgeAsset`.

Knowledge should have one execution entry point, not two.

Legacy `.department/memory` files should be treated as migration input or governance context, not default runtime prompt content.

The hook's original purpose was to bridge old department memory files and provider-specific memory into backend config.

That purpose is now weaker than the cost: it creates a hidden context channel.

### 5. Keep MemoryCandidate Out Of Prompt

MemoryCandidate should remain:

- review queue
- CEO decision material
- evolution source
- promotion source

It should not be prompt context until explicitly promoted into approved Knowledge.

### 6. Keep Runtime Facts Outside Knowledge

Current facts must come from workflow scripts or backend APIs.

For `/ai_digest`, this means:

- target date
- source articles
- existing digest check
- recentDigests

must come from `fetch_context.py` and artifact files.

Knowledge must not provide those fields.

## Target Simple Flow

The simplified workflow run should be:

```text
Workflow run starts
  -> resolve department + workflowRef
  -> build minimal prompt context:
       department identity/rules
       selected workflow body
       approved Knowledge allowed by workflow policy
       run artifact paths
       user task
  -> send prompt to Agent
  -> Agent runs workflow script for current facts
  -> Agent writes required artifacts
  -> finalize validates and reports
  -> run output becomes RunCapsule / MemoryCandidate
  -> only explicit promotion creates Knowledge
```

## Recommended Priority

### P0: Stop Hidden Department Memory Injection

Remove or disable runtime injection from `department-memory-bridge`.

This removes:

- hidden `.department/memory` injection
- hidden recent Knowledge injection
- the second Knowledge path

### P1: Remove Generic Knowledge Retrieval

Remove or disable automatic `retrieveKnowledgeAssets()` from PromptExecutor until explicit selection exists.

Replace it later with explicitly selected approved Knowledge.

### P2: Add Explicit Knowledge Selection

Knowledge should be attached through:

- department configuration
- workflow configuration
- CEO/manual approval
- clear execution eligibility metadata

### P3: Delete Legacy Memory Compatibility

Legacy `.department/memory` should not be a default prompt source.

It can be migrated into Knowledge through review or shown in governance UI.

### P4: Add A Context Ledger

Every final composed prompt should record which context sections were injected:

- section name
- source file/table
- item count
- policy decision

This makes future pollution directly diagnosable.

## Final Position

The mechanism should not be:

```text
department context + workflow + automatic knowledge + hidden memory + runtime facts
```

The mechanism should be:

```text
department capability context + selected workflow + current facts + explicitly selected approved knowledge
```

The key simplification is to remove hidden automatic memory / Knowledge channels, not to remove department capability context.
