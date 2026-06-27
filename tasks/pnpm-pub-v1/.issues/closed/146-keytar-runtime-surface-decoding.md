---
title: Keytar runtime module output was trusted without decoding
state: closed
github_issue_status: closed
label: security
milestone: 142
resolution: fixed
---

## Summary

Chapter 3.1 requires Token and TOTP Secret storage to flow through `@github/keytar`, and Chapter 9.2 requires the keytar shim to be loaded dynamically at runtime. `loadKeytar()` honored the runtime `require` law, but trusted the loaded module with direct `KeytarApi` assertions before any credential helper used it.

## Impact

Keytar is a privileged credential adapter. If the runtime shim shape were wrong, stale, or malformed, the daemon could cache a non-conforming object at the same boundary that protects tokens and TOTP secrets. The failure mode should be explicit and fail-closed before any secret read/write is attempted.

## Evidence

- `spec/03.md:7` through `spec/03.md:12` defines Token/TOTP storage as a system keychain boundary.
- `spec/09.md:22` through `spec/09.md:26` defines the dynamic fat-package keytar loading contract.
- `src/daemon/keychain.ts:78` and `src/daemon/keychain.ts:85` now read runtime modules as `unknown`.
- `src/daemon/keychain.ts:90` through `src/daemon/keychain.ts:108` now decode direct and default-export keytar surfaces before caching.
- `test/unit/keychain-load.test.ts:34` proves a malformed runtime module fails closed.
- `pnpm exec vitest run test/unit/keychain-load.test.ts test/unit/keychain.test.ts` passes.
- `pnpm typecheck` passes.

## Resolution

Replaced unchecked keytar module assertions with a small runtime decoder:

```text
runtime require()
    |
    v
unknown module
    |
    +-- direct KeytarApi surface -> cache adapter
    |
    +-- default KeytarApi surface -> cache adapter
    |
    +-- malformed surface -> throw before credential access
```

## Self-Review

Task offset: this round only hardens the keytar runtime module boundary. It does not change keychain account naming, credential storage semantics, backup import/export, renew rollback, or packaging copy layout.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
