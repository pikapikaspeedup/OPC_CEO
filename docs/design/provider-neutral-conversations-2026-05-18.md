# Provider-Neutral Conversations

Date: 2026-05-18

## Scope

This note records the implemented conversation/runtime boundary after the provider-neutral conversation fix.

## Implemented Behavior

- Gateway local conversations use a stable business id shaped as `conversation-*`.
- A conversation stores the most recent provider in `provider`, but that field is not the identity of the conversation.
- Provider-specific runtime handles are stored under `providerSessions[provider].sessionHandle`.
- `POST /api/conversations/:id/send` chooses the provider for the current turn from request `provider`, then current execution provider config, then conversation fallback.
- Switching provider between turns starts or resumes that provider's own runtime session while preserving the same business conversation id.
- Canonical local steps are stored under the business conversation id and are preferred by `/steps`.
- API-backed cancel uses the business conversation id because active requests are registered by business conversation id.
- API-backed revert updates the provider session transcript and the business transcript view.
- Antigravity control paths resolve `providerSessions.antigravity.sessionHandle` before calling gRPC.

## Boundaries

- In-flight requests are not migrated between providers. A provider switch applies to the next turn.
- Provider-specific artifacts, tool semantics, and runtime transcript formats remain provider-owned.
- Agent runs, scheduler runs, bridge workers, model catalog, and provider registry were not refactored in this change.

