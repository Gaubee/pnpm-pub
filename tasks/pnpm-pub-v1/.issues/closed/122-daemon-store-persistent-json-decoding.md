---
title: Daemon store hydrates persistent JSON through generic assertion
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`src/daemon/store.ts` loaded `profiles.json` and `workspaces.json` through a generic `readJson<T>()` helper that returned `JSON.parse(text) as T`. Chapter 4 and Chapter 5 define those files as daemon source truth for profiles and workspace roots, so disk JSON should be decoded as `unknown` before it hydrates in-memory state.

## Impact

Malformed persisted config could enter daemon state as if it were valid profile or workspace ontology. That weakens the no-secrets profile config law and the workspace root persistence law by allowing unchecked disk data to become runtime truth.

## Evidence

- `src/daemon/store.ts:48` now hydrates profiles through `parsePnpmPubConfig`.
- `src/daemon/store.ts:49` now hydrates workspaces through `parseWorkspacesConfig`.
- `src/daemon/store.ts:52` now reads JSON as `unknown` instead of generic `T`.
- `src/daemon/store.ts:247` validates the top-level `PnpmPubConfig` shape.
- `src/daemon/store.ts:258` validates profile entries and optional profile fields.
- `src/daemon/store.ts:270` validates the top-level `WorkspacesConfig` shape.
- `src/daemon/store.ts:281` validates workspace entries.
- `test/unit/store.test.ts:68` verifies malformed `profiles.json` falls back to empty profile config.
- `test/unit/store.test.ts:144` verifies malformed `workspaces.json` falls back to empty workspace config.

## Resolution

Replaced generic disk hydration with explicit decoders:

```text
profiles.json / workspaces.json
    |
    v
JSON.parse -> unknown
    |
    v
config/workspace guards
    |
    v
daemon memory
```

Malformed persistent config now fails closed to the existing empty defaults instead of becoming daemon truth.

## Self-Review

Task offset: this round stayed at the daemon persistent JSON hydration boundary and did not change write format, keychain credentials, event storage, or workspace confirmation behavior.

Task residue: the other JSON assertion boundaries named here were later resolved by `tasks/pnpm-pub-v1/.issues/closed/123-ipc-frame-unknown-decoding.md`, `tasks/pnpm-pub-v1/.issues/closed/124-crypto-decrypted-secret-decoding.md`, and `tasks/pnpm-pub-v1/.issues/closed/125-package-version-manifest-decoding.md`. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
