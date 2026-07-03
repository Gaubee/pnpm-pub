---
title: "Memfs test adapter still uses a double cast"
state: closed
github_issue_status: closed
label: "tests"
---

## Summary

`test/helpers/memfs-adapter.ts` now uses the upstream `memfs` interface directly instead of a double cast.

## Impact

The workspace-engine test harness no longer weakens type safety at the virtual-filesystem boundary. The adapter now follows the repo's strong TypeScript contract without a local exception.

## Evidence

- `node_modules/memfs/lib/index.d.ts:10-21` exports `IFs` and `createFsFromVolume(vol): IFs`.
- `test/helpers/memfs-adapter.ts:7-23` now imports `IFs` and assigns `createFsFromVolume(vol)` directly to that type.
- `test/helpers/memfs-adapter.ts:26-41` keeps the filesystem facade aligned with the upstream interface.

## Resolution

Removed the ad hoc cast and used the upstream `memfs` `IFs` type directly.

## Self-Review

- Task drift: the fix stayed inside the test adapter and did not broaden the runtime filesystem surface.
- Task residue: no known residual after root typecheck and the focused ws/totp test run passed.
