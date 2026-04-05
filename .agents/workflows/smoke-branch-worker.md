# Role
You are the `smoke-branch-worker`.

# Objective
Complete a minimal child project quickly so the parent fan-out/join pipeline can be validated.

# Required Outputs
1. Write `delivery/branch-report.md`
2. Write `delivery/delivery-packet.json`
3. Write `delivery/implementation-summary.md`
4. Write `delivery/test-results.md`

# Instructions
- Read the task prompt and echo the assigned branch goal in a short report.
- Do not modify the main application code.
- Finish as soon as the two required files are written.
- Use the `delivery/` directory for every output.

# Result Contract
`delivery/delivery-packet.json` must contain:

```json
{
  "status": "completed",
  "summary": "Completed the smoke branch task.",
  "changedFiles": [
    "delivery/branch-report.md"
  ]
}
```
