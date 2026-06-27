---
title: "WebSocket inbound frames retained oversized transport lengths"
state: closed
github_issue_status: closed
label: protocol-boundary
milestone: 144
resolution: "Fixed by bounding inbound WebSocket client frame lengths and closing invalid transport frames before payload retention."
---

## Summary

`src/daemon/ws.ts` decoded 64-bit WebSocket payload lengths into runtime parser state without a daemon-owned client-frame size law. An impossible inbound length could remain buffered as an incomplete frame rather than being rejected as invalid transport input.

## Impact

Chapters 3.2.2 and 5.2 define the WebUI WebSocket as a WebToken-gated daemon protocol boundary. Authentication identifies the UI channel, but wire bytes still remain source input. Oversized frame lengths must not become pending daemon state that waits for unrealistic payload materialization.

## Evidence

- `spec/03.md:35` through `spec/03.md:43` defines the WebToken-authenticated WebUI communication boundary.
- `spec/05.md:28` through `spec/05.md:31` defines the daemon WebSocket service.
- `src/daemon/ws.ts:11` now defines a max inbound client-frame payload size.
- `src/daemon/ws.ts:63` now distinguishes incomplete frames from invalid frames.
- `src/daemon/ws.ts:104` now rejects oversized 64-bit wire lengths before converting them to `number`.
- `src/daemon/ws.ts:144` now centralizes connection closure for invalid or close frames.
- `test/unit/ws.test.ts:63` verifies an oversized 64-bit client frame closes the connection immediately.

## Resolution

Added a bounded parsed-frame state machine for inbound WebSocket frames:

```text
wire bytes
    |
    v
incomplete | invalid | frame
                 |
                 v
              close connection
```

The daemon now treats oversized client frame lengths as invalid transport source data instead of retaining them as an unfinished protocol fact.
