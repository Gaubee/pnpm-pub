---
title: "Registry body reader discarded non-JSON response text"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary
The registry response reader attempted JSON parsing directly and collapsed non-JSON response bodies to `null`.

## Impact
Chapter 8.1, 8.3, 8.4, and 8.5 depend on registry responses for token application, publish failure reporting, clock-drift classification, and OIDC setup errors. A non-JSON registry failure body is still source input; discarding it before projection erases evidence and can turn a real registry message into an empty or fake body fact.

## Evidence
- `src/daemon/npm-api.ts` now reads registry responses once as text through `readRegistryBody`.
- The reader parses JSON when possible and preserves raw text when the body is not JSON.
- `applyToken` reuses the single parsed body for token parsing and fallback error projection.
- `test/unit/npm-api.test.ts` verifies non-JSON OIDC failure text is preserved in `stderr`.

## Resolution
- Replaced the JSON-only reader with a source-preserving registry body reader.
- Preserved existing JSON response behavior for successful token creation and structured npm errors.

## Self-Review
- Task offset: this round strengthens registry response source conservation; it does not change publish document construction, TOTP generation, or OIDC endpoint selection.
- Task residue: the registry-specific response schema residue was later tightened by `tasks/pnpm-pub-v1/.issues/closed/175-registry-response-schema-decoding.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
