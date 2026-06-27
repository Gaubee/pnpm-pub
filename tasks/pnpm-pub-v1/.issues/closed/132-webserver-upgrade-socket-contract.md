---
title: WebServer upgrade path reintroduced a concrete socket assertion
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`src/daemon/web-server.ts` passed the HTTP `upgrade` socket into `handleUpgrade()` with `socket as import('net').Socket`. Chapter 5.2 mounts WebSocket transport on the WebUI HTTP server, and this boundary already has a local minimal socket law in `SocketLike`.

## Impact

The upgrade path only needs the socket operations consumed by `WebSocketConnection`: `on`, `write`, `end`, and `destroy`. Asserting the Node upgrade socket into a concrete `net.Socket` bypasses that local contract and can hide drift between the HTTP adapter and the WebSocket transport atom.

## Evidence

- `src/daemon/web-server.ts:14` imports the shared `SocketLike` contract from `src/daemon/ws.ts`.
- `src/daemon/web-server.ts:63` now passes the upgrade socket directly to `handleUpgrade()` without an assertion.
- `src/daemon/ws.ts:18` now allows `SocketLike.write()` to carry `Buffer | Uint8Array | string`, covering both frame buffers and HTTP handshake strings.
- `src/daemon/web-server.ts:192` now types the upgrade boundary as `SocketLike`.
- `src/daemon/web-server.ts:215` passes the same socket contract into `WebSocketConnection`.
- `pnpm exec vitest run test/unit/ws.test.ts test/unit/web-server-renew.test.ts` passes.
- `pnpm typecheck` passes.

## Resolution

Restored the minimal transport contract at the upgrade boundary:

```text
HTTP upgrade socket
    |
    v
SocketLike.write(Buffer | Uint8Array | string)
    |
    v
WebSocketConnection
```

## Self-Review

Task offset: this round only strengthens the HTTP upgrade socket type boundary; it does not change WebToken validation, WebSocket frame behavior, or REST API behavior.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
