---
title: Event projection test fixture used an over-wide PubEvent patch
state: closed
github_issue_status: closed
label: test-law
milestone: 140
resolution: fixed
---

## Summary

The WebUI event projection regression helper accepted `Partial<PubEvent>` even though the scenarios only needed `profileOverride`. That made a projection fixture look like an arbitrary event patch surface and repeated the same shape of over-wide event mutation boundary removed from daemon event resolution.

## Impact

The production projection stayed correct, but the test fixture weakened the type-safety evidence around Chapter 6.2 profile isolation. Future tests could override event ontology fields such as `createdAt`, `kind`, or `profile` while appearing to exercise only context-override visibility.

## Evidence

- `spec/06.md:23` through `spec/06.md:29` defines Events timeline ordering and pending context override visibility.
- `webui/src/lib/event-projection.ts:7` projects visibility from `profile`, `status`, and `profileOverride`.
- `test/unit/event-projection.test.ts:11` now defines a named `EventFixtureOptions` boundary.
- `test/unit/event-projection.test.ts:15` now accepts only the named fixture options needed by the projection scenarios.
- `test/unit/event-projection.test.ts:23` through `test/unit/event-projection.test.ts:44` continue to verify sibling-profile filtering and pending override visibility.
- `pnpm exec vitest run test/unit/event-projection.test.ts` passes.
- `pnpm typecheck` passes.

## Resolution

Replaced the open `Partial<PubEvent>` fixture patch with a small test-local options type:

```text
projection scenario
    |
    v
event fixture
    |
    +-- fixed ontology: id, kind, status, profile, createdAt
    |
    +-- named projection option: profileOverride
```

## Self-Review

Task offset: this round only hardens the WebUI event projection test fixture. It does not change production event filtering, WebSocket decoding, daemon event creation, or event-card rendering.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
