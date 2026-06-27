---
title: "WebSocket parser retained extended close frames as incomplete transport state"
state: closed
github_issue_status: closed
label: protocol-boundary
milestone: 150
resolution: "Fixed by rejecting close frames with payload lengths above the control-frame limit as soon as the wire length is known."
---

## Summary

`src/daemon/ws.ts` treated a close frame using extended payload length encoding as incomplete until mask and payload bytes arrived. The daemon's WebSocket channel is intentionally minimal, and close is a control frame rather than an arbitrary data carrier.

## Impact

Chapters 3.2.2 and 5.2 define the daemon WebSocket as the WebToken-gated WebUI communication service. A close frame with an extended payload length is not a valid source action for this minimal channel. Retaining it as pending transport state lets invalid control-frame shape consume parser state instead of being rejected at the boundary.

## Evidence

- `spec/03.md:33` through `spec/03.md:40` defines the WebToken-authenticated WebUI communication boundary.
- `spec/05.md:28` through `spec/05.md:30` defines the daemon WebSocket service.
- `src/daemon/ws.ts:113` now rejects close frames whose payload length exceeds 125 bytes.
- `test/unit/ws.test.ts:45` creates a masked close-frame header with extended payload length.
- `test/unit/ws.test.ts:191` verifies the extended close frame is rejected before the parser waits for payload bytes.

## Resolution

The close-frame path now follows the control-frame boundary:

```text
close opcode + payload length <= 125
    |
    v
normal close

close opcode + extended payload length
    |
    v
close transport before retaining incomplete state
```

This keeps invalid control-frame shape from becoming pending daemon transport state.
