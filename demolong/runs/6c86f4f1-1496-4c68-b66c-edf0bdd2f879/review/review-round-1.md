# UX Critic Review: Antigravity Dashboard (Round 1)

**Target Run**: 6c86f4f1-1496-4c68-b66c-edf0bdd2f879
**Reviewer**: Principal UX Critic
**Decision**: 🟡 REVISE

## 1. Verified Findings
I have independently audited the codebase and can confirm the following claims in the original report:
- **Native Interaction confirmed**: `src/components/ceo-dashboard.tsx:130` uses a synchronous `window.prompt()`. This is indeed an interaction "blocker" that breaks the premium dark-mode aesthetic.
- **Vertical Stacking Fatigue confirmed**: The dashboard uses a `space-y-6` container that linearly stacks 7+ complex widgets. On standard resolutions, critical data like "Digests" and "Audit Logs" are guaranteed to be below the fold.
- **Static Refresh confirmed**: The 10s polling interval in `ceo-dashboard.tsx` triggers a state update that replaces list items abruptly without CSS transitions or Framer Motion orchestration.

## 2. Disputed Findings & Missed Issues
While the author correctly identified surface-level issues, the following critical UX and technical-logic gaps were missed:

### 2.1 The "Stale Audit" Data Bug (Critical)
The author missed a significant data consistency issue: `AuditLogWidget` (line 393) maintains its own internal state and `useEffect` with an empty dependency array (`src/components/audit-log-widget.tsx:26-31`). It **never refreshes** after the initial mount. Meanwhile, the parent `CEODashboard` polls every 10s. This results in a "Zombie Dashboard" where the Department Grid shows progress, but the Audit Log remains stuck in the past.

### 2.2 Zombie Localization (Major)
The interface is a mix of languages ("🏢 部门" vs "Scheduler", "Recent activity", "Daily Digest"). This suggests a lack of a unified i18n strategy. A "premium" product should not feel like a partial translation.

### 2.3 Feedback Gap in "Add Department"
The existing flow (`api.launchWorkspace(wsPath.trim())`) provides zero feedback while the workspace is launching. The author's proposal to replace `prompt()` with a `Dialog` is good, but it must include a **Live Path Validation** service to prevent "404 Workspace" errors before the user even clicks "Add".

## 3. Proposal Critique

| Proposal | Assessment | Risk/Blind Spot |
| :--- | :--- | :--- |
| **Replace native `prompt()`** | **Approved** | Should add "Recent Paths" or "Autocomplete" to the new Dialog to reduce friction. |
| **Bento Grid Layout** | **Conditional** | High risk of visual clutter. The "Comparison Widget" is significantly taller than the "Scheduler Card". A naive Bento grid will create awkward whitespace or "grid holes". |
| **Animation Orchestration** | **Approved** | Specifically suggest `layoutId` for the "Department Grid" items so they physically shift when a new department is inserted or sorted. |

## 4. Strengthening Suggestions
1. **Unify Polling**: Lift the Audit Log fetching into a shared provider or pass the parent's `schedulerAuditEvents` down to the `AuditLogWidget` to ensure data parity.
2. **Global Command Bar**: Instead of just "+" buttons, consider a Cmd+K interface for "Add Department" or "Launch Project" to reinforce the "Power User/CEO" persona.
3. **Strategic Color HUD**: The "failed recently" text should be replaced with a high-visibility HUD element (e.g., a pulsating red glow on the Scheduler widget) if critical jobs fail.

## 5. Final Assessment
The original UX audit is a good start but lacks the "Principal-level" depth required to spot data synchronization bugs and architectural inconsistencies. The proposals are standard but need refinement for specialized "Cockpit" layouts.

**DECISION: REVISE**
