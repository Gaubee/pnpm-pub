---
title: Package version reader promoted manifest JSON through assertions
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`src/shared/package-version.ts` read `package.json` with `JSON.parse(...) as { name?: unknown; version?: unknown }`. Chapter 7.2.1 defines the CLI/daemon version handshake as release truth read from `package.json`, so manifest bytes should be decoded as `unknown` before they can become the handshake version.

## Impact

Malformed or invalid package metadata could be treated as typed release metadata before shape validation. This blurred the source-of-truth boundary for daemon self-replacement and left the remaining live JSON assertion residue in the shared protocol support layer.

## Evidence

- `src/shared/package-version.ts:13` now exposes `readPackageVersionFrom` for a caller-provided start directory.
- `src/shared/package-version.ts:18` reads the located manifest through `parsePackageManifest`.
- `src/shared/package-version.ts:30` uses the same decoder while walking parent manifests.
- `src/shared/package-version.ts:41` keeps raw JSON parsing as `unknown`.
- `src/shared/package-version.ts:45` validates manifest shape before returning release metadata.
- `test/unit/package-version.test.ts:20` covers the package-version release-truth behavior.
- `test/unit/package-version.test.ts:30` proves malformed child manifests do not become release truth.
- `test/unit/package-version.test.ts:40` proves invalid pnpm-pub version metadata fails closed.

## Resolution

Replaced manifest assertions with an explicit release-truth decoder:

```text
package.json bytes
    |
    v
JSON.parse -> unknown
    |
    v
parsePackageManifest
    |
    v
CLI/daemon version handshake
```

Only decoded `pnpm-pub` metadata with a non-empty string `version` can provide the handshake version.

## Self-Review

Task offset: this round stayed at the package-version release-truth boundary and did not change version comparison semantics, CLI handshake retry behavior, daemon boot flow, package publishing metadata, or workspace package scanning.

Task residue: the current unchecked assertion scan over live `src`, `webui/src`, and `test` code should now report only historical ledger text. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
