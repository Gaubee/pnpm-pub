---
title: Workspace persistence accepted extra runtime fields
state: closed
github_issue_status: closed
label: ontology
milestone: 141
resolution: fixed
---

## Summary

Chapter 5.3.3 defines `workspaces.json` entries as exactly `path`, `pinned`, and `addedAt`. `DaemonStore.addWorkspace()` previously retained the caller object on insert and used `Object.assign(existing, entry)` on update, so runtime values with extra projection fields could leak into the in-memory workspace fact and then the persisted config.

## Impact

Workspace entries are source facts, not UI projections. Allowing extra runtime fields to persist would blur the `workspaces.json` ontology and make future projections or helper metadata indistinguishable from the stored workspace contract.

## Evidence

- `spec/05.md:42` through `spec/05.md:50` defines the complete `workspaces.json` entry shape.
- `src/daemon/store.ts:154` now copies workspace entries through explicit schema fields.
- `src/daemon/store.ts:157` through `src/daemon/store.ts:160` now updates or inserts only `path`, `pinned`, and `addedAt`.
- `test/unit/store.test.ts:222` proves extra runtime projection fields are not retained after insert and update.
- `pnpm exec vitest run test/unit/store.test.ts` passes.
- `pnpm typecheck` passes.

## Resolution

Replaced broad object retention/mutation with explicit workspace ontology copying:

```text
runtime workspace input
    |
    v
DaemonStore.addWorkspace
    |
    +-- path
    +-- pinned
    +-- addedAt
    |
    v
workspaces.json source fact
```

## Self-Review

Task offset: this round only hardens workspace entry persistence. It does not change workspace root discovery, risk confirmation, scanner behavior, WebUI workspace rendering, or workspace config hydration.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
