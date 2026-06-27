---
title: "WebSocket parser accepted non-text data frames as daemon messages"
state: closed
github_issue_status: closed
label: protocol-boundary
milestone: 148
resolution: "Fixed by rejecting fragmented frames and unsupported opcodes before payload decoding."
---

## Summary

`src/daemon/ws.ts` treated binary frames as JSON text and allowed fragmented text frames to pass the transport boundary without closing the connection.

## Impact

Chapters 3.2.2 and 5.2 define the daemon WebSocket as the WebUI action channel. The implementation comment narrows the local server to text frames and close, so binary payloads or partial fragments should not become daemon protocol facts. Accepting them blurs the source of action before WebToken-authenticated message decoding.

## Evidence

- `spec/03.md:33` through `spec/03.md:40` defines the WebToken-authenticated WebUI communication boundary.
- `spec/05.md:28` through `spec/05.md:31` defines the daemon WebSocket service.
- `src/daemon/ws.ts:93` now reads the frame FIN bit before opcode handling.
- `src/daemon/ws.ts:96` now rejects non-final fragmented frames.
- `src/daemon/ws.ts:97` now rejects unsupported opcodes before payload decoding.
- `test/unit/ws.test.ts:121` verifies a masked binary JSON frame does not dispatch a daemon message.
- `test/unit/ws.test.ts:141` verifies a fragmented text frame is rejected before partial payload decoding.

## Resolution

The inbound frame law is now:

```text
masked complete text frame
    |
    v
JSON action decoder

binary / fragmented / unsupported opcode
    |
    v
close transport before daemon dispatch
```

This keeps transport projections from widening the daemon's authenticated action ontology.
