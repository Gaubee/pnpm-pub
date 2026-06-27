---
title: "WebSocket handshake accepted nonce-only upgrade requests"
state: closed
github_issue_status: closed
label: protocol-boundary
milestone: 147
resolution: "Fixed by requiring WebSocket upgrade, connection, version, and nonce headers before deriving the accept value."
---

## Summary

`src/daemon/ws.ts` could derive a `Sec-WebSocket-Accept` value from a valid nonce even when the HTTP upgrade request did not prove it was a WebSocket version 13 upgrade request.

## Impact

Chapters 3.2.2 and 5.2 define the daemon WebSocket as the WebUI communication service. A nonce alone is not the full upgrade source. The transport boundary should reject non-WebSocket or wrong-version upgrade attempts before WebToken authorization and before a `101 Switching Protocols` response can be projected.

## Evidence

- `spec/03.md:35` through `spec/03.md:43` defines the WebToken-authenticated WebUI communication boundary.
- `spec/05.md:28` through `spec/05.md:31` defines the daemon WebSocket service.
- `src/daemon/ws.ts:187` now requires `Upgrade: websocket`.
- `src/daemon/ws.ts:188` now requires `Connection` to contain the `upgrade` token.
- `src/daemon/ws.ts:189` now requires `Sec-WebSocket-Version: 13`.
- `test/unit/ws.test.ts:136` verifies nonce-bearing requests without valid upgrade/version headers do not produce a handshake.

## Resolution

The handshake now follows the full transport gate:

```text
HTTP upgrade request
    |
    v
Upgrade websocket + Connection upgrade + Version 13 + valid nonce?
    |                                                        |
   no                                                        yes
    v                                                        v
 reject upgrade                                      derive accept value
```

This keeps partial HTTP header projections from becoming WebSocket protocol facts.
