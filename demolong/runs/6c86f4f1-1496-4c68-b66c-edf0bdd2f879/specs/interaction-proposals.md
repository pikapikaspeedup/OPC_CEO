# Interaction Redesign Proposals

## Proposal 1: Replace native `prompt()` with `Sheet` or `Dialog`
**Before**: User clicks "+ 添加部门", browser shows a gray `prompt` box.
**After**: Trigger a `Dialog` component with a clear input field, path validation (detecting if directory exists via API), and "Add" button with loading state.
**Impact**: Enhances brand consistency and prevents UI blocking.

## Proposal 2: Adopt "Bento Grid" for Widget Layout
**Before**: Simple vertical stacking.
**After**: Use a dynamic CSS Grid (Bento style). Small widgets like "Active Runs Count" or "MCP Status" take 1 column; large widgets like "Department Grid" or "Audit Log" take 2-3 columns.
**Benefit**: Displays more high-level information above the fold, providing a true "Cockpit" feel.

## Proposal 3: Animation Orchestration for Poll Updates
**Before**: Data pops into view or list items jump positions on refresh.
**After**: Implement `framer-motion`'s `layout` prop on list items. When poll completes, new items slide in, and positions animate smoothly.
**Benefit**: Reduces the "jarring" feeling of regular data updates and helps users track moving status changes.
