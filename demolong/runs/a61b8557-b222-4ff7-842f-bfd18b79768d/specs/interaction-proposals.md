# Interaction Proposals

Following the UX audit, here are three concrete redesign proposals to enhance the Antigravity Dashboard experience.

## Proposal 1: Progressive Department Onboarding
**Before**: Clicking "+ 添加部门" opens a native `window.prompt()`.
**After**: Replace `prompt()` with a `DepartmentOnboardingDialog`. 
- **Implementation**: 
  - Use a styled `Dialog` (Radix/Shadcn).
  - Include an input field with real-time path validation.
  - Add a "Recent Paths" list or a "Local Browse" button (leveraging the existing `/api/workspaces/launch` infrastructure).
- **Goal**: Professionalize the onboarding flow and reduce input errors.

## Proposal 2: Segmented Dashboard Navigation
**Before**: A single continuous scroll of many sections.
**After**: Introduce a `Tabs` component at the top level of the `CEODashboard` to categorize content.
- **Implementation**: 
  - Tabs: [Overview, Operations, Health, Audit].
  - Maintain the "Department Grid" in the "Overview" tab.
  - Move "Scheduler" and "Audit Log" to dedicated tabs.
- **Goal**: Reduce cognitive load and allow users to focus on specific management tasks.

## Proposal 3: Refined Status Indicators
**Before**: Pulsing blue dots and hidden settings buttons.
**After**: Simplified, non-distracting status language.
- **Implementation**:
  - Replace "pulse" animation with a static glow or a small "Activity" sparkline.
  - Make the "Settings" icon always visible but dimmed (low contrast) instead of `opacity-0`.
  - Use a consistent `Badge` component for [Active/Completed/Failed] instead of ad-hoc rounded spans.
- **Goal**: Reduce visual fatigue and improve discoverability of management controls.
