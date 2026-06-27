---
title: Registry response schemas stayed implicit after body-source fixes
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

The registry client had already preserved response bodies as source input, but token and error body promotion still relied on anonymous field peeking. Empty token strings could become credential facts, and structured npm/CouchDB error bodies could lose their reason or summary/detail projection.

## Impact

Chapters 8.1, 8.3, 8.4, and 8.5 route token application, publish failures, clock-drift recovery, expired-token routing, and OIDC setup through `src/daemon/npm-api.ts`. Registry responses are external source input; they should become daemon facts only through explicit schema guards instead of loose projection heuristics.

## Evidence

- `src/daemon/npm-api.ts:41` now uses `nonEmptyString` before promoting registry strings into token or error facts.
- `src/daemon/npm-api.ts:46` decodes direct npm/CouchDB error objects with `message`, `error`, `reason`, `summary`, and `detail`.
- `src/daemon/npm-api.ts:64` decodes npm-style `errors[]` entries through the same guarded error-shape parser.
- `src/daemon/npm-api.ts:77` rejects missing or blank token values instead of accepting an empty credential fact.
- `test/unit/npm-api.test.ts:57` proves blank token responses do not create credentials.
- `test/unit/npm-api.test.ts:75` proves CouchDB-style `error` plus `reason` is preserved for token-apply fallback.
- `test/unit/npm-api.test.ts:146` proves npm-style `errors[]` entries drive OIDC failure projection.

## Resolution

The registry chokepoint now has a small source-to-projection decoder:

```text
registry body
    |
    v
unknown-safe schema guards
    |
    +--> non-empty token fact
    +--> structured error projection
    +--> raw stderr/source text
```

This keeps the npm-api atom protocol-pure while making token and error response promotion explicit.

## Self-Review

Task offset: this round tightened the registry response decoder only. It did not change publish document construction, TOTP generation, endpoint selection, or the existing raw `stderr` body projection.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
