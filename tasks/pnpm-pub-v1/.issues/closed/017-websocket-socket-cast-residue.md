---
title: "WebSocket upgrade path and test harness still cast sockets unsafely"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

`src/daemon/web-server.ts` and `test/unit/ws.test.ts` now use a shared minimal socket contract instead of unsafe double casts.

## Impact

The WebSocket boundary no longer keeps a runtime/test type hole at the IPC transport edge. The daemon and its proof now share the same explicit socket contract.

## Evidence

- `src/daemon/web-server.ts:215` now passes the upgrade socket directly into `WebSocketConnection`.
- `src/daemon/ws.ts:11-18` defines the minimal `SocketLike` contract used by the transport boundary.
- `test/unit/ws.test.ts:11-31` now uses the shared socket contract rather than a double cast.

## Resolution

Replaced the transport-edge double casts with a shared minimal socket contract and verified the runtime/test boundary with focused WebSocket and TOTP tests.

## Self-Review

- Task drift: the fix stayed inside the WebSocket boundary and did not widen the daemon protocol.
- Task residue: no known residual after root typecheck and the focused ws/totp/drift tests passed.
