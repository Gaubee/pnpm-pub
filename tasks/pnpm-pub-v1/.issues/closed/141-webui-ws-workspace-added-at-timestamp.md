---
title: WebUI WebSocket decoder accepted invalid workspace timestamps
state: closed
github_issue_status: closed
label: projection
milestone: 137
resolution: fixed
---

## Summary

Chapter 5.3.3 defines workspace `addedAt` as the add-time timestamp. The daemon persistence boundary now rejects invalid timestamp facts, but the WebUI WebSocket decoder still accepted any numeric `addedAt` in `workspaces` frames.

## Impact

The WebUI could admit malformed workspace projection state even after the daemon store contract was hardened. That weakens the protocol mirror and lets impossible add-time facts enter client state if a malformed or stale frame reaches the browser.

## Evidence

- `spec/05.md:48` defines `addedAt` as the workspace add-time timestamp.
- `src/shared/index.ts:44` documents `addedAt` as a millisecond epoch.
- `webui/src/lib/ws-message.ts:66` now requires workspace `addedAt` to pass the millisecond-epoch guard.
- `webui/src/lib/ws-message.ts:149` defines the non-negative integer timestamp guard.
- `test/unit/webui-ws-message.test.ts:48` proves a workspace frame with an invalid timestamp is rejected.
- `pnpm exec vitest run test/unit/webui-ws-message.test.ts` passes.

## Resolution

Mirrored the daemon timestamp law at the WebUI WebSocket projection boundary:

```text
daemon workspaces frame
    |
    v
WebUI WS decoder
    |
    +-- addedAt is a non-negative integer epoch -> accept projection
    |
    +-- addedAt is negative or fractional -> reject frame
```

## Self-Review

Task offset: this round only hardens the WebUI WebSocket decoder for workspace timestamps. It does not change daemon persistence, workspace scanning, store rendering, or event timestamp decoding.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
