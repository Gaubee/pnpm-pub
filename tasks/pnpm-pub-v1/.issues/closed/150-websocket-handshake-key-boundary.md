---
title: "WebSocket handshake accepted unproven client nonce headers"
state: closed
github_issue_status: closed
label: protocol-boundary
milestone: 146
resolution: "Fixed by accepting only a single valid 16-byte base64 Sec-WebSocket-Key before producing the handshake response."
---

## Summary

`src/daemon/ws.ts` treated any truthy `sec-websocket-key` header value as enough to produce `Sec-WebSocket-Accept`. Duplicate header arrays or malformed strings could therefore be promoted into a successful WebSocket handshake projection.

## Impact

Chapters 3.2.2 and 5.2 define WebSocket upgrade as the daemon's UI transport boundary. The WebToken gate still protects authorization, but the protocol handshake itself should only derive an accept value from a single valid client nonce source, not from arbitrary header projections.

## Evidence

- `spec/03.md:35` through `spec/03.md:43` defines the WebToken-authenticated WebUI communication boundary.
- `spec/05.md:28` through `spec/05.md:31` defines the daemon WebSocket service.
- `src/daemon/ws.ts:185` now keeps `acceptWebSocket()` behind a key-shape guard.
- `src/daemon/ws.ts:191` now rejects non-string, whitespace-padded, malformed, or non-16-byte nonce values.
- `test/unit/ws.test.ts:105` verifies the RFC handshake accept value for a valid nonce.
- `test/unit/ws.test.ts:114` verifies duplicate and malformed nonce headers do not produce a handshake.

## Resolution

The handshake boundary now follows this source law:

```text
Sec-WebSocket-Key header
    |
    v
single string + canonical base64 + 16 decoded bytes?
    |                                  |
   no                                  yes
    v                                  v
 reject upgrade                 derive accept value
```

This keeps HTTP header data as source input until it proves the WebSocket client nonce contract.
