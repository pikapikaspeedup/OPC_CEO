# Priority Matrix (Impact × Effort)

| Proposal | Impact | Effort | Priority | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Replace `prompt()` with Dialog** | High | Low | **P0** | Quick win. Significantly improves first impression and reliability. |
| **Refine Status Indicators** | Medium | Low | **P1** | Lower visual noise. Use shared UI components to minimize debt. |
| **Segmented Tabs Navigation** | High | Medium | **P2** | Structural change. Requires re-thinking data fetching/caching for tabs. |

## Strategy
1. **Immediate (P0)**: Fix the `prompt()` as it is the most glaring UX debt.
2. **Short-term (P1)**: Clean up the visual language of the cards to reduce chaos.
3. **Mid-term (P2)**: Restructure the dashboard as the number of departments/scheduler jobs grows.
