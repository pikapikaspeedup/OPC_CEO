# Interaction Proposals: CEO Dashboard

## 1. Bento-Grid Layout Transformation
**Before:** Vertically stacked widgets causing a long, narrow "scrolling list" experience.
**After:** A 12-column Bento Grid system where "high-frequency" widgets (Comparison, Recent Completions) are smaller tiles, and "deep-data" widgets (Audit, Digests) have dedicated wider spans. This allows the CEO to see critical signals (HUD style) at a single glance without scrolling.

## 2. In-App Custom Modal for Department Onboarding
**Before:** Native browser `window.prompt()` for adding a department path.
**After:** An elegant, glassmorphic shadcn Dialog that captures the path, performs real-time validation, and provides immediate visual feedback upon "Launch." This maintains the premium aesthetic and allows for "Recent Paths" or "Browse" suggestions.

## 3. Framer Motion "Soft-Refresh" Integration
**Before:** Polling triggers abrupt list re-renders.
**After:** Wrap list items (Scheduler, Recent Events) in `<AnimatePresence>`. Use Framer Motion for:
- **Layout Transitions:** Smoothly slide existing items when new ones arrive.
- **Micro-interactions:** A subtle "glow" or pulse on the updated field (e.g., status pill) to draw the user's eye to the change.
- **Skeleton States:** Show pulse-gradients during the 100ms-200ms API fetch window to signal the system is "alive."
