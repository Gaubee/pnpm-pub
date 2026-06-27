---
title: Older registry decoding residues stayed current after registry body closures
state: closed
github_issue_status: closed
label: task-ledger
resolution: fixed
---

## Summary

Milestones 95 through 102 and issues `099` through `106` still described broader registry JSON decoding as current work after later registry rounds had already introduced the shared registry body reader, guarded body text projection, and unknown-safe token-apply error projection.

## Impact

The task ledger is the iteration source for this LOOP. Leaving old registry decoding residue as current would pull later rounds toward an already-corrected source boundary and blur the distinction between live registry input law and historical self-review text.

## Evidence

- `src/daemon/npm-api.ts:127` routes token responses through `readRegistryBody`.
- `src/daemon/npm-api.ts:130` accepts token facts only through `parseTokenResponse`.
- `src/daemon/npm-api.ts:147` preserves registry response text when JSON parsing fails.
- `src/daemon/npm-api.ts:240` and `src/daemon/npm-api.ts:348` reuse the same registry body reader for publish and OIDC responses.
- `test/unit/npm-api.test.ts:57` covers non-`Error` token-apply rejection projection.
- `test/unit/npm-api.test.ts:82` covers non-JSON OIDC response text preservation.

## Resolution

Updated the older ledger projections:

```text
registry response bytes/text
    |
    v
readRegistryBody -> unknown JSON or raw text
    |
    v
parseTokenResponse / parseNpmError / bodyToText / errorToMessage
    |
    v
credential, publish, OIDC, and renewal projections
```

Milestones 95 through 102 and issues 099 through 106 now point to the later registry closures instead of stating that the broader registry JSON decoding surface is still current.

## Self-Review

Task offset: this round corrected task-ledger projection only; it did not change registry runtime behavior, package metadata parsing, or publish/OIDC request construction.

Task residue: future schema-specific npm response parsing remains a possible tightening where issues 107 through 109 already name it; Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
