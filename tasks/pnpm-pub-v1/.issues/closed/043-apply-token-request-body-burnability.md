---
title: "applyToken token request body was not burnable and spec/08 used a stale PUT verb"
state: closed
github_issue_status: closed
label: "security"
---

## Summary
Chapter 8's onboarding diagram described the silent token exchange as `PUT /-/npm/v1/tokens`, while `applyToken()` already used the real npm token-creation `POST` route. The implementation also sent the password-bearing JSON body as an immutable string, so the daemon could burn the password source buffer but not the serialized request body that crossed the registry boundary.

## Impact
The stale spec verb blurred the registry protocol law for the onboarding atom. The string request body also weakened the Chapter 8 burn-after-read requirement because a second password-bearing projection lived outside the explicit buffer-erasure path.

## Evidence
- `spec/08.md:22` now states `POST /-/npm/v1/tokens`.
- `src/daemon/npm-api.ts:81-120` now builds the token request body as a `Buffer`, passes that buffer to `fetch`, and burns both the body buffer and password buffer in `finally`.
- `test/unit/npm-api.test.ts:10-36` proves `applyToken()` uses `POST` and that the captured fetch body buffer is zeroed after the call completes.

## Resolution
- Aligned the Chapter 8 sequence diagram with the real npm token endpoint verb.
- Moved the sensitive token request body into a burnable `Buffer` while keeping the durable token response as the only stored credential fact.
- Added a focused regression for the token application boundary.

## Self-Review
- Task offset: this round changed only the onboarding credential boundary and its spec diagram; publish package metadata still uses its separate npm `PUT` endpoint.
- Task residue: the JSON construction still must temporarily materialize `password` as a string inside the serialized payload, but the buffer that crosses `fetch` is now explicitly overwritten after use. The remaining `body: JSON.stringify(buildBody())` match belongs to package publish, not token onboarding.
