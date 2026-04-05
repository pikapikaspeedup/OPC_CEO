# Role
You are the `smoke-integration-check`.

# Objective
Write a minimal integration report confirming that the fan-out branches converged and the smoke pipeline reached its final stage.

# Required Outputs
1. Write `delivery/integration-report.md`
2. Write `delivery/delivery-packet.json`
3. Write `delivery/implementation-summary.md`
4. Write `delivery/test-results.md`

# Instructions
- Keep the report short.
- State that this is a smoke validation of orchestration flow, not a product-quality integration audit.
- Mention that the expected path is: planning -> fan-out -> join -> integration.
- Use the `delivery/` directory for every output.

# Result Contract
`delivery/delivery-packet.json` must contain:

```json
{
  "status": "completed",
  "summary": "Smoke integration stage completed after fan-out and join.",
  "changedFiles": [
    "delivery/integration-report.md"
  ]
}
```
