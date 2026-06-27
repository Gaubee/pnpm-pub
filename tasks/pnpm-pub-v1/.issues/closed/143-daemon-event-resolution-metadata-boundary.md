---
title: Daemon event resolution accepted arbitrary event patches
state: closed
github_issue_status: closed
label: platform-law
milestone: 139
resolution: fixed
---

## Summary

Chapter 6.2 defines Events as the central action unit and state timeline. `DaemonStore.resolveEvent()` accepted `Partial<PubEvent>` metadata and merged it with `Object.assign()`, so a future resolution call could overwrite ontology fields such as `id`, `kind`, `profile`, `createdAt`, or `resolvedAt` after the store had already assigned the resolution source facts.

## Impact

Event resolution is a platform law, not a projection helper. Leaving it open to arbitrary `PubEvent` patches blurred source-of-action conservation: a business atom could accidentally mutate event identity or timestamp facts while only intending to add resolution metadata.

## Evidence

- `spec/06.md:21` defines the Events page as the source for interaction actions and approvals.
- `spec/06.md:24` defines the Events timeline as time-descending.
- `src/shared/index.ts:195` defines `PubEvent` as the central event fact shape.
- `src/daemon/store.ts:27` now names `EventResolutionMetadata` as only `clockDriftRecovered`.
- `src/daemon/store.ts:239` now accepts named resolution metadata instead of `Partial<PubEvent>`.
- `src/daemon/store.ts:247` through `src/daemon/store.ts:251` now sets source-owned resolution facts explicitly.
- `test/unit/store.test.ts:173` proves clock-drift recovery metadata is still recorded without widening the event patch surface.
- `pnpm exec vitest run test/unit/store.test.ts` passes.
- `pnpm typecheck` passes.

## Resolution

Replaced the open event patch parameter with a narrow resolution metadata contract:

```text
event creation source
    |
    v
DaemonStore event ontology
    |
    v
resolveEvent(status, result, metadata)
    |
    +-- store-owned resolution facts: status, resolvedAt, result
    |
    +-- named resolution metadata: clockDriftRecovered
```

## Self-Review

Task offset: this round only hardens daemon event-resolution metadata. It does not change WebUI event decoding, event-card projection, scheduler execution branches, or NPM publish behavior.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
