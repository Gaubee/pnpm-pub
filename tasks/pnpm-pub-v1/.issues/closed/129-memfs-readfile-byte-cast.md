---
title: Memfs readFile adapter cast bytes before text projection
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`test/helpers/memfs-adapter.ts` converted `memfs` `readFile()` bytes with `Buffer.from(data as ArrayBufferLike)`. The workspace scanner tests depend on this adapter as their Chapter 10.1.3 filesystem source, so byte data should cross into `FsAPI.readFile()` through the real upstream type rather than an unchecked cast.

## Impact

The workspace scanner treats package manifests, `.gitignore`, and `pnpm-workspace.yaml` as source records. If the test adapter asserts raw file bytes into a different shape, the scanner evidence is slightly weaker: the virtual filesystem boundary can drift while still compiling.

## Evidence

- `test/helpers/memfs-adapter.ts:23` uses the upstream `IFs` surface returned by `createFsFromVolume(vol)`.
- `test/helpers/memfs-adapter.ts:43` keeps the project-facing `readFile()` facade as `Promise<string>`.
- `test/helpers/memfs-adapter.ts:47` now passes the upstream byte value directly to `Buffer.from(data)` without an assertion.
- `pnpm exec vitest run test/unit/workspace.test.ts` passes.

## Resolution

Removed the `ArrayBufferLike` cast from the memfs text projection:

```text
memfs readFile bytes
    |
    v
Buffer.from(data)
    |
    v
FsAPI.readFile string
    |
    v
workspace scanner source tests
```

## Self-Review

Task offset: this round stayed inside the workspace test adapter and did not change runtime workspace scanning behavior.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
