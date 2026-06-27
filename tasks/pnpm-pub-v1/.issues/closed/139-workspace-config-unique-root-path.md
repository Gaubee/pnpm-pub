---
title: workspaces.json could hydrate duplicate workspace roots
state: closed
github_issue_status: closed
label: state
milestone: 135
resolution: fixed
---

## Summary

Chapter 5.3.3 defines each workspace entry by its absolute root path. Runtime `addWorkspace()` already treats `path` as the identity key, but load-time hydration still accepted duplicated persisted roots from `workspaces.json`.

## Impact

Duplicate root records weaken the workspace atom boundary. The WebUI could receive repeated records for one physical root, and later pinning or scanning behavior would depend on array position instead of one source record per root path.

## Evidence

- `spec/05.md:46` defines `path` as the absolute root path for a workspace entry.
- `src/daemon/store.ts:281` now tracks parsed workspace roots as the config source set.
- `src/daemon/store.ts:285` rejects duplicate parsed root paths.
- `test/unit/store.test.ts:237` proves duplicate root paths hydrate to the empty fallback.
- `pnpm exec vitest run test/unit/store.test.ts` passes.

## Resolution

Made workspace config hydration conserve to one source record per absolute root:

```text
workspaces.json
    |
    v
parse workspace atoms
    |
    +-- root path is absolute and unseen -> accept workspace
    |
    +-- root path duplicates an earlier atom -> reject config
```

## Self-Review

Task offset: this round only hardens load-time `workspaces.json` duplicate-root validation. It does not change root discovery, `addWorkspace()` update semantics, pinning, scanning, or WebUI workspace rendering.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
