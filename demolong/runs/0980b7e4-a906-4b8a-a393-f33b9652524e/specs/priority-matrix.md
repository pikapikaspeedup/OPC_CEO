# Priority Matrix: UX Improvements

| Improvement | Impact | Effort | Priority | Description |
| :--- | :--- | :--- | :--- | :--- |
| **P1: Eliminate Native Prompt** | High | Low | **Immediate** | Crucial for the first impression and professional feel. |
| **P2: Audit Log Polling** | High | Medium | **High** | Essential for real-time operational awareness. |
| **P3: Bento Grid Layout** | Medium | High | **Medium** | Improves scanning and information density. |
| **P4: Localization Polish** | High | Low | **Immediate** | Low-hanging fruit to fix "Zombie Localization". |

## Implementation Strategy
1. **Quick Win (Next Step)**: Standardize all text to Chinese and replace `window.prompt` with a simple Modal.
2. **Operational Core**: Wire up the polling logic to the Audit Log widget.
3. **Architectural Polish**: Implement the Grid layout once the individual components are stable.
