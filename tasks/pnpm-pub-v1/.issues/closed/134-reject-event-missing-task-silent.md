---
title: WebSocket reject action silently ignored missing pending task ids
state: closed
github_issue_status: closed
label: protocol
resolution: fixed
---

## Summary

Chapter 3.3 requires WebUI confirmation actions to carry a valid `taskId`, and Chapter 6.2 defines reject as the alternate path that resolves a pending CLI wait. The WebSocket `confirm-event` path reported a missing task id, but `reject-event` silently ignored the same mismatch.

## Impact

A stale or malformed reject action had no visible protocol projection. That made the source action disappear without confirming that no pending Event was affected, weakening the pending-wall contract and making UI/debug behavior asymmetric with confirm.

## Evidence

- `src/daemon/web-server.ts:273` reports `No such pending event.` for a missing confirm task id.
- `src/daemon/web-server.ts:278` now applies the same missing-task projection to `reject-event`.
- `test/unit/web-server-renew.test.ts:538` proves an authenticated `reject-event` for `missing-task` emits the error toast and creates no Event.
- `pnpm exec vitest run test/unit/web-server-renew.test.ts` passes.
- `pnpm typecheck` passes.

## Resolution

Aligned reject with confirm at the WebSocket action boundary:

```text
WebUI action + WebToken + taskId
    |
    v
scheduler.confirm/reject
    |
    +-- matched taskId -> resolve pending Event
    |
    +-- missing taskId -> explicit error projection
```

## Self-Review

Task offset: this round only changes the missing-task projection for WebSocket rejects. It does not change successful reject semantics, CLI exit codes, or Event status transitions.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
