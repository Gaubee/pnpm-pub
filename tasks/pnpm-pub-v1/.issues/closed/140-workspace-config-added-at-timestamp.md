---
title: workspaces.json could hydrate invalid workspace timestamps
state: closed
github_issue_status: closed
label: state
milestone: 136
resolution: fixed
---

## Summary

Chapter 5.3.3 defines `addedAt` as the timestamp for when a workspace was added. The loader accepted any JavaScript number, including values that cannot represent a usable millisecond epoch such as negative or fractional numbers.

## Impact

An invalid timestamp weakens the workspace source record. Sorting, projection, and future retention logic would be forced to interpret a value that was never a valid recorded time, letting malformed persistence leak into daemon state.

## Evidence

- `spec/05.md:48` defines `addedAt` as an add-time timestamp.
- `src/shared/index.ts:44` documents `addedAt` as a millisecond epoch.
- `src/daemon/store.ts:296` now rejects non-integer or negative persisted `addedAt` values.
- `test/unit/store.test.ts:257` proves an invalid persisted timestamp hydrates to the empty fallback.
- `pnpm exec vitest run test/unit/store.test.ts` passes.

## Resolution

Made workspace config hydration conserve to valid timestamp facts:

```text
workspaces.json
    |
    v
parse workspace atom
    |
    +-- addedAt is a non-negative integer epoch -> accept workspace
    |
    +-- addedAt is negative or fractional -> reject config
```

## Self-Review

Task offset: this round only hardens load-time `workspaces.json` timestamp validation. It does not change root discovery, `addWorkspace()` write behavior, pinning, scanning, or WebUI workspace rendering.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
