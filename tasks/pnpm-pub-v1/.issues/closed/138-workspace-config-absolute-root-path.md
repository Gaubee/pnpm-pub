---
title: workspaces.json could hydrate relative workspace paths
state: closed
github_issue_status: closed
label: state
milestone: 134
resolution: fixed
---

## Summary

Chapter 5.3.3 defines `workspaces.json` entries as absolute root paths. The loader validated the basic object shape, but it still accepted relative paths from disk as workspace source records.

## Impact

A relative path is not a durable workspace atom. It depends on the daemon's later process CWD, weakens root-path conservation, and can cause the Workspaces projection to scan or display a path that was never confirmed as an absolute project root.

## Evidence

- `spec/05.md:46` defines `path` as an absolute root path.
- `src/daemon/store.ts:291` now rejects empty or non-absolute persisted workspace paths during hydration.
- `test/unit/store.test.ts:223` proves a relative `workspaces.json` path hydrates to the empty fallback.
- `pnpm exec vitest run test/unit/store.test.ts` passes.

## Resolution

Made workspace config hydration conserve to host-absolute root paths only:

```text
workspaces.json
    |
    v
parse workspace atoms
    |
    +-- path is non-empty and absolute -> accept workspace
    |
    +-- path is empty or relative -> reject config
```

## Self-Review

Task offset: this round only hardens load-time `workspaces.json` identity validation. It does not change root discovery, risky-workspace confirmation, package scanning, or WebUI workspace rendering.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
