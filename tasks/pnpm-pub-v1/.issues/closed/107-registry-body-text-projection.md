---
title: "Registry error bodies used scattered text projection"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

Registry error handling converted unknown response bodies to text through scattered `JSON.stringify` calls in OTP classification, token-expiry classification, and stderr projection.

## Impact

Chapter 8.3, 8.4, and 8.5 depend on registry responses to drive publish failure reporting, clock-drift recovery, expired-token routing, and OIDC setup errors. Unknown registry bodies should remain source input until a single projection boundary converts them into text; malformed or unstringifiable bodies must not throw or emit fake `"null"` body facts.

## Evidence

- `src/daemon/npm-api.ts` now routes registry body text conversion through `bodyToText`.
- OTP failure detection, publish stderr, OIDC stderr, and expired-token classification use the same projection helper.
- `test/unit/npm-api.test.ts` verifies unstringifiable bodies do not escape classification and non-JSON OIDC failures do not emit `"null"` as stderr.

## Resolution

- Replaced scattered registry body stringification with one guarded text projection helper.
- Preserved existing npm error parsing and status fallback behavior.

## Self-Review

- Task offset: this round strengthens registry error-body projection; it does not change token apply request construction, publish document construction, or OIDC endpoint selection.
- Task residue: the broader registry-specific response schema residue was later tightened by `tasks/pnpm-pub-v1/.issues/closed/175-registry-response-schema-decoding.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
