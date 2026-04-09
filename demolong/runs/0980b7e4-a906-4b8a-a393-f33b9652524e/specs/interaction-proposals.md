# Interaction Redesign Proposals

## Proposal 1: Replace Native Prompt with `DepartmentPathDialog`

### Problem
Direct calls to `window.prompt` interrupt the user's flow and look unprofessional.

### Proposed Change
Implement a dedicated **Add Department Dialog** using the project's design system (Tailwind + Custom UI components).
- **Before**: User clicks "+ 添加部门" -> Browser native prompt pops up.
- **After**: User clicks "+ 添加部门" -> A sleek, glassmorphic dialog opens with input validation, path suggestions, and clear "Cancel/Confirm" buttons.

---

## Proposal 2: Real-time Audit Stream Injection

### Problem
`AuditLogWidget` is static and doesn't reflect real-time agent activities.

### Proposed Change
Add a 10-second background polling mechanism (aligned with Scheduler) to `AuditLogWidget`.
- **Before**: Audit logs only update on page load.
- **After**: Logs refresh every 10s. New entries slide in with a subtle "fade-in-down" animation using Framer Motion to provide visual evidence that the system is "alive".

---

## Proposal 3: Bento Grid Layout Reconstruction

### Problem
The long vertical single-column layout makes it hard to scan the overall state of the company.

### Proposed Change
Reorganize the dashboard into a responsive **Bento Grid**.
- **Top Row**: Summary Cards (Total Departments, Active Runs, Failed Jobs).
- **Main Area (Left/Center)**: Department Wall (Interactive cards).
- **Side Panel (Right/Bottom)**: Unified Activity Stream (Combining Scheduler activity and Audit logs).
- **Footer/Popups**: Recent Deliverables and Digests.
- **Language**: Standardize all strings to Simplified Chinese (e.g., Change "Scheduler" to "运营调度").
