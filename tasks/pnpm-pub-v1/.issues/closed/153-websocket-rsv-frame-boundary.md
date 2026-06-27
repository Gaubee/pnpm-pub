---
title: "WebSocket parser accepted extension-marked frames without negotiation"
state: closed
github_issue_status: closed
label: protocol-boundary
milestone: 149
resolution: "Fixed by rejecting frames with reserved WebSocket bits before opcode dispatch."
---

## Summary

`src/daemon/ws.ts` ignored RSV bits on inbound frames. Because the daemon handshake does not negotiate WebSocket extensions, an extension-marked text frame could still be decoded as a normal daemon JSON message.

## Impact

Chapters 3.2.2 and 5.2 define a WebToken-gated WebUI WebSocket channel, and the local implementation is intentionally minimal: handshake, text frames, and close. Reserved frame bits are not a presentation detail; they change the transport semantics. Accepting them would let an unnegotiated transport mode masquerade as a plain text action source.

## Evidence

- `spec/03.md:33` through `spec/03.md:40` defines the WebToken-authenticated WebUI communication boundary.
- `spec/05.md:28` through `spec/05.md:30` defines the daemon WebSocket service.
- `src/daemon/ws.ts:93` now reads whether any RSV bit is set.
- `src/daemon/ws.ts:97` now rejects reserved-bit frames before opcode dispatch.
- `test/unit/ws.test.ts:165` verifies an extension-marked text frame closes the connection without dispatching a daemon message.

## Resolution

The inbound frame boundary now requires:

```text
FIN + RSV=0 + text opcode + masked payload
    |
    v
JSON action decoder

RSV1/RSV2/RSV3 set without negotiation
    |
    v
close transport before daemon dispatch
```

This keeps unnegotiated extension transport facts out of the daemon action ontology.
