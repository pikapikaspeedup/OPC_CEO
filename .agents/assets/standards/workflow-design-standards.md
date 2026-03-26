# Workflow Design Standards

> This document is the **single source of constraints** for all pipeline templates and workflow definitions in this system.
> Every template-factory-generated template MUST comply with these standards.
> Human-authored templates SHOULD comply.

---

## 1. Role Design Principles

### 1.1 Strict Separation of Concerns

Each role in a pipeline must have a **single, clear responsibility**. Roles MUST NOT overlap:

| Responsibility Layer | What it covers | Who owns it |
|---------------------|----------------|-------------|
| **User Need & Value** | Why are we doing this? Who benefits? What pain does it solve? | Product / Strategy roles |
| **Technical Design** | How will it be built? What components change? What interfaces? | Architecture / Design roles |
| **Execution** | Write the code / content / artifact | Builder / Developer / Writer roles |
| **Quality Assurance** | Does the output meet the spec? Is it correct? | Reviewer / QA / Editor roles |

**Anti-pattern**: A PM role that outputs TypeScript type definitions, or an Architect role that redefines user scenarios.

### 1.2 Industry-Grounded Role Selection

Roles should be modeled on real-world best practices from the relevant domain. Common reference models:

**Software Development**:
- Product Manager → Architect → Developer → QA / Code Reviewer

**Content Creation**:
- Topic Researcher → Writer → Editor → Fact-checker / Proofreader

**Design**:
- UX Researcher → UX/UI Designer → Design Reviewer → Developer Handoff

**Data / Analytics**:
- Requirements Analyst → Data Modeler → Pipeline Developer → Data QA

**Operations / SRE**:
- Incident Analyst → Solution Designer → Implementer → Verification

When designing a template, pick roles from the appropriate domain. Do NOT invent arbitrary role names — use titles that a human in that industry would recognize.

### 1.3 Reviewer Independence

Reviewers MUST independently verify the author's work against the source of truth (codebase, data, user reality). A reviewer that only reads the deliverable without cross-checking is useless.

---

## 2. Deliverable Design

### 2.1 One Core Deliverable Per Role

Each role produces **one primary output file** (the core deliverable). Avoid fragmenting output into multiple files unless there is a strong structural reason (e.g., code and its test file).

- ✅ PM outputs `product-spec.md`
- ✅ Architect outputs `architecture-plan.md`
- ❌ PM outputs `requirement-brief.md` + `implementation-reality.md` + `draft-spec.md` (3 files that could be 1)

### 2.2 Structured Metadata in Files, Not Chat

All structured data (status, summary, decision, blockers, risks) MUST be written to JSON files:

- **Author roles** → write `result.json` with status, summary, changedFiles, risks, blockers
- **Reviewer roles** → write `review/result-round-{N}.json` with decision, summary, issueCount, revisionRequests

The AI's conversation text is for natural language discussion only. Never require the AI to output structured data in its chat response.

### 2.3 The DECISION Marker Exception

Reviewer roles SHOULD still output a `DECISION: APPROVED|REVISE|REJECTED` text marker as the last line of their conversation, purely as a **compatibility fallback** for the runtime parser. The primary source of truth is always the JSON file.

---

## 3. Input Handling

### 3.1 Goal Translation

The first role in any pipeline MUST be capable of handling vague, ambiguous, or overly-technical user input. It is the first role's job to:

1. **Decode user intent** — separate what they want from how they think it should be built
2. **Research actual state** — read the codebase/data/content to understand what exists today
3. **Output in the role's native language** — a PM writes in user language, not code; a topic researcher writes in editorial language, not API calls

### 3.2 Input Artifact Contracts

When a role depends on the output of a previous stage, the template MUST specify:
- `sourceContract.acceptedSourceGroupIds` — which upstream groups can feed this stage
- `sourceContract.requireReviewOutcome` — what review decision is required (usually `["approved"]`)

---

## 4. Pipeline Flow Design

### 4.1 AutoTrigger Policy

- Set `autoTrigger: false` on stages where the user might want to review and intervene before proceeding
- Set `autoTrigger: true` on stages that should flow automatically once the upstream approves
- As a rule of thumb: the **first** stage in a pipeline should be `autoTrigger: false` (manual start), and subsequent stages can be `true`

### 4.2 Review Loop Configuration

For `review-loop` execution mode:
- Max rounds are controlled by `reviewPolicyId` (typically 3 rounds)
- Each round consists of: Author writes/revises → Reviewer evaluates → APPROVED/REVISE/REJECTED
- If REJECTED, the pipeline stage fails and requires human intervention

### 4.3 Timeout Budgets

Set `timeoutMs` based on realistic expectations:
- Research/analysis roles: 10-12 min (600-720k ms)
- Review roles: 8-10 min (480-600k ms)
- Execution/builder roles: 15-30 min (900-1800k ms)

---

## 5. Template Structure Requirements

Every template MUST include:

```json
{
  "id": "<unique-template-id>",
  "kind": "template",
  "title": "<human-readable title>",
  "description": "<what this pipeline does, in one sentence>",
  "groups": {
    "<group-id>": {
      "title": "<stage title>",
      "description": "<what this stage accomplishes>",
      "executionMode": "review-loop | delivery-single-pass",
      "roles": [
        { "id": "<role-id>", "workflow": "/<workflow-file-name>", "timeoutMs": 600000 }
      ]
    }
  },
  "pipeline": [
    { "groupId": "<group-id>", "autoTrigger": false|true }
  ]
}
```

Every referenced workflow (`/<workflow-file-name>`) MUST have a corresponding `.agents/workflows/<workflow-file-name>.md` file.

---

## 6. Quality Checklist

Before a template is declared ready, verify:

- [ ] Each role's deliverable is clearly defined (one core file per role)
- [ ] No role crosses responsibility boundaries (PM doesn't write code, Architect doesn't define user stories)
- [ ] Reviewer roles independently verify, not just read
- [ ] All structured data is in JSON files, not chat text
- [ ] First role can handle vague user input
- [ ] `autoTrigger` settings are intentional
- [ ] `timeoutMs` values are realistic
- [ ] All referenced workflow files exist
- [ ] Template passes JSON schema validation
