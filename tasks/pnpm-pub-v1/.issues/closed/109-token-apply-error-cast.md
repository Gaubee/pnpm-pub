---
title: "Token apply catch path assumed Error throws"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary
The token-apply path converted caught registry transport failures with `(err as Error).message`.

## Impact
Chapter 8.1 treats token application as a credential source boundary. Fetch failures are external source input and are not guaranteed to be `Error` instances; projecting them through an assertion can erase or misrepresent the actual failure.

## Evidence
- `src/daemon/npm-api.ts` now projects caught token-apply failures through `errorToMessage`.
- The helper accepts `Error` instances and falls back to the shared registry body text projection for non-Error values.
- `test/unit/npm-api.test.ts` verifies a non-Error fetch rejection returns the original failure text without casts.

## Resolution
- Replaced the unchecked `Error` assertion with an unknown-safe error projection helper.
- Preserved normal `Error.message` behavior for standard thrown errors.

## Self-Review
- Task offset: this round strengthens token-apply transport failure projection; it does not change token request construction, credential burning, or registry response parsing.
- Task residue: the registry-specific response schema residue was later tightened by `tasks/pnpm-pub-v1/.issues/closed/175-registry-response-schema-decoding.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
