---
title: Older IPC boundary residue stayed current after WebSocket guard closure
state: closed
github_issue_status: closed
label: task-ledger
resolution: fixed
---

## Summary

Milestone 93 and issue `097-ipc-request-boundary-casts.md` still described a WebSocket client-message cast in `src/daemon/web-server.ts` as current after issue 098 had already replaced that boundary with explicit message guards.

## Impact

The task ledger is the LOOP source for the next bounded round. A stale residual can pull future work toward an already-closed WebSocket action-boundary problem and make historical review prose compete with the live source law.

## Evidence

- `src/daemon/web-server.ts:245` accepts inbound client messages as `unknown`.
- `src/daemon/web-server.ts:250` rejects unproven messages through `isWsClientMessage`.
- `src/daemon/web-server.ts:679` validates client message shapes before action dispatch.
- `test/unit/web-server-renew.test.ts:502` proves malformed authenticated WebSocket actions do not create events.
- `tasks/pnpm-pub-v1/.issues/closed/098-websocket-client-message-cast.md:20` records the original WebSocket guard closure.

## Resolution

Updated the older ledger projection:

```text
old IPC boundary round
    |
    v
stale WS cast residue ----> later issue 098 closure
    |
    v
current ledger points at live unknown -> guard law
```

Milestone 93 now points at issue 098 instead of stating the cast is current, and issue 097's self-review now conserves to the later closure.

## Self-Review

Task offset: this round corrected task-ledger projection only; it did not change runtime WebSocket parsing, frame decoding, or scheduler action behavior.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
