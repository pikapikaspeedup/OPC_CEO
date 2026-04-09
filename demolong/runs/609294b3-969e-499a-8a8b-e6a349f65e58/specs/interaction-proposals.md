# Interaction Design Proposals

## 1. Contextual Add-Department Popover
- **Before**: Jarring native `prompt()` dialog.
- **After**: A "Smart Path" popover that appears above the "Add" button.
- **Benefit**: Maintains focus, allows for real-time path validation (e.g., checking if directory exists before submission), and fits the dark-mode aesthetic.

## 2. Bento-Grid Dashboard (Sidebar Optimized)
- **Before**: A long vertical list of full-width widgets.
- **After**: High-density "Bento" layout.
    - **Top Row**: "Critical Pulse" (Failures/Alerts) + "Active Agents" (Small square widgets).
    - **Middle**: "Audit Stream" (Slim vertical list).
    - **Sidebar Mode**: Re-stacks into a single column with collapsible sections.
- **Benefit**: Increases information density by 40% and reduces scroll fatigue.

## 3. Global Activity Hook & Unified I18n
- **Before**: Redundant polling and mixed CN/EN labels.
- **After**: Implement a `useActivityStream` hook to share a single audit stream between the dashboard and global widgets.
- **Benefit**: Ensures 100% consistency across the UI, reduces API calls by 50%, and provides a unified "Language Layer" to eliminate Zombie Localization.
