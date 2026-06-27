---
title: "NPM token response used an unchecked JSON cast"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary
The NPM token apply path cast a successful registry JSON response directly to `{ token?: string }`.

## Impact
Chapter 8.1 treats an automation token as a credential source. A 200 response from the registry must not become a stored token fact unless the response body proves `token` is a string.

## Evidence
- `src/daemon/npm-api.ts` now parses token responses through `parseTokenResponse`.
- `parseNpmError` now reads error/message fields through the same object guard instead of a record cast.
- `test/unit/npm-api.test.ts` verifies a 200 response with a non-string token returns `{ ok: false, error: "HTTP 200" }`.
- The burnable request body test now proves the body is a `Buffer` before inspecting zeroed bytes.

## Resolution
- Replaced the unchecked token response cast with explicit runtime parsing.
- Preserved the existing manual-token fallback and error parsing behavior for failed registry responses.

## Self-Review
- Task offset: this round strengthens the registry credential source boundary; it does not change publish response parsing or clock-drift classification.
- Task residue: the broader registry body and transport-error decoding surfaces were later resolved by `tasks/pnpm-pub-v1/.issues/closed/107-registry-body-text-projection.md`, `tasks/pnpm-pub-v1/.issues/closed/108-registry-body-reader-discards-text.md`, and `tasks/pnpm-pub-v1/.issues/closed/109-token-apply-error-cast.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
