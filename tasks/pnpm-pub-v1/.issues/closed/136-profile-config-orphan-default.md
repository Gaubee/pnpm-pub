---
title: profiles.json could hydrate an orphan default profile
state: closed
github_issue_status: closed
label: state
resolution: fixed
---

## Summary

Chapter 4.1 defines `profiles.json.default` as a username that points into the `profiles` array. The loader validated profile shapes, but it still accepted a valid profile list with `default: "ghost"` when no `ghost` profile existed.

## Impact

The daemon could enter memory with an active default identity that had no source profile record. That weakens profile isolation, makes UI profile projection ambiguous, and conflicts with the same source-boundary law already enforced by `DaemonStore.setDefault()`.

## Evidence

- `src/daemon/store.ts:257` now normalizes the loaded default to the persisted default only when it names a parsed profile.
- `src/daemon/store.ts:259` falls back to the first parsed profile, or `""` when no profiles exist.
- `test/unit/store.test.ts:97` proves a `profiles.json` with `default: "ghost"` and valid profiles loads with `default === "alice"`.
- `pnpm exec vitest run test/unit/store.test.ts` passes.
- `pnpm typecheck` passes.

## Resolution

Made default-profile hydration conserve to the parsed profile source set:

```text
profiles.json
    |
    v
parse profiles[]
    |
    +-- default names parsed profile -> keep it
    |
    +-- default is orphaned -> first parsed profile or ""
```

## Self-Review

Task offset: this round only fixes load-time profile config normalization. It does not change `setDefault()`, profile deletion, keychain credentials, or WebUI profile switching behavior.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
