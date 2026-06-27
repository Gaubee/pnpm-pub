---
title: WebUI WebSocket decoder accepted invalid event timestamps
state: closed
github_issue_status: closed
label: projection
milestone: 138
resolution: fixed
---

## Summary

Chapter 6.2 defines the Events page as a time-ordered event timeline. The WebUI WebSocket decoder validated event timestamp fields only as plain numbers, so impossible values such as negative `resolvedAt` could enter client state.

## Impact

Invalid event timestamps weaken the Events projection. Timeline sorting and card time labels would have to interpret values that were never valid event facts, letting malformed protocol frames pollute the UI's view of event history.

## Evidence

- `spec/06.md:24` defines Events cards as time-descending.
- `webui/src/lib/ws-message.ts:77` now requires `createdAt` to be a millisecond epoch.
- `webui/src/lib/ws-message.ts:79` now requires optional `resolvedAt` to be a millisecond epoch when present.
- `webui/src/lib/ws-message.ts:145` defines the non-negative integer timestamp guard.
- `test/unit/webui-ws-message.test.ts:59` proves an event frame with an invalid resolved timestamp is rejected.
- `pnpm exec vitest run test/unit/webui-ws-message.test.ts` passes.

## Resolution

Mirrored the event timeline timestamp law at the WebUI WebSocket projection boundary:

```text
daemon event frame
    |
    v
WebUI WS decoder
    |
    +-- createdAt/resolvedAt are non-negative integer epochs -> accept event
    |
    +-- timestamp is negative or fractional -> reject frame
```

## Self-Review

Task offset: this round only hardens WebUI WebSocket event timestamp decoding. It does not change daemon event creation, event sorting, card rendering, or workspace timestamp decoding.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
